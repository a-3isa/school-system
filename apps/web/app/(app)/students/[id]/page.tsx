'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useParams } from 'next/navigation';
import { del, patch, post, timeCairo, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, Pill, Section, StatusPill, toast } from '@/components/ui';
import { BLANK_PARENT, ParentFields, parentBody, RELATIONS } from '@/components/ParentFields';

const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const { t, x, lang } = useI18n();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const student = useApi(`/students/${id}`);
  const today = todayCairo();
  const history = useApi<any[]>(me.modules.includes('attendance') ? `/attendance/students/${id}?from=${shift(today, -13)}&to=${today}` : null);
  const visits = useApi<any[]>(me.straps && me.modules.includes('attendance') ? `/locations/students/${id}?date=${today}` : null);
  const act = useAction();
  const [form, setForm] = useState(BLANK_PARENT);
  const [emailMissing, setEmailMissing] = useState(false);
  const taken: string[] = student.data?.guardians.map((g: any) => g.relation) ?? [];
  const free = RELATIONS.filter((r) => !taken.includes(r));
  // The form always offers a relation the student doesn't have yet.
  const value = free.includes(form.relation as any) ? form : { ...form, relation: free[0] ?? form.relation };

  async function addParent(e: FormEvent) {
    e.preventDefault();
    const body = parentBody(value);
    if (!body) {
      setEmailMissing(true);
      return;
    }
    if (await act.run(async () => student.setData(await post(`/students/${id}/guardians`, body)))) {
      toast(t.student.parentAdded);
      setForm({ ...BLANK_PARENT, code: value.code });
    }
  }

  const restrict = (parentId: string, restricted: boolean) =>
    act.run(async () => student.setData(await patch(`/students/${id}/guardians/${parentId}`, { restricted })));
  const remove = (parentId: string, name: string) => {
    if (confirm(t.student.removeConfirm(name))) void act.run(async () => student.setData(await del(`/students/${id}/guardians/${parentId}`)));
  };

  if (!student.data) return <ErrorNote error={student.error} />;
  const s = student.data;
  const latin = `${s.firstName} ${s.lastName}`;
  const name = lang === 'ar' && s.nameAr ? s.nameAr : latin;
  const alt = lang === 'ar' ? (s.nameAr ? latin : null) : s.nameAr;
  const dayLabel = (d: string) => (d === today ? t.student.today : `${d.slice(8, 10)}/${d.slice(5, 7)}`);

  return (
    <>
      <header className="head">
        <div className="head-text" style={{ gap: 4 }}>
          <nav className="crumb"><Link href="/students">{t.nav.students}</Link><span>/</span><b>{name}</b></nav>
          <h1>{name}</h1>
          {alt && <span style={{ fontSize: 17 }} className="muted" dir="auto">{alt}</span>}
        </div>
        <div className="facts">
          <span>{t.students.code}<b className="mono" style={{ fontSize: 14, fontWeight: 500 }}><bdi dir="ltr">{s.code}</bdi></b></span>
          <span>{t.common.class}<b>{s.class ? <Link href={`/classes/${s.class.id}`}><bdi dir="ltr">{s.class.name}</bdi></Link> : '—'}</b></span>
        </div>
      </header>
      <ErrorNote error={act.error} />
      <div className="cols">
        <div className="stack" style={{ gap: 24, minWidth: 0 }}>
          {visits.data && (
            <Section title={t.student.whereToday} aside={t.student.fromStrap}>
              <div className="panel pad">
                {visits.data.length ? (
                  <div className="timeline">
                    {visits.data.map((v, i) => (
                      <div key={i} className="tl">
                        <span>{timeCairo(v.from)}–{timeCairo(v.to)}</span>
                        <span className="rail"><i className={v.place?.kind === 'GATE' ? 'gate' : undefined} /><em /></span>
                        <span className="place-name">{v.place?.name ?? t.student.unknownPlace}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="muted">{t.student.notHeardToday}</span>
                )}
              </div>
            </Section>
          )}
          {history.data && (
            <Section title={t.student.lastTwoWeeks}>
              <div className="panel scroll">
                {history.data.length ? (
                  <table>
                    <thead><tr><th>{t.common.date}</th><th>{t.today.period}</th><th>{t.student.status}</th><th>{t.student.how}</th></tr></thead>
                    <tbody>
                      {history.data.map((r) => (
                        <tr key={r.id} className="num">
                          <td className="muted">{dayLabel(r.date.slice(0, 10))}</td>
                          <td>{t.today.periodN(r.period.number)}</td>
                          <td><StatusPill status={r.status} /></td>
                          <td className="small muted">{r.source === 'AUTOMATIC' ? t.student.byStrap : r.reason ? t.student.manualWhy(r.reason) : t.student.manual}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <Empty>{t.student.noAttendance}</Empty>
                )}
              </div>
            </Section>
          )}
        </div>
        <Section title={t.students.parents} aside={t.student.ofThree(s.guardians.length)}>
          <div className="panel">
            {s.guardians.map((g: any) => (
              <div key={g.userId} className="parent">
                <div className="row between wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div className="parent-who">
                    <span><Link href={`/parents/${g.userId}`} className="strong">{g.user.name}</Link><span className="small muted">{t.students.rel[g.relation]}</span></span>
                    {g.user.email && <span style={{ overflowWrap: 'anywhere' }}><bdi dir="ltr">{g.user.email}</bdi></span>}
                    {g.user.phone && <span className="muted num"><bdi dir="ltr">{g.user.phone}</bdi></span>}
                  </div>
                  {isAdmin && (
                    <div className="row wrap" style={{ gap: 8 }}>
                      <button type="button" className="btn small" onClick={() => restrict(g.userId, !g.restricted)} disabled={act.busy}>{g.restricted ? t.student.allow : t.student.restrict}</button>
                      <button type="button" className="btn small danger" onClick={() => remove(g.userId, g.user.name)} disabled={act.busy || s.guardians.length <= 1} title={s.guardians.length <= 1 ? t.student.lastParent : undefined}>{t.student.remove}</button>
                    </div>
                  )}
                </div>
                <div className="chips">
                  {g.user.emailVerifiedAt ? <Pill tone="P" glyph="✓">{t.student.signedUp}</Pill> : <Pill tone="E" glyph="–">{t.student.notSignedUp}</Pill>}
                  {g.user.phoneVerifiedAt ? <Pill tone="P" glyph="✓">{t.student.mobileChecked}</Pill> : <Pill tone="L" glyph="!">{t.student.mobileNotChecked}</Pill>}
                  {g.restricted && <Pill tone="L" glyph="!">{t.student.restricted}</Pill>}
                </div>
              </div>
            ))}
            {!s.guardians.length && <Empty>{t.student.noParents}</Empty>}
            {isAdmin && s.guardians.length === 1 && <div className="list-foot">{t.student.lastParent}</div>}
            {isAdmin && free.length > 0 && (
              <form className="parent-form" onSubmit={addParent} noValidate>
                <div className="full strong">{t.student.addParent}</div>
                <ParentFields prefix="ap" value={value} taken={taken} emailMissing={emailMissing} onChange={(f) => { setForm(f); setEmailMissing(false); }} />
                <p className="full small muted" style={{ margin: 0, lineHeight: 1.5 }}>{t.student.signupHelp}</p>
                <div className="full"><button className="btn primary" type="submit" disabled={act.busy}>{t.student.addParentBtn}</button></div>
              </form>
            )}
            {isAdmin && !free.length && <div className="list-foot">{t.student.parentsFull}</div>}
          </div>
        </Section>
      </div>
    </>
  );
}
