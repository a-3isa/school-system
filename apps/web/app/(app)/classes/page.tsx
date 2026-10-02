'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, PageHead } from '@/components/ui';

export default function ClassesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const classes = useApi<any[]>('/classes');

  return (
    <>
      <PageHead sub={classes.data ? t.classes.sub(classes.data.length) : undefined} title={t.nav.classes} />
      <ErrorNote error={classes.error} />
      <div className="panel scroll">
        {classes.data?.length ? (
          <table style={{ minWidth: 520 }}>
            <thead><tr><th>{t.common.class}</th><th>{t.classes.grade}</th><th>{t.classes.homeroom}</th><th>{t.classes.students}</th></tr></thead>
            <tbody>
              {classes.data.map((c) => (
                <tr key={c.id} className="click" onClick={() => router.push(`/classes/${c.id}`)}>
                  <td><Link href={`/classes/${c.id}`} className="strong" style={{ color: 'var(--ink)', textDecoration: 'none' }}><bdi dir="ltr">{c.name}</bdi></Link></td>
                  <td>{c.grade.name}</td>
                  <td>{c.homeroomTeacher?.name ?? <span className="muted">{t.classes.noHomeroom}</span>}</td>
                  <td className="num">{c._count.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{classes.loading ? t.common.loading : t.classes.none}</Empty>
        )}
      </div>
    </>
  );
}
