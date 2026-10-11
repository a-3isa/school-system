'use client';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, blobUrl, dateTimeCairo, post, timeCairo, todayCairo, upload } from '@/lib/api';
import { useAction, useApi, useEvery } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useChatConnected, useChatEvent } from '@/lib/socket';
import { Empty, ErrorNote, PageHead, Tabs } from '@/components/ui';

const MAX_BYTES = 5 * 1024 * 1024;

/** Time for today's messages, date and time for older ones. */
const when = (iso: string) => (new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(iso)) === todayCairo() ? timeCairo(iso) : dateTimeCairo(iso));

export default function MessagesPage() {
  const { me } = useSession();
  const { t, x, staff } = useI18n();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const [scope, setScope] = useState<'mine' | 'school'>('mine');
  const [openId, setOpenId] = useState<string | null>(null);
  const threads = useApi<any[]>(`/threads?scope=${scope}`);
  const connected = useChatConnected();

  // A new message or a read receipt changes the list's last line and unread counts.
  useChatEvent('message', () => void threads.reload());
  useChatEvent('read', () => void threads.reload());
  useEvery(30_000, threads.reload, !connected);

  return (
    <>
      <PageHead
        sub={t.inbox.sub}
        title={t.nav.inbox}
        actions={isAdmin ? <Tabs label={t.nav.inbox} value={scope} onChange={(v) => { setScope(v); setOpenId(null); }} items={[['mine', t.inbox.mine], ['school', t.inbox.school]]} /> : undefined}
      />
      <ErrorNote error={threads.error && x(threads.error)} />
      <div className={`inbox${openId ? ' reading' : ''}`}>
        <section className="panel inbox-list" aria-label={t.nav.inbox}>
          {threads.data?.length ? (
            threads.data.map((th) => (
              <button key={th.id} type="button" className="list-row inbox-row" aria-current={openId === th.id ? 'true' : undefined} onClick={() => setOpenId(th.id)}>
                <span className="inbox-who">
                  <b>{x(th.parent.name)}</b>
                  <span className="small muted">{x(`${t.inbox.about(th.student.firstName)}${th.student.class ? ` · ${th.student.class.name}` : ''}`)}</span>
                  {scope === 'school' && <span className="small muted">{staff(th.staff)}</span>}
                  {th.last && <span className="inbox-last">{x(th.last.body)}</span>}
                </span>
                <span className="inbox-meta">
                  {th.last && <span className="small muted num">{when(th.last.createdAt)}</span>}
                  {th.unread > 0 && <span className="count" aria-label={String(th.unread)}>{th.unread}</span>}
                </span>
              </button>
            ))
          ) : threads.data ? (
            <Empty title={t.inbox.none}>{t.inbox.noneSub}</Empty>
          ) : (
            <Empty>{t.common.loading}</Empty>
          )}
        </section>
        <section className="panel inbox-thread">
          {openId ? (
            <ThreadView key={openId} id={openId} connected={connected} onBack={() => setOpenId(null)} onActivity={() => void threads.reload()} />
          ) : (
            <Empty>{t.inbox.choose}</Empty>
          )}
        </section>
      </div>
    </>
  );
}

function ThreadView({ id, connected, onBack, onActivity }: { id: string; connected: boolean; onBack: () => void; onActivity: () => void }) {
  const { t, x, staff } = useI18n();
  const header = useApi<any>(`/threads/${id}`);
  const [messages, setMessages] = useState<any[]>([]); // oldest first
  const [more, setMore] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const act = useAction();
  const end = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const { me } = useSession();
  const parentId: string | undefined = header.data?.parent.id;

  const markRead = useCallback(async () => {
    try {
      await post(`/threads/${id}/read`);
      onActivity();
    } catch {
      /* not worth interrupting a conversation for */
    }
  }, [id, onActivity]);

  const load = useCallback(async () => {
    const rows = await api<any[]>(`/threads/${id}/messages`); // newest first
    // Keep what is already on screen (older pages included) and add what is new.
    setMessages((old) => {
      const byId = new Map(old.map((m) => [m.id, m]));
      for (const m of rows) byId.set(m.id, m);
      return [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    });
    if (first.current) setMore(rows.length === 50);
    first.current = false;
    void markRead();
  }, [id, markRead]);

  useEffect(() => {
    void load();
  }, [load]);
  useEvery(30_000, load, !connected);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useChatEvent<{ threadId: string; message: any }>('message', ({ threadId, message }) => {
    if (threadId !== id) return;
    setMessages((old) => (old.some((m) => m.id === message.id) ? old : [...old, message]));
    if (message.senderId === parentId) void markRead();
  });
  useChatEvent<{ threadId: string; at: string }>('read', ({ threadId, at }) => {
    if (threadId !== id) return;
    setMessages((old) => old.map((m) => (m.senderId !== parentId && !m.readAt ? { ...m, readAt: at } : m)));
  });

  async function older() {
    const rows = await api<any[]>(`/threads/${id}/messages?before=${encodeURIComponent(messages[0].createdAt)}`);
    setMessages((old) => [...[...rows].reverse(), ...old]);
    setMore(rows.length === 50);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim() && !file) return;
    const ok = await act.run(async () => {
      const sent = file ? await upload(`/threads/${id}/messages`, file, text.trim() ? { body: text.trim() } : {}) : await post(`/threads/${id}/messages`, { body: text.trim() });
      setMessages((old) => (old.some((m) => m.id === sent.id) ? old : [...old, sent]));
    });
    if (ok) {
      setText('');
      setFile(null);
      onActivity();
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const open = async (m: any) => window.open(await blobUrl(`/threads/${id}/messages/${m.id}/file`), '_blank', 'noopener');
  const h = header.data;

  return (
    <>
      <div className="thread-head">
        <button type="button" className="btn small thread-back" onClick={onBack}>← {t.inbox.back}</button>
        {h && (
          <span className="stack" style={{ gap: 2 }}>
            <b>{x(h.parent.name)}</b>
            <span className="small muted">{x(`${t.inbox.about(h.student.firstName)}${h.student.class ? ` · ${h.student.class.name}` : ''} · ${staff(h.staff)}`)}</span>
          </span>
        )}
        <span className="small muted" style={{ marginInlineStart: 'auto' }}>{connected ? t.inbox.live : t.inbox.offline}</span>
      </div>
      <div className="bubbles" role="log" aria-live="polite">
        {more && <button type="button" className="btn small" style={{ alignSelf: 'center' }} onClick={() => void older()}>{t.inbox.earlier}</button>}
        {messages.map((m) => {
          const mine = !!parentId && m.senderId !== parentId;
          return (
            <div key={m.id} className={`bubble${mine ? ' mine' : ''}`}>
              {m.body && <span className="bubble-text">{x(m.body)}</span>}
              {m.hasFile && <button type="button" className="link-btn" onClick={() => void open(m)}>📎 {t.inbox.openFile}</button>}
              <span className="bubble-meta small num">{when(m.createdAt)}{mine && m.readAt ? ` · ${t.inbox.seen}` : ''}</span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <ErrorNote error={act.error && x(act.error)} />
      {h?.canReply ? (
        <form className="composer" onSubmit={(e) => void send(e)}>
          <textarea className="input" rows={2} maxLength={2000} placeholder={t.inbox.write} aria-label={t.inbox.write} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          <div className="composer-actions">
            <label className="btn small" title={t.inbox.attach}>
              📎 {file ? file.name : t.inbox.attach}
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (f && f.size > MAX_BYTES) act.setError(t.inbox.tooBig);
                else setFile(f);
              }} />
            </label>
            {file && <button type="button" className="btn small" onClick={() => setFile(null)}>{t.inbox.remove}</button>}
            <button className="btn primary" type="submit" disabled={act.busy || (!text.trim() && !file)}>{t.inbox.send}</button>
          </div>
        </form>
      ) : h ? (
        <p className="note-bar small muted">{me.role === 'SCHOOL_ADMIN' ? t.inbox.readOnly : t.inbox.closed}</p>
      ) : null}
    </>
  );
}
