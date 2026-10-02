'use client';
import Link from 'next/link';
import { Fragment } from 'react';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, Pill, Section } from '@/components/ui';

export default function ClassPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const cls = useApi<any>(`/classes/${id}`);

  if (!cls.data) return <ErrorNote error={cls.error} />;
  const c = cls.data;
  const name = (st: any) => (lang === 'ar' && st.nameAr ? st.nameAr : `${st.firstName} ${st.lastName}`);

  return (
    <>
      <header className="head">
        <div className="head-text" style={{ gap: 4 }}>
          <nav className="crumb"><Link href="/classes">{t.nav.classes}</Link><span>/</span><b><bdi dir="ltr">{c.name}</bdi></b></nav>
          <h1><bdi dir="ltr">{c.name}</bdi></h1>
        </div>
        <div className="facts">
          <span>{t.classes.grade}<b>{c.grade.name}</b></span>
          <span>{t.classes.homeroom}<b>{c.homeroomTeacher?.name ?? '—'}</b></span>
          <span>{t.classes.students}<b className="num">{c.students.length}</b></span>
        </div>
      </header>
      <Section title={t.classes.students}>
        <div className="panel scroll">
          {c.students.length ? (
            <table style={{ minWidth: 560 }}>
              <thead><tr><th>{t.common.name}</th><th>{t.students.code}</th><th>{t.students.parents}</th></tr></thead>
              <tbody>
                {c.students.map((st: any) => (
                  <tr key={st.id}>
                    <td><Link href={`/students/${st.id}`} className="strong">{name(st)}</Link></td>
                    <td className="mono muted"><bdi dir="ltr">{st.code}</bdi></td>
                    <td>
                      {st.guardians.length
                        ? st.guardians.map((g: any, i: number) => (
                            <Fragment key={g.user.id}>
                              {i > 0 && ', '}
                              <Link href={`/parents/${g.user.id}`}>{g.user.name}</Link>
                              <span className="muted small"> · {t.students.rel[g.relation]}</span>
                            </Fragment>
                          ))
                        : <Pill tone="L" glyph="!">{t.students.noParent}</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{t.classes.noStudents}</Empty>
          )}
        </div>
      </Section>
    </>
  );
}
