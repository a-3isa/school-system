'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, PageHead, Pill } from '@/components/ui';

export default function ParentsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState('');
  const parents = useApi<any[]>(`/parents${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const childName = (c: any) => (lang === 'ar' && c.student.nameAr ? c.student.nameAr : `${c.student.firstName} ${c.student.lastName}`);

  return (
    <>
      <PageHead sub={parents.data ? t.parents.sub(parents.data.length) : undefined} title={t.nav.parents} />
      <input type="search" className="input" aria-label={t.parents.search} placeholder={t.parents.search} value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorNote error={parents.error} />
      <div className="panel scroll">
        {parents.data?.length ? (
          <table style={{ minWidth: 720 }}>
            <thead><tr><th>{t.common.name}</th><th>{t.parents.children}</th><th>{t.common.email}</th><th>{t.parents.mobile}</th></tr></thead>
            <tbody>
              {parents.data.map((p) => (
                <tr key={p.id} className="click" onClick={() => router.push(`/parents/${p.id}`)}>
                  <td>
                    <Link href={`/parents/${p.id}`} className="strong" style={{ color: 'var(--ink)', textDecoration: 'none' }}>{p.name}</Link>
                    <span className="sub">
                      {p.emailVerifiedAt ? <Pill tone="P" glyph="✓">{t.student.signedUp}</Pill> : <Pill tone="E" glyph="–">{t.student.notSignedUp}</Pill>}
                    </span>
                  </td>
                  <td>
                    {p.children.length
                      ? p.children.map((c: any, i: number) => (
                          <Fragment key={c.student.id}>
                            {i > 0 && ', '}
                            <Link href={`/students/${c.student.id}`} onClick={(e) => e.stopPropagation()}>{childName(c)}</Link>
                            <span className="muted small"> · {t.students.rel[c.relation]}{c.student.class ? <> · <bdi dir="ltr">{c.student.class.name}</bdi></> : null}</span>
                          </Fragment>
                        ))
                      : <span className="muted">{t.parents.noChildren}</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}><bdi dir="ltr">{p.email ?? '—'}</bdi></td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}><bdi dir="ltr">{p.phone ?? '—'}</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{parents.loading ? t.common.loading : t.parents.noMatch}</Empty>
        )}
      </div>
    </>
  );
}
