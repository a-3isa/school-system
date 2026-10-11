'use client';
import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, PageHead, Tabs, Tag, toast } from '@/components/ui';

/** Report cards for one class and term: prepare them, see what each still needs, and publish. */
export default function ReportCardsPage() {
  const { me } = useSession();
  const { t, x, lang } = useI18n();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const teacher = me.role === 'TEACHER';
  // A teacher chooses among the classes they teach; Student Affairs and the social worker among all.
  const teaching = useApi<any[]>(teacher ? '/academics/teaching' : null);
  const everyClass = useApi<any[]>(teacher ? null : '/classes');
  const classes: { id: string; name: string }[] = teacher
    ? [...new Map((teaching.data ?? []).map((p) => [p.classId, { id: p.classId, name: p.className }])).values()]
    : (everyClass.data ?? []).map((c) => ({ id: c.id, name: c.name }));

  const [classId, setClassId] = useState('');
  const [termSel, setTermSel] = useState<'1' | '2' | null>(null);
  const cls = classes.find((c) => c.id === classId) ?? classes[0];
  const list = useApi<any>(cls ? `/academics/report-cards?classId=${cls.id}${termSel ? `&term=${termSel}` : ''}` : null);
  const act = useAction();

  const term = String(termSel ?? list.data?.term ?? 1) as '1' | '2';
  const cards: any[] = list.data?.cards ?? [];
  const drafts = cards.filter((c) => c.status === 'DRAFT');
  const yearId: string | undefined = list.data?.year?.id;

  async function prepare() {
    let created = 0;
    if (await act.run(async () => { created = (await post('/academics/report-cards/generate', { classId: cls!.id, yearId, term: Number(term) })).created; })) {
      toast(t.acad.prepared(created));
      await list.reload();
    }
  }

  async function publishAll() {
    if (!drafts.length) return toast(t.acad.nothingToPublish);
    if (!confirm(t.acad.publishClassConfirm(drafts.length))) return;
    let n = 0;
    if (await act.run(async () => { n = (await post('/academics/report-cards/publish', { classId: cls!.id, yearId, term: Number(term) })).published; })) {
      toast(t.acad.publishedCards(n));
      await list.reload();
    }
  }

  const err = list.error ?? act.error ?? teaching.error ?? everyClass.error;
  return (
    <>
      <PageHead
        sub={t.acad.cardsSub}
        title={t.nav.reportCards}
        actions={
          cls ? (
            <>
              <select className="input" aria-label={t.common.class} value={cls.id} onChange={(e) => setClassId(e.target.value)} style={{ maxWidth: 220 }}>
                {classes.map((c) => <option key={c.id} value={c.id}>{x(c.name)}</option>)}
              </select>
              <Tabs label={t.nav.reportCards} value={term} onChange={setTermSel} items={[['1', t.acad.term(1)], ['2', t.acad.term(2)]]} />
              {(isAdmin || teacher) && yearId && <button type="button" className="btn" disabled={act.busy} onClick={() => void prepare()}>{t.acad.prepare}</button>}
              {isAdmin && <button type="button" className="btn primary" disabled={act.busy || !drafts.length} onClick={() => void publishAll()}>{t.acad.publishClass}</button>}
            </>
          ) : undefined
        }
      />
      <ErrorNote error={err && x(err)} />
      {!cls && (teaching.data || everyClass.data) && <Empty title={t.acad.chooseClass} />}
      {cls && !list.data && !err && <Empty>{t.common.loading}</Empty>}
      {cls && list.data && !cards.length && <Empty title={t.acad.noCards}>{t.acad.noCardsSub}</Empty>}
      {cards.length > 0 && (
        <section className="panel scroll">
          <table>
            <thead>
              <tr><th>{t.acad.student}</th><th>{t.acad.statusCol}</th><th>{t.acad.overall}</th><th /><th /></tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td className="strong">{x(lang === 'ar' && c.nameAr ? c.nameAr : c.name)}<span className="sub num"><bdi dir="ltr">{c.code}</bdi></span></td>
                  <td><Tag tone={c.status === 'PUBLISHED' ? 'P' : 'L'}>{t.acad.status[c.status]}</Tag></td>
                  <td className="num">{c.percent === null ? <span className="muted">—</span> : <>{x(`${c.percent}%`)} <Tag tone="N">{x(lang === 'ar' ? c.band.labelAr : c.band.label)}</Tag></>}</td>
                  <td className="small muted">{c.status === 'PUBLISHED' ? '' : t.acad.waiting(c.missing.subjects, c.missing.classTeacher, c.missing.principal)}</td>
                  <td>
                    <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                      <Link className="btn small" href={`/academics/report-cards/${c.id}`}>{t.acad.open}</Link>
                      <a className="btn small" href={`/report-cards/${c.id}`} target="_blank" rel="noreferrer">{t.acad.printCard}</a>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
