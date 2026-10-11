'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { ReportCardSheet } from '@/components/ReportCardSheet';
import { ErrorNote, Note, PageHead, Section, Tag, toast } from '@/components/ui';

/** One report card: the page as it will print, and a box for each comment the signed-in person may write. */
export default function ReportCardPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const { t, x, lang } = useI18n();
  const card = useApi<any>(`/academics/report-cards/${id}`);
  const act = useAction();
  const [texts, setTexts] = useState<Record<string, string>>({});

  const d = card.data;
  // What is typed starts from what is saved, and starts again after each save.
  useEffect(() => {
    if (!d) return;
    setTexts({ ...Object.fromEntries(Object.entries(d.comments.subjects as Record<string, string>).map(([k, v]) => [`s:${k}`, v])), ct: d.comments.classTeacher ?? '', pr: d.comments.principal ?? '' });
  }, [d]);

  if (!d) return <ErrorNote error={card.error && x(card.error)} />;
  const s = d.snapshot;
  const published = d.status === 'PUBLISHED';
  const saved = (key: string) => (key === 'ct' ? d.comments.classTeacher : key === 'pr' ? d.comments.principal : d.comments.subjects[key.slice(2)]) ?? '';

  async function saveComment(key: string) {
    const text = texts[key] ?? '';
    const body = key === 'ct' ? { classTeacherComment: text } : key === 'pr' ? { principalComment: text } : { subjectId: key.slice(2), comment: text };
    if (await act.run(async () => card.setData(await patch(`/academics/report-cards/${id}/comments`, body)))) toast(t.acad.commentSaved);
  }

  async function publish() {
    if (!confirm(t.acad.publishClassConfirm(1))) return;
    if (await act.run(() => post('/academics/report-cards/publish', { ids: [id] }))) {
      toast(t.acad.publishedCards(1));
      await card.reload();
    }
  }

  async function unpublish() {
    if (!confirm(t.acad.unpublishCardConfirm)) return;
    if (await act.run(() => post(`/academics/report-cards/${id}/unpublish`))) {
      toast(t.acad.unpublishedCard);
      await card.reload();
    }
  }

  const box = (key: string, label: string, allowed: boolean) => {
    const changed = (texts[key] ?? '') !== saved(key);
    return (
      <div className="rc-edit" key={key}>
        <label className="small" htmlFor={`rc-${key}`}><b>{label}</b></label>
        <textarea id={`rc-${key}`} className="input" maxLength={600} disabled={!allowed || published || act.busy} value={texts[key] ?? ''} onChange={(e) => setTexts((v) => ({ ...v, [key]: e.target.value }))} />
        {allowed && !published && (
          <div><button type="button" className="btn small" disabled={!changed || act.busy} onClick={() => void saveComment(key)}>{t.acad.saveComment}</button></div>
        )}
      </div>
    );
  };

  const name = lang === 'ar' && s.student.nameAr ? s.student.nameAr : s.student.name;
  return (
    <>
      <PageHead
        crumb={<><Link href="/academics/report-cards">{t.nav.reportCards}</Link><span>/</span><b>{x(name)}</b></>}
        sub={x(`${t.acad.term(s.term)} · ${s.year.name}`)}
        title={<>{x(name)} <Tag tone={published ? 'P' : 'L'}>{t.acad.status[d.status]}</Tag></>}
        actions={
          <>
            <a className="btn" href={`/report-cards/${id}`} target="_blank" rel="noreferrer">{t.acad.printCard}</a>
            {me.role === 'SCHOOL_ADMIN' && !published && <button type="button" className="btn primary" disabled={act.busy} onClick={() => void publish()}>{t.acad.publishCard}</button>}
            {me.role === 'SCHOOL_ADMIN' && published && <button type="button" className="btn danger" disabled={act.busy} onClick={() => void unpublish()}>{t.acad.unpublishCard}</button>}
          </>
        }
      />
      <ErrorNote error={(act.error ?? card.error) && x((act.error ?? card.error)!)} />
      <Note tone={published ? 'warn' : 'info'}>{published ? t.acad.lockedPublished : t.acad.draftNote}</Note>
      <div className="cols wide-narrow">
        <div style={{ minWidth: 0 }}>
          <ReportCardSheet s={s} draft={!published} />
        </div>
        <Section title={t.acad.subjectComment}>
          <div className="panel pad stack" style={{ gap: 16 }}>
            {s.subjects.map((sub: any) => box(`s:${sub.subjectId}`, x(sub.name), d.canEdit.subjects.includes(sub.subjectId)))}
            {box('ct', t.acad.classTeacherComment, d.canEdit.classTeacher)}
            {box('pr', t.acad.principalComment, d.canEdit.principal)}
          </div>
        </Section>
      </div>
    </>
  );
}
