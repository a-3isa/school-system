'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { byStage, Places, useGradeName } from '@/components/ClassPicker';
import { Empty, ErrorNote, PageHead, Section } from '@/components/ui';

export default function ClassesPage() {
  const { t, staff } = useI18n();
  const router = useRouter();
  const gradeName = useGradeName();
  const classes = useApi<any[]>('/classes');
  const groups = byStage(classes.data ?? []);

  return (
    <>
      <PageHead sub={classes.data ? t.classes.sub(classes.data.length) : undefined} title={t.nav.classes} />
      <ErrorNote error={classes.error} />
      {groups.map(([stage, list]) => (
        <Section key={stage} title={t.eg.stages[stage]} aside={t.classes.nStudents(list.reduce((n, c) => n + c._count.students, 0))}>
          <div className="panel scroll">
            <table style={{ minWidth: 720 }}>
              <thead><tr><th>{t.common.class}</th><th>{t.classes.grade}</th><th>{t.eg.system}</th><th>{t.eg.gender}</th><th>{t.classes.homeroom}</th><th>{t.classes.students}</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="click" onClick={() => router.push(`/classes/${c.id}`)}>
                    <td><Link href={`/classes/${c.id}`} className="strong" style={{ color: 'var(--ink)', textDecoration: 'none' }}><bdi dir="ltr">{c.name}</bdi></Link></td>
                    <td>{gradeName(c.grade)}{c.stream && <span className="sub">{t.eg.streams[c.stream]}</span>}</td>
                    <td>{c.system ? t.eg.systems[c.system] : <span className="muted">—</span>}</td>
                    <td>{t.eg.genders[c.gender]}</td>
                    <td>{c.homeroomTeacher ? staff(c.homeroomTeacher) : <span className="muted">{t.classes.noHomeroom}</span>}</td>
                    <td><Places n={c._count.students} capacity={c.capacity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
      {!groups.length && <div className="panel"><Empty>{classes.loading ? t.common.loading : t.classes.none}</Empty></div>}
    </>
  );
}
