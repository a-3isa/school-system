'use client';
import { useState } from 'react';
import { dateTimeCairo } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { has, useSession } from '@/lib/session';
import { KIND_GLYPH, KIND_TONE, Kind, NoteModal } from './BehaviourNote';
import { Empty, Section, Tag, toast } from './ui';

/** Behaviour on a student's page: this year's totals, the latest notes, and a way to add one. */
export function StudentBehaviour({ student }: { student: { id: string; name: string } }) {
  const { me } = useSession();
  const { t, x, staff } = useI18n();
  const merits = has(me, 'behavior', 'merits');
  const [adding, setAdding] = useState(false);
  const notes = useApi<any[]>(`/behaviour?studentId=${student.id}`);
  const totals = useApi<any[]>(`/behaviour/summary?studentId=${student.id}`);
  const sum = totals.data?.[0];

  return (
    <Section title={t.beh.profile} aside={t.beh.profileAside}>
      <div className="panel">
        <div className="row wrap" style={{ gap: 8, padding: '12px 16px', borderBlockEnd: '1px solid var(--line)' }}>
          {sum && (
            <>
              <Tag tone="P"><span aria-hidden="true">{KIND_GLYPH.PRAISE} </span>{t.beh.praiseN(sum.praise)}</Tag>
              <Tag tone="L"><span aria-hidden="true">{KIND_GLYPH.CONCERN} </span>{t.beh.concernN(sum.concern)}</Tag>
              <Tag tone="A"><span aria-hidden="true">{KIND_GLYPH.INCIDENT} </span>{t.beh.incidentN(sum.incident)}</Tag>
              {merits && <span className="small num muted">{t.beh.totalPoints(sum.points)}</span>}
            </>
          )}
          <span className="grow" />
          <button type="button" className="btn small" onClick={() => setAdding(true)}>{t.beh.addNote}</button>
        </div>
        {notes.data?.length ? (
          notes.data.slice(0, 10).map((n) => {
            const kind = n.kind as Kind;
            return (
              <article key={n.id} className="list-row" style={{ gap: 4, padding: '12px 16px' }}>
                <span className="row wrap">
                  <Tag tone={KIND_TONE[kind]}><span aria-hidden="true">{KIND_GLYPH[kind]} </span>{t.beh.kind[kind]}</Tag>
                  <span className="small muted">{t.beh.cat[n.category] ?? n.category}</span>
                  {merits && n.points != null && <span className="small num">{t.beh.pointsN(n.points)}</span>}
                </span>
                <span style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{x(n.text)}</span>
                <span className="small muted">
                  {x(t.beh.by(n.author ? staff(n.author) : '—', dateTimeCairo(n.occurredAt)))} · {n.visibleToParents ? (n.readByParent ? t.beh.readByParent : t.beh.shared) : t.beh.notShared}
                </span>
              </article>
            );
          })
        ) : notes.data ? (
          <Empty title={t.beh.none}>{t.beh.noneSub}</Empty>
        ) : (
          <Empty>{t.common.loading}</Empty>
        )}
      </div>
      {adding && (
        <NoteModal
          student={student}
          onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); toast(t.beh.saved); await Promise.all([notes.reload(), totals.reload()]); }}
        />
      )}
    </Section>
  );
}
