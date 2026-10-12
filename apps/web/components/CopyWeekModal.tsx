'use client';
import { FormEvent, useState } from 'react';
import { post } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Modal } from './Modal';
import { ErrorNote, Note } from './ui';

type Skipped = { dayOfWeek: number; period: number; subject: string; subjectAr: string | null; reason: 'FILLED' | 'ROOM_BUSY' | 'TEACHER_BUSY'; detail: string | null };
type CopyResult = { copied: number; skipped: Skipped[]; withoutTeacher: { subject: string; subjectAr: string | null }[] };

type Props = {
  open: boolean;
  onClose: () => void;
  /** The class whose week is copied. */
  from: { id: string; name: string; gradeId: string };
  /** Every class of the school: the targets are the others of the same year group. */
  classes: any[];
  rooms: any[];
  /** Every lesson in the school, to show how full each target is and which classroom it already uses. */
  everyLesson: any[];
  /** The lessons of the class being copied. */
  lessons: any[];
  onCopied: () => Promise<unknown>;
  onOpenClass: (id: string) => void;
};

/**
 * Copies one class's week to another class of the same year group. The subjects and periods carry over;
 * what the other class gets for itself is its own teacher for each subject and its own classroom, so the
 * only thing asked is which class, which classroom, and whether to keep or replace what it already has.
 * Anything that couldn't be placed is listed afterwards, never dropped silently.
 */
function CopyWeekForm({ onClose, from, classes, rooms, everyLesson, lessons, onCopied, onOpenClass }: Omit<Props, 'open'>) {
  const { t, x, subject } = useI18n();
  const act = useAction();
  const targets = classes.filter((c) => c.gradeId === from.gradeId && c.id !== from.id);
  const countOf = (classId: string) => everyLesson.filter((e) => e.class?.id === classId).length;
  /** Lessons held in an ordinary classroom need the new class's own; labs and halls don't. */
  const needsRoom = lessons.some((e) => e.room?.kind === 'CLASSROOM');
  const classrooms = rooms.filter((r) => r.kind === 'CLASSROOM');

  const [toId, setToId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<CopyResult | null>(null);
  const target = targets.find((c) => c.id === toId);
  const existing = toId ? countOf(toId) : 0;

  function choose(id: string) {
    setToId(id);
    setReplace(false);
    // The classroom that class already uses is the likely answer.
    setRoomId(everyLesson.find((e) => e.class?.id === id && e.room?.kind === 'CLASSROOM')?.room.id ?? '');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (replace && existing > 0 && !confirm(t.tt.replaceConfirm(target.name, existing))) return;
    const ok = await act.run(async () => {
      setResult(await post<CopyResult>('/timetable/copy', { fromClassId: from.id, toClassId: target.id, ...(needsRoom ? { roomId } : {}), replace }));
    });
    if (ok) await onCopied();
  }

  if (!targets.length) {
    return (
      <>
        <Note>{t.tt.noOtherClass}</Note>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>{t.common.close}</button></div>
      </>
    );
  }

  if (result && target) {
    // Periods the class already filled are one line, not a list: only a busy room or teacher is worth reading about.
    const filled = result.skipped.filter((s) => s.reason === 'FILLED').length;
    const clashes = result.skipped.filter((s) => s.reason !== 'FILLED');
    return (
      <>
        <Note tone={result.copied ? 'info' : 'warn'} title={x(result.copied ? t.tt.copied(result.copied, target.name) : t.tt.nothingCopied(target.name))} />
        {filled > 0 && <span className="small muted">{t.tt.filledN(filled)}</span>}
        {clashes.length > 0 && (
          <div className="stack">
            <b>{t.tt.notCopied}</b>
            <ul className="stack small" style={{ margin: 0, paddingInlineStart: 18, maxHeight: 240, overflowY: 'auto' }}>
              {clashes.map((s) => (
                <li key={`${s.dayOfWeek}:${s.period}`}>
                  {t.days[s.dayOfWeek]} · {t.lessons.p(s.period)} · <b>{subject({ name: s.subject, nameAr: s.subjectAr })}</b>
                  {' — '}
                  {x(s.reason === 'ROOM_BUSY' ? t.tt.skip.ROOM_BUSY(s.detail ?? '') : t.tt.skip.TEACHER_BUSY(s.detail ?? ''))}
                </li>
              ))}
            </ul>
            <span className="small muted">{t.tt.notCopiedNote}</span>
          </div>
        )}
        {result.withoutTeacher.length > 0 && (
          <Note tone="warn" title={x(t.tt.noTeacherIn(target.name))}>
            {t.tt.noTeacherHint(result.withoutTeacher.map((s) => subject({ name: s.subject, nameAr: s.subjectAr })).join(t.tt.listSep), t.subj.teachersTitle)}
          </Note>
        )}
        <div className="form-actions">
          <button type="button" className="btn primary" onClick={() => { onOpenClass(target.id); onClose(); }}>{x(t.tt.openClass(target.name))}</button>
          <button type="button" className="btn" onClick={onClose}>{t.common.close}</button>
        </div>
      </>
    );
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <p className="small muted" style={{ margin: 0 }}>{t.tt.copyIntro}</p>
      <ErrorNote error={act.error && x(act.error)} />
      <label className="field">
        {t.tt.copyTo}
        <select className="input" required autoFocus value={toId} onChange={(ev) => choose(ev.target.value)}>
          <option value="">{t.tt.copyToPh}</option>
          {targets.map((c) => <option key={c.id} value={c.id}>{x(`${c.name} · ${t.tt.copyLessonsN(countOf(c.id))}`)}</option>)}
        </select>
      </label>
      {target && needsRoom && (
        <label className="field">
          {t.tt.classroom}
          <select className="input" required value={roomId} onChange={(ev) => setRoomId(ev.target.value)}>
            <option value="">{t.tt.classroomPh}</option>
            {classrooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <span className="help">{t.tt.classroomNote}</span>
        </label>
      )}
      {target && existing > 0 && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="check"><input type="radio" name="mode" checked={!replace} onChange={() => setReplace(false)} /> <span><b>{t.tt.modeFill}</b><br /><span className="small muted">{t.tt.modeFillNote}</span></span></label>
          <label className="check"><input type="radio" name="mode" checked={replace} onChange={() => setReplace(true)} /> <span><b>{t.tt.modeReplace}</b><br /><span className="small muted">{t.tt.modeReplaceNote}</span></span></label>
        </fieldset>
      )}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={act.busy || !target || (needsRoom && !roomId)}>{t.tt.copy}</button>
        <button type="button" className="btn" onClick={onClose}>{t.common.cancel}</button>
      </div>
    </form>
  );
}

export function CopyWeekModal({ open, ...props }: Props) {
  const { t, x } = useI18n();
  return (
    <Modal open={open} onClose={props.onClose} title={x(t.tt.copyTitle(props.from.name))}>
      <CopyWeekForm {...props} />
    </Modal>
  );
}
