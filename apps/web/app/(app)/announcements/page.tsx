'use client';
import { FormEvent, useEffect, useState } from 'react';
import { blobUrl, dateTimeCairo, del, patch, post, upload } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Audience, AudiencePicker } from '@/components/AudiencePicker';
import { Modal } from '@/components/Modal';
import { Empty, ErrorNote, Field, PageHead, Tabs, Tag, toast } from '@/components/ui';

type Tab = 'SENT' | 'DRAFT';
const MAX_BYTES = 5 * 1024 * 1024;

export default function AnnouncementsPage() {
  const { me } = useSession();
  const { t, x, staff } = useI18n();
  const isTeacher = me.role === 'TEACHER';
  const canWrite = me.role === 'SCHOOL_ADMIN' || isTeacher;
  const [tab, setTab] = useState<Tab>('SENT');
  const list = useApi<any[]>(`/announcements?status=${tab}`);
  const act = useAction();
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const detail = useApi<any>(opened ? `/announcements/${opened}` : null);

  async function removeDraft(id: string) {
    if (await act.run(() => del(`/announcements/${id}`))) {
      toast(t.ann.deleted);
      await list.reload();
    }
  }

  async function send(id: string) {
    const a = list.data?.find((r) => r.id === id);
    let parents = 0;
    if (a) {
      try {
        parents = (await post('/announcements/preview', { audience: a.audience })).parents;
      } catch {
        /* the send below says what is wrong */
      }
    }
    if (!window.confirm(t.ann.confirmSend(parents))) return;
    const sent = await act.run(async () => {
      const res = await post(`/announcements/${id}/send`);
      toast(t.ann.sentToast(res.recipients));
    });
    if (sent) await list.reload();
  }

  async function openFile(id: string) {
    window.open(await blobUrl(`/announcements/${id}/file`), '_blank', 'noopener');
  }

  return (
    <>
      <PageHead
        sub={t.ann.sub}
        title={t.nav.announcements}
        actions={
          <>
            <Tabs label={t.nav.announcements} value={tab} onChange={(v) => { setTab(v); setOpened(null); }} items={[['SENT', t.ann.tabs.SENT], ['DRAFT', t.ann.tabs.DRAFT]]} />
            {canWrite && <button type="button" className="btn primary" onClick={() => setEditing('new')}>{t.ann.new}</button>}
          </>
        }
      />
      <ErrorNote error={(list.error ?? act.error) && x((list.error ?? act.error)!)} />
      <section className="panel">
        {list.data?.length ? (
          list.data.map((a) => (
            <article key={a.id} className="list-row" style={{ gap: 8, padding: '18px 20px' }}>
              <div className="row wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
                <div className="stack grow" style={{ minWidth: 0 }}>
                  <span className="row wrap">
                    {a.priority === 'EMERGENCY' && <Tag tone="A">{t.ann.urgent}</Tag>}
                    {!a.sentAt && <Tag tone="E">{t.ann.draftLabel}</Tag>}
                    <strong style={{ fontSize: 16 }}>{x(a.title)}</strong>
                  </span>
                  <span style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{x(a.body)}</span>
                  <span className="small muted">
                    {t.audience.summary(a.audience.kind, a.audience.ids.length)} · {x(t.ann.by(a.author ? staff(a.author) : '—', dateTimeCairo(a.sentAt ?? a.createdAt)))}
                    {a.sentAt ? ` · ${t.ann.readBy(a.readCount, a.recipients)}` : ''}
                  </span>
                </div>
                <div className="row wrap" style={{ flex: '0 0 auto' }}>
                  {a.hasFile && <button type="button" className="btn small" onClick={() => void openFile(a.id)}>📎 {t.ann.openFile}</button>}
                  {a.sentAt && me.role === 'SCHOOL_ADMIN' && (
                    <button type="button" className="btn small" aria-expanded={opened === a.id} onClick={() => setOpened(opened === a.id ? null : a.id)}>{t.ann.readers}</button>
                  )}
                  {!a.sentAt && canWrite && (
                    <>
                      <button type="button" className="btn small" onClick={() => setEditing(a)}>{t.ann.edit}</button>
                      <button type="button" className="btn small" disabled={act.busy} onClick={() => void removeDraft(a.id)}>{t.ann.delete}</button>
                      <button type="button" className="btn primary small" disabled={act.busy} onClick={() => void send(a.id)}>{t.ann.sendNow}</button>
                    </>
                  )}
                </div>
              </div>
              {opened === a.id && detail.data?.reads && (
                <ul className="readers small">
                  {detail.data.reads.map((r: any) => (
                    <li key={r.parent.id}>
                      <b>{x(r.parent.name)}</b> · <span className="muted">{r.readAt ? x(t.ann.readAt(dateTimeCairo(r.readAt))) : t.ann.notRead}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))
        ) : list.data ? (
          <Empty title={t.ann.none}>{t.ann.noneSub}</Empty>
        ) : (
          <Empty>{t.common.loading}</Empty>
        )}
      </section>
      {editing && <Editor key={editing === 'new' ? 'new' : editing.id} draft={editing === 'new' ? null : editing} teacher={isTeacher} onClose={() => setEditing(null)} onSaved={async (sentTo) => {
        setEditing(null);
        if (sentTo !== null) { toast(t.ann.sentToast(sentTo)); setTab('SENT'); } else { toast(t.ann.saved); setTab('DRAFT'); }
        await list.reload();
      }} />}
    </>
  );
}

function Editor({ draft, teacher, onClose, onSaved }: { draft: any | null; teacher: boolean; onClose: () => void; onSaved: (sentTo: number | null) => void | Promise<void> }) {
  const { t, x } = useI18n();
  const [title, setTitle] = useState<string>(draft?.title ?? '');
  const [body, setBody] = useState<string>(draft?.body ?? '');
  const [audience, setAudience] = useState<Audience>(draft ? { kind: draft.audience.kind, ids: draft.audience.ids } : { kind: teacher ? 'CLASSES' : 'SCHOOL', ids: [] });
  const [file, setFile] = useState<File | null>(null);
  const [reach, setReach] = useState<number | null>(null);
  const act = useAction();

  // How many parents it would reach, so the person sending knows before they do.
  useEffect(() => {
    setReach(null);
    const ready = audience.kind === 'SCHOOL' || audience.ids.length > 0;
    if (!ready) return;
    let live = true;
    post('/announcements/preview', { audience }).then((r) => live && setReach(r.parents), () => live && setReach(null));
    return () => { live = false; };
  }, [audience]);

  async function save(sendNow: boolean) {
    let sentTo: number | null = null;
    const ok = await act.run(async () => {
      const payload = { title: title.trim(), body: body.trim(), audience };
      const saved = draft ? await patch(`/announcements/${draft.id}`, payload) : await post('/announcements', payload);
      if (file) await upload(`/announcements/${saved.id}/file`, file, {}, 'PUT');
      if (sendNow) {
        if (reach !== null && !window.confirm(t.ann.confirmSend(reach))) throw new Error('');
        sentTo = (await post(`/announcements/${saved.id}/send`)).recipients;
      }
    });
    if (ok) await onSaved(sentTo);
  }

  const ready = title.trim() && body.trim() && (audience.kind === 'SCHOOL' || audience.ids.length > 0);
  return (
    <Modal
      open
      onClose={onClose}
      title={draft ? t.ann.edit : t.ann.new}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button type="button" className="btn" disabled={act.busy || !ready} onClick={() => void save(false)}>{t.ann.saveDraft}</button>
          <button type="button" className="btn primary" disabled={act.busy || !ready} onClick={() => void save(true)}>{t.ann.sendNow}</button>
        </>
      }
    >
      <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); void save(false); }} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <ErrorNote error={act.error && x(act.error)} />
        <Field label={t.ann.fieldTitle} id="ann-title">
          <input id="ann-title" className="input" maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t.ann.fieldBody} id="ann-body">
          <textarea id="ann-body" className="input" rows={5} maxLength={4000} required value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="field">
          {t.audience.label}
          <AudiencePicker value={audience} onChange={setAudience} only={teacher ? ['CLASSES'] : undefined} />
          {reach !== null && <span className="help">{t.ann.confirmSend(reach)}</span>}
        </div>
        <Field label={t.ann.attachment} id="ann-file" help={draft?.hasFile && !file ? `📎 ${draft.fileName ?? ''}` : undefined}>
          <input id="ann-file" className="input" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > MAX_BYTES) { act.setError(t.inbox.tooBig); e.target.value = ''; } else setFile(f);
          }} />
        </Field>
      </form>
    </Modal>
  );
}
