'use client';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, PageHead, Section, Tag } from '@/components/ui';

/** Midterms and finals for the school year, by day: when, which class, which subject, which room. */
export default function ExamsPage() {
  const { t, x, day, lang } = useI18n();
  const grades = useApi<any[]>('/grades');
  const [gradeId, setGradeId] = useState('');
  const exams = useApi<any[]>(`/academics/exams${gradeId ? `?gradeId=${gradeId}` : ''}`);

  const byDay = new Map<string, any[]>();
  for (const e of exams.data ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  return (
    <>
      <PageHead
        sub={t.acad.examsSub}
        title={t.nav.exams}
        actions={
          <>
            <select className="input" aria-label={t.acad.yearGroup} value={gradeId} onChange={(e) => setGradeId(e.target.value)} style={{ maxWidth: 240 }}>
              <option value="">{t.acad.allYearGroups}</option>
              {(grades.data ?? []).map((g) => <option key={g.id} value={g.id}>{lang === 'ar' && g.nameAr ? g.nameAr : x(g.name)}</option>)}
            </select>
            <button type="button" className="btn no-print" onClick={() => window.print()}>{t.acad.print}</button>
          </>
        }
      />
      <ErrorNote error={(exams.error ?? grades.error) && x((exams.error ?? grades.error)!)} />
      {exams.data && !exams.data.length && <Empty title={t.acad.noExams}>{t.acad.noExamsSub}</Empty>}
      {[...byDay.entries()].map(([date, rows]) => (
        <Section key={date} title={day(date)}>
          <div className="panel scroll">
            <table className="exam-table">
              <thead>
                <tr><th>{t.acad.time}</th><th>{t.acad.class}</th><th>{t.acad.subject}</th><th>{t.acad.exam}</th><th>{t.acad.room}</th></tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="num"><bdi dir="ltr">{e.startTime}–{e.endTime}</bdi></td>
                    <td>{x(e.class.name)}</td>
                    <td>{x(e.subject.name)}</td>
                    <td>{x(e.title)} <Tag tone={e.kind === 'FINAL' ? 'A' : 'L'}>{t.acad.kind[e.kind]}</Tag></td>
                    <td>{e.room ? x(e.room.name) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
    </>
  );
}
