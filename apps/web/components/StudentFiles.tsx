'use client';
import { useEffect, useState } from 'react';
import { blobUrl, del, upload } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from './ui';

export const FILE_KINDS = ['PHOTO', 'BIRTH_CERTIFICATE', 'VACCINATION_RECORD', 'PARENT_ID', 'PREVIOUS_SCHOOL_REPORT', 'TRANSFER_LETTER', 'PASSPORT', 'OTHER'] as const;
export const REQUIRED_FILES = ['PHOTO', 'BIRTH_CERTIFICATE'];
export const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export interface PaperFile { id: string; kind: string; mime: string; preview?: string; name?: string }

/** A small picture of a paper: the image itself, or a PDF tile. Opens full size in a new tab. */
export function Thumb({ src, mime, label, onOpen }: { src?: string; mime: string; label: string; onOpen?: () => void }) {
  const pdf = mime === 'application/pdf';
  return (
    <button type="button" className="thumb" onClick={onOpen} title={label} aria-label={label}>
      {pdf || !src ? <span className="thumb-pdf">PDF</span> : <img src={src} alt="" />}
    </button>
  );
}

/** A paper already saved for a student, fetched with the login token. */
export function SavedThumb({ studentId, file, label, onRemove }: { studentId: string; file: PaperFile; label: string; onRemove?: () => void }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string>();
  const path = `/students/${studentId}/files/${file.id}`;
  useEffect(() => {
    let url: string | undefined;
    if (file.mime !== 'application/pdf') blobUrl(path).then((u) => setSrc((url = u))).catch(() => undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [path, file.mime]);
  const open = async () => window.open(src ?? (await blobUrl(path)), '_blank', 'noopener');
  return (
    <span className="paper">
      <Thumb src={src} mime={file.mime} label={label} onOpen={open} />
      {onRemove && <button type="button" className="link-btn small" onClick={onRemove}>{t.common.remove}</button>}
    </span>
  );
}

/**
 * Phone photos are often several megabytes: a large picture is redrawn at most
 * 2000 pixels wide as a JPEG before it is sent. PDFs and small pictures go as they are.
 */
export async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.size < 1_500_000) return f;
  try {
    const img = await createImageBitmap(f);
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    return blob && blob.size < f.size ? new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
  } catch {
    return f;
  }
}

/** Checks a chosen file before it is sent: type and size. Returns a message, or null when it's fine. */
export function fileProblem(f: File, kind: string, t: ReturnType<typeof useI18n>['t']): string | null {
  if (!ACCEPT.split(',').includes(f.type)) return t.papers.badType;
  if (kind === 'PHOTO' && f.type === 'application/pdf') return t.papers.photoNotPdf;
  if (f.size > MAX_BYTES) return t.papers.tooBig;
  return null;
}

/** Chooses and uploads papers for a student who isn't saved yet (or, with studentId, one who is). */
export function PaperPicker({ files, onChange, studentId, saved = [], onSavedChange }: {
  files: PaperFile[];
  onChange: (f: PaperFile[]) => void;
  studentId?: string;
  saved?: PaperFile[];
  onSavedChange?: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(kind: string, list: FileList | null) {
    setError(null);
    for (const chosen of Array.from(list ?? [])) {
      const f = ACCEPT.split(',').includes(chosen.type) ? await shrink(chosen) : chosen;
      const problem = fileProblem(f, kind, t);
      if (problem) {
        setError(`${f.name}: ${problem}`);
        continue;
      }
      setBusy(kind);
      try {
        const up = await upload<PaperFile>(studentId ? `/students/${studentId}/files` : '/students/files', f, { kind });
        if (studentId) onSavedChange?.();
        else onChange([...files, { ...up, name: f.name, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }]);
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    }
  }

  async function removeSaved(f: PaperFile) {
    try {
      await del(`/students/${studentId}/files/${f.id}`);
      onSavedChange?.();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="papers full">
      {error && <span className="help error" role="alert">{error}</span>}
      {FILE_KINDS.map((kind) => {
        const mine = files.filter((f) => f.kind === kind);
        const kept = saved.filter((f) => f.kind === kind);
        const required = REQUIRED_FILES.includes(kind);
        const missing = required && !mine.length && !kept.length;
        return (
          <div key={kind} className={`paper-row${missing ? ' missing' : ''}`}>
            <div className="paper-name">
              <b>{t.papers.kinds[kind]}{required ? ' *' : ''}</b>
              <span className="small muted">{t.papers.help[kind]}</span>
            </div>
            <div className="paper-files">
              {kept.map((f) => <SavedThumb key={f.id} studentId={studentId!} file={f} label={t.papers.kinds[kind]} onRemove={required && kept.length === 1 ? undefined : () => removeSaved(f)} />)}
              {mine.map((f) => (
                <span key={f.id} className="paper">
                  <Thumb src={f.preview} mime={f.mime} label={f.name ?? t.papers.kinds[kind]} onOpen={() => f.preview && window.open(f.preview, '_blank', 'noopener')} />
                  <button type="button" className="link-btn small" onClick={() => onChange(files.filter((x) => x.id !== f.id))}>{t.common.remove}</button>
                </span>
              ))}
              <label className={`btn small${busy === kind ? ' busy' : ''}`}>
                {busy === kind ? t.common.oneMoment : kept.length || mine.length ? t.papers.addMore : t.papers.choose}
                <input type="file" accept={ACCEPT} multiple={kind !== 'PHOTO'} hidden disabled={!!busy} onChange={(e) => { void add(kind, e.target.files); e.target.value = ''; }} />
              </label>
            </div>
          </div>
        );
      })}
      <span className="small muted">{t.papers.formats}</span>
    </div>
  );
}
