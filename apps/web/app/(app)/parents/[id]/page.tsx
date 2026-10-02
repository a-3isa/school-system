'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useParams } from 'next/navigation';
import { dateTimeCairo, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, Field, Pill, Section, toast } from '@/components/ui';
import { RELATIONS } from '@/components/ParentFields';

export default function ParentPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const { t, x, lang } = useI18n();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const parent = useApi<any>(`/parents/${id}`);
  const students = useApi<any[]>(isAdmin ? '/students?active=true' : null);
  const act = useAction();
  const [studentId, setStudentId] = useState('');
  const [relation, setRelation] = useState('');

  const name = (st: any) => (lang === 'ar' && st.nameAr ? st.nameAr : `${st.firstName} ${st.lastName}`);
  const mine = new Set<string>(parent.data?.children.map((c: any) => c.student.id) ?? []);
  const candidates = (students.data ?? []).filter((st) => !mine.has(st.id) && st.guardians.length < RELATIONS.length);
  const picked = candidates.find((st) => st.id === studentId);
  const free = picked ? RELATIONS.filter((r) => !picked.guardians.some((g: any) => g.relation === r)) : [];
  const rel = free.includes(relation as any) ? relation : free[0] ?? '';

  async function link(e: FormEvent) {
    e.preventDefault();
    if (!picked || !rel) return;
    if (await act.run(() => post(`/students/${picked.id}/guardians`, { relation: rel, name: parent.data.name, email: parent.data.email }))) {
      toast(t.parents.linked);
      setStudentId('');
      await Promise.all([parent.reload(), students.reload()]);
    }
  }

  if (!parent.data) return <ErrorNote error={parent.error} />;
  const p = parent.data;

  return (
    <>
      <header className="head">
        <div className="head-text" style={{ gap: 4 }}>
          <nav className="crumb"><Link href="/parents">{t.nav.parents}</Link><span>/</span><b>{p.name}</b></nav>
          <h1>{p.name}</h1>
        </div>
        <div className="facts">
          <span>{t.common.email}<b style={{ fontSize: 14, fontWeight: 500 }}><bdi dir="ltr">{p.email ?? '—'}</bdi></b></span>
          <span>{t.parents.mobile}<b className="num" style={{ fontSize: 14, fontWeight: 500 }}><bdi dir="ltr">{p.phone ?? t.parents.noMobile}</bdi></b></span>
        </div>
      </header>
      <ErrorNote error={act.error} />
      <div className="cols">
        <Section title={t.parents.children} aside={String(p.children.length)}>
          <div className="panel">
            {p.children.length ? (
              <table>
                <thead><tr><th>{t.common.name}</th><th>{t.student.relation}</th><th>{t.common.class}</th></tr></thead>
                <tbody>
                  {p.children.map((c: any) => (
                    <tr key={c.student.id}>
                      <td>
                        <Link href={`/students/${c.student.id}`} className="strong">{name(c.student)}</Link>
                        <span className="sub mono"><bdi dir="ltr">{c.student.code}</bdi></span>
                        {(c.restricted || !c.student.active) && (
                          <span className="sub chips">
                            {c.restricted && <Pill tone="L" glyph="!">{t.student.restricted}</Pill>}
                            {!c.student.active && <Pill tone="E" glyph="–">{t.parents.inactive}</Pill>}
                          </span>
                        )}
                      </td>
                      <td>{t.students.rel[c.relation]}</td>
                      <td>{c.student.class ? <Link href={`/classes/${c.student.class.id}`}><bdi dir="ltr">{c.student.class.name}</bdi></Link> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{t.parents.noChildren}</Empty>
            )}
            {isAdmin && p.email && (
              <form className="parent-form" onSubmit={link}>
                <div className="full strong">{t.parents.addChild}</div>
                <Field label={t.parents.student} id="ls">
                  <select id="ls" className="input" required value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                    <option value="">{t.common.choose}</option>
                    {candidates.map((st) => <option key={st.id} value={st.id}>{name(st)}{st.class ? ` · ${st.class.name}` : ''}</option>)}
                  </select>
                </Field>
                <Field label={t.student.relation} id="lr">
                  <select id="lr" className="input" value={rel} disabled={!picked} onChange={(e) => setRelation(e.target.value)}>
                    {free.map((r) => <option key={r} value={r}>{t.students.rel[r]}</option>)}
                  </select>
                </Field>
                <div className="full"><button className="btn primary" type="submit" disabled={act.busy || !picked}>{t.parents.link}</button></div>
              </form>
            )}
          </div>
        </Section>
        <Section title={t.parents.details}>
          <div className="panel pad stack" style={{ gap: 12 }}>
            <div className="chips">
              {p.emailVerifiedAt ? <Pill tone="P" glyph="✓">{t.student.signedUp}</Pill> : <Pill tone="E" glyph="–">{t.student.notSignedUp}</Pill>}
              {p.phoneVerifiedAt ? <Pill tone="P" glyph="✓">{t.student.mobileChecked}</Pill> : <Pill tone="L" glyph="!">{t.student.mobileNotChecked}</Pill>}
            </div>
            {me.straps && (
              <span className="small"><b>{t.parents.consent}: </b>{p.consentAt ? x(t.parents.consentAgreed(dateTimeCairo(p.consentAt))) : t.parents.consentNot}</span>
            )}
            <span className="small muted">{x(t.parents.addedOn(dateTimeCairo(p.createdAt)))}</span>
            {!p.emailVerifiedAt && <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>{t.student.signupHelp}</p>}
          </div>
        </Section>
      </div>
    </>
  );
}
