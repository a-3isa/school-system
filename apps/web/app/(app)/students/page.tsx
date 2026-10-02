'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, PageHead, Pill } from '@/components/ui';
import { ClassSelect } from '@/components/ClassPicker';

export default function StudentsPage() {
  const { me } = useSession();
  const { t, lang } = useI18n();
  const router = useRouter();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const students = useApi<any[]>(`/students?active=true${q ? `&q=${encodeURIComponent(q)}` : ''}${classId ? `&classId=${classId}` : ''}`);
  const classes = useApi<any[]>('/classes');
  return (
    <>
      <PageHead
        sub={students.data ? t.students.sub(students.data.length) : undefined}
        title={isAdmin ? t.nav.students : t.students.titleStaff}
        actions={isAdmin && (
          <>
            <Link className="btn primary" href="/students/new">{t.students.add}</Link>
            <Link className="btn" href="/students/import">{t.nav.import}</Link>
          </>
        )}
      />
      <input type="search" className="input" aria-label={t.students.search} placeholder={t.students.search} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row wrap" style={{ gap: 10 }}>
        <span style={{ minWidth: 200 }}><ClassSelect classes={classes.data} value={classId} onChange={setClassId} empty={t.common.allClasses} /></span>
      </div>
      <ErrorNote error={students.error} />
      <div className="panel scroll">
        {students.data?.length ? (
          <table style={{ minWidth: 520 }}>
            <thead><tr><th>{t.common.name}</th><th>{t.students.code}</th><th>{t.common.class}</th></tr></thead>
            <tbody>
              {students.data.map((s) => {
                const latin = `${s.firstName} ${s.lastName}`;
                const main = lang === 'ar' && s.nameAr ? s.nameAr : latin;
                const other = lang === 'ar' ? (s.nameAr ? latin : null) : s.nameAr;
                return (
                  <tr key={s.id} className="click" onClick={() => router.push(`/students/${s.id}`)}>
                    <td>
                      <Link href={`/students/${s.id}`} className="strong" style={{ color: 'var(--ink)', textDecoration: 'none' }}>{main}</Link>
                      {other && <span className="sub" dir="auto">{other}</span>}
                      {!s.guardians.length && <span className="sub"><Pill tone="L" glyph="!">{t.students.noParent}</Pill></span>}
                    </td>
                    <td className="mono muted"><bdi dir="ltr">{s.code}</bdi></td>
                    <td>
                      {s.class ? <Link href={`/classes/${s.class.id}`} onClick={(e) => e.stopPropagation()}><bdi dir="ltr">{s.class.name}</bdi></Link> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>{students.loading ? t.common.loading : t.students.noMatch}</Empty>
        )}
      </div>
    </>
  );
}
