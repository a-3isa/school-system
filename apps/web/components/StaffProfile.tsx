'use client';
import Link from 'next/link';
import { Fragment } from 'react';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Dict } from '@/lib/strings';
import { Empty, ErrorNote, Kpi, PageHead, Section, Tag } from './ui';

/**
 * A member of staff's profile. For a teacher it shows what they teach (each class and subject with its
 * lessons a week, from the timetable), the classes they lead, and their week. Student Affairs opens any
 * profile; a teacher opens their own.
 */
export function StaffProfile({ id, own }: { id: string; own?: boolean }) {
  const { t, x, staff, subject, lang } = useI18n();
  const person = useApi<any>(`/staff/${id}`);
  const week = useApi<any[]>(person.data?.teaching ? `/timetable?teacherId=${id}` : null);
  const periods = useApi<any[]>(person.data?.teaching ? '/periods' : null);
  const school = useApi<any>(person.data?.teaching ? '/school' : null);

  if (!person.data) return <ErrorNote error={person.error && x(person.error)} />;
  const p = person.data;
  const teaching = p.teaching as { lessonsPerWeek: number; homerooms: any[]; assignments: any[] } | null;
  const roleName = t.roles[p.role as keyof Dict['roles']] ?? p.role;
  const days: number[] = school.data?.schoolDays ?? [0, 1, 2, 3, 4];
  const sortedPeriods = [...(periods.data ?? [])].sort((a, b) => a.number - b.number);
  const at = (d: number, periodId: string) => week.data?.find((e) => e.dayOfWeek === d && e.periodId === periodId);
  const gradeName = (a: { gradeName: string; gradeNameAr: string | null }) => (lang === 'ar' && a.gradeNameAr ? a.gradeNameAr : a.gradeName);
  const classes = teaching ? new Set(teaching.assignments.map((a) => a.classId)).size : 0;
  const subjects = teaching ? new Set(teaching.assignments.map((a) => a.subjectId)).size : 0;

  return (
    <>
      <PageHead
        crumb={own ? undefined : <><Link href="/staff">{t.prof.back}</Link><span>/</span><b>{staff(p)}</b></>}
        sub={roleName}
        title={<>{staff(p)} {!p.active && <Tag tone="A">{t.prof.canNotSignIn}</Tag>}</>}
      />
      <section className="panel pad">
        <dl className="kv">
          <dt>{t.common.email}</dt><dd><bdi dir="ltr">{p.email}</bdi></dd>
          <dt>{t.prof.mobile}</dt><dd>{p.phone ? <bdi dir="ltr">{p.phone}</bdi> : <span className="muted">—</span>}</dd>
        </dl>
      </section>

      {!teaching && <p className="muted">{t.prof.notTeacher}</p>}
      {teaching && (
        <>
          <div className="kpis">
            <Kpi label={t.prof.lessonsWeek} value={<span className="num">{teaching.lessonsPerWeek}</span>} />
            <Kpi label={t.prof.classesN} value={<span className="num">{classes}</span>} />
            <Kpi label={t.prof.subjectsN} value={<span className="num">{subjects}</span>} />
          </div>
          {teaching.homerooms.length > 0 && (
            <div className="row wrap" style={{ gap: 8 }}>
              <b className="small">{t.prof.classTeacherOf}</b>
              {teaching.homerooms.map((c) => <Tag key={c.id} tone="N">{x(c.name)}</Tag>)}
            </div>
          )}

          <Section title={t.prof.teaches}>
            <div className="panel scroll">
              {teaching.assignments.length ? (
                <table>
                  <thead><tr><th>{t.prof.classCol}</th><th>{t.prof.subjectCol}</th><th className="num">{t.prof.lessonsCol}</th></tr></thead>
                  <tbody>
                    {teaching.assignments.map((a) => (
                      <tr key={`${a.classId}:${a.subjectId}`}>
                        <td className="strong">{x(a.className)}<span className="sub">{x(gradeName(a))}</span></td>
                        <td>{x(subject({ name: a.subjectName, nameAr: a.subjectNameAr }))}</td>
                        <td className="num">{a.lessons}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title={t.prof.none}>{t.prof.noneSub}</Empty>
              )}
            </div>
          </Section>

          {sortedPeriods.length > 0 && teaching.assignments.length > 0 && (
            <Section title={t.prof.week}>
              <div className="panel scroll">
                <div className="tt" style={{ gridTemplateColumns: `92px repeat(${days.length}, minmax(130px, 1fr))` }}>
                  <span className="h" />
                  {days.map((d) => <span key={d} className="h">{t.days[d]}</span>)}
                  {sortedPeriods.map((per) => (
                    <Fragment key={per.id}>
                      <span className="p"><b>{t.lessons.p(per.number)}</b><span className="ltr">{per.startTime}–{per.endTime}</span></span>
                      {days.map((d) => {
                        const e = at(d, per.id);
                        return (
                          <div key={d} className="c">
                            {e && (
                              <div className="lessoncell">
                                <b>{x(`${e.class.name} · ${subject(e.subject)}`)}</b>
                                <span>{e.room.name}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </Section>
          )}
        </>
      )}
    </>
  );
}
