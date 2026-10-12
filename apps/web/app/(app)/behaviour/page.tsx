'use client';
import { useState } from 'react';
import { dateTimeCairo, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { has, useSession } from '@/lib/session';
import { KIND_GLYPH, KIND_TONE, Kind, NoteModal } from '@/components/BehaviourNote';
import { Empty, ErrorNote, Field, PageHead, Tabs, Tag, toast } from '@/components/ui';

type Tab = 'ALL' | Kind;

export default function BehaviourPage() {
  const { me } = useSession();
  const { t, x, staff } = useI18n();
  const merits = has(me, 'behavior', 'merits');
  const [tab, setTab] = useState<Tab>('ALL');
  const [classId, setClassId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const act = useAction();

  // The classes a person can choose come from the students they may write about (a teacher's own classes).
  const students = useApi<any[]>('/behaviour/students');
  const classes = [...new Map((students.data ?? []).filter((s) => s.class).map((s) => [s.class.id, s.class.name])).entries()];
  const query = new URLSearchParams({ ...(tab !== 'ALL' ? { kind: tab } : {}), ...(classId ? { classId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const list = useApi<any[]>(`/behaviour${query ? `?${query}` : ''}`);

  async function withdraw(id: string) {
    if (!confirm(t.beh.confirmWithdraw)) return;
    if (await act.run(() => post(`/behaviour/${id}/withdraw`))) {
      toast(t.beh.withdrawn);
      await list.reload();
    }
  }

  return (
    <>
      <PageHead
        sub={t.beh.sub}
        title={t.nav.behaviourNotes}
        actions={<button type="button" className="btn primary" onClick={() => setEditing('new')}>{t.beh.new}</button>}
      />
      <div className="toolbar">
        <Tabs label={t.nav.behaviourNotes} value={tab} onChange={setTab} items={[['ALL', t.beh.tabs.ALL], ['PRAISE', t.beh.tabs.PRAISE], ['CONCERN', t.beh.tabs.CONCERN], ['INCIDENT', t.beh.tabs.INCIDENT]]} />
        <select className="input" aria-label={t.common.class} value={classId} onChange={(e) => setClassId(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">{t.common.allClasses}</option>
          {classes.map(([id, name]) => <option key={id} value={id}>{x(name)}</option>)}
        </select>
        <Field label={t.beh.from} id="beh-from"><input id="beh-from" className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 180 }} /></Field>
        <Field label={t.beh.to} id="beh-to"><input id="beh-to" className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 180 }} /></Field>
      </div>
      <ErrorNote error={(list.error ?? act.error) && x((list.error ?? act.error)!)} />
      <section className="panel">
        {list.data?.length ? (
          list.data.map((n) => {
            const kind = n.kind as Kind;
            const mine = me.role !== 'TEACHER' || n.authorId === me.id;
            return (
              <article key={n.id} className="list-row" style={{ gap: 6, padding: '16px 20px' }}>
                <div className="row wrap" style={{ alignItems: 'flex-start' }}>
                  <div className="stack grow" style={{ minWidth: 0 }}>
                    <span className="row wrap">
                      <Tag tone={KIND_TONE[kind]}><span aria-hidden="true">{KIND_GLYPH[kind]} </span>{t.beh.kind[kind]}</Tag>
                      {n.kind === 'INCIDENT' && n.severity && <Tag tone="A">{t.beh.severity[n.severity]}</Tag>}
                      <strong>{x(`${n.student.firstName} ${n.student.lastName}`)}</strong>
                      {n.student.class && <span className="small muted">{x(n.student.class.name)}</span>}
                      <span className="small muted">· {t.beh.cat[n.category] ?? n.category}</span>
                      {merits && n.points != null && <span className="small num">{t.beh.pointsN(n.points)}</span>}
                    </span>
                    <span style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{x(n.text)}</span>
                    {n.kind === 'INCIDENT' && (n.actionTaken || n.place) && (
                      <span className="small muted">{[n.place && `${t.beh.place}: ${n.place}`, n.actionTaken && `${t.beh.actionTaken}: ${n.actionTaken}`].filter(Boolean).map((s) => x(s as string)).join(' · ')}</span>
                    )}
                    <span className="small muted">
                      {x(t.beh.by(n.author ? staff(n.author) : '—', dateTimeCairo(n.occurredAt)))} · {n.visibleToParents ? (n.readByParent ? t.beh.readByParent : t.beh.shared) : t.beh.notShared}
                    </span>
                  </div>
                  {mine && (
                    <div className="row wrap" style={{ flex: '0 0 auto' }}>
                      <button type="button" className="btn small" onClick={() => setEditing(n)}>{t.beh.edit}</button>
                      <button type="button" className="btn small" disabled={act.busy} onClick={() => void withdraw(n.id)}>{t.beh.withdraw}</button>
                    </div>
                  )}
                </div>
              </article>
            );
          })
        ) : list.data ? (
          <Empty title={t.beh.none}>{t.beh.noneSub}</Empty>
        ) : (
          <Empty>{t.common.loading}</Empty>
        )}
      </section>
      {editing && (
        <NoteModal
          key={editing === 'new' ? 'new' : editing.id}
          note={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); toast(t.beh.saved); await list.reload(); }}
        />
      )}
    </>
  );
}
