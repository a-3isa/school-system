'use client';
import Link from 'next/link';
import { FormEvent, Fragment, ReactNode, useState } from 'react';
import { useParams } from 'next/navigation';
import { del, patch, post, timeCairo, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { has, useSession } from '@/lib/session';
import { Empty, ErrorNote, Pill, Section, StatusPill, Tag, toast } from '@/components/ui';
import { StudentBehaviour } from '@/components/StudentBehaviour';
import { ABSENCE_TONE, EXCUSE_TONE } from '@/components/Lessons';
import { BLANK_PARENT, ParentFields, parentBody, RELATIONS } from '@/components/ParentFields';
import { PaperPicker, REQUIRED_FILES, SavedThumb } from '@/components/StudentFiles';
import { countries } from '@/lib/enrol';

const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const { t, x, lang } = useI18n();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const canNote = has(me, 'behavior') && ['SCHOOL_ADMIN', 'TEACHER', 'SOCIAL_WORKER'].includes(me.role);
  const student = useApi(`/students/${id}`);
  const today = todayCairo();
  const history = useApi<any[]>(me.modules.includes('attendance') ? `/attendance/students/${id}?from=${shift(today, -13)}&to=${today}` : null);
  const absences = useApi<any>(me.modules.includes('attendance') ? `/students/${id}/absences` : null);
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
  const photo = [...s.files].reverse().find((f: any) => f.kind === 'PHOTO' && f.mime !== 'application/pdf');
  const missingPapers = REQUIRED_FILES.filter((k) => !s.files.some((f: any) => f.kind === k)).map((k) => t.papers.kinds[k]);
  const nation = s.nationality ? countries(lang).find(([c]) => c === s.nationality)?.[1] ?? s.nationality : '';
  const emergency = [s.emergencyName, s.emergencyRelation, s.emergencyPhone].filter(Boolean).join(' · ');
  const details: [string, ReactNode][] = [
    [t.enrol.gender.replace(' *', ''), s.gender ? (s.gender === 'MALE' ? t.enrol.boy : t.enrol.girl) : ''],
    [t.enrol.dob.replace(' *', ''), s.dateOfBirth ? <bdi dir="ltr">{s.dateOfBirth.slice(0, 10)}</bdi> : ''],
    [t.enrol.nationality.replace(' *', ''), nation],
    [s.nationality === 'EG' || !s.passportNo ? t.enrol.nationalId.replace(' *', '') : t.enrol.passport, <bdi key="id" dir="ltr" className="mono">{s.nationalId ?? s.passportNo ?? ''}</bdi>],
    [t.enrol.placeOfBirth, s.placeOfBirth],
    [t.enrol.religion, s.religion ? t.enrol.religions[s.religion] : ''],
    [t.enrol.enrolledOn, s.enrolledOn ? <bdi dir="ltr">{s.enrolledOn.slice(0, 10)}</bdi> : ''],
    [t.enrol.previousSchool, s.previousSchool],
    [t.enrol.address, s.address],
    [t.enrol.bloodType, s.bloodType],
    [t.enrol.allergies, s.allergies],
    [t.enrol.medical, s.medicalNotes],
    [t.enrol.secEmergency, emergency ? x(emergency) : ''],
  ];
  const dayLabel = (d: string) => (d === today ? t.student.today : `${d.slice(8, 10)}/${d.slice(5, 7)}`);

  return (
    <>
      <header className="head">
        <div className="row" style={{ gap: 18, alignItems: 'flex-end' }}>
        {photo && <span className="student-photo"><SavedThumb studentId={s.id} file={photo} label={t.papers.kinds.PHOTO} /></span>}
        <div className="head-text" style={{ gap: 4 }}>
          <nav className="crumb"><Link href="/students">{t.nav.students}</Link><span>/</span><b>{name}</b></nav>
          <h1>{name}</h1>
          {alt && <span style={{ fontSize: 17 }} className="muted" dir="auto">{alt}</span>}
        </div>
        </div>
        <div className="facts">
          <span>{t.students.code}<b className="mono" style={{ fontSize: 14, fontWeight: 500 }}><bdi dir="ltr">{s.code}</bdi></b></span>
          <span>{t.common.class}<b>{s.class ? <Link href={`/classes/${s.class.id}`}><bdi dir="ltr">{s.class.name}</bdi></Link> : '—'}</b></span>
        </div>
      </header>
      <ErrorNote error={act.error} />
      <div className="cols">
        <div className="stack" style={{ gap: 24, minWidth: 0 }}>
          <Section title={t.enrol.details} aside={isAdmin ? <Link href={`/students/${s.id}/edit`}>{t.enrol.edit}</Link> : undefined}>
            <div className="panel pad">
              <dl className="kv">
                {details.map(([k, val]) => (
                  <Fragment key={k}><dt>{k}</dt><dd>{val || <span className="muted">{t.enrol.none}</span>}</dd></Fragment>
                ))}
              </dl>
            </div>
          </Section>
          <Section title={t.papers.title}>
            <div className="panel pad stack" style={{ gap: 12 }}>
              {missingPapers.length > 0 && <Pill tone="L" glyph="!">{t.papers.missing(missingPapers.join(lang === 'ar' ? '، ' : ', '))}</Pill>}
              {isAdmin ? (
                <PaperPicker files={[]} onChange={() => undefined} studentId={s.id} saved={s.files} onSavedChange={() => void student.reload()} />
              ) : s.files.length ? (
                <div className="paper-files">{s.files.filter((f: any) => f.kind === 'PHOTO' || (me.role === 'NURSE' && f.kind === 'VACCINATION_RECORD')).map((f: any) => <SavedThumb key={f.id} studentId={s.id} file={f} label={t.papers.kinds[f.kind]} />)}</div>
              ) : (
                <span className="muted">{t.papers.none}</span>
              )}
            </div>
          </Section>
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
          {absences.data && (
            <Section title={t.absences.title} aside={t.absences.aside}>
              <div className="panel scroll">
                {absences.data.days.length ? (
                  <>
                    <p className="small muted" style={{ margin: 0, padding: '12px 16px 0' }}>{t.absences.totals(absences.data.totals)}</p>
                    <table>
                      <thead><tr><th>{t.absences.date}</th><th>{t.absences.lessons}</th><th>{t.absences.state}</th><th>{t.absences.excuse}</th></tr></thead>
                      <tbody>
                        {absences.data.days.map((d: any) => (
                          <tr key={d.date}>
                            <td className="num muted"><bdi dir="ltr">{d.date}</bdi></td>
                            <td className="small">{t.absences.lessonsN(d.lessons.length)}</td>
                            <td><Tag tone={ABSENCE_TONE[d.status]}>{t.absences.status[d.status]}</Tag></td>
                            <td className="small" style={{ maxWidth: 360 }}>
                              {d.excuse ? (
                                <>
                                  <Tag tone={EXCUSE_TONE[d.excuse.status]}>{t.excuses.reason[d.excuse.reason] ?? d.excuse.reason}</Tag>{' '}
                                  <span className="muted">{x(t.absences.fromParent(d.excuse.submittedBy))}</span>
                                  {d.excuse.note && <div>“{x(d.excuse.note)}”</div>}
                                  {d.excuse.decisionNote && <div style={{ color: d.excuse.status === 'REJECTED' ? 'var(--a)' : 'var(--p)' }}>{x(d.excuse.decisionNote)}</div>}
                                </>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <Empty>{t.absences.none}</Empty>
                )}
                {absences.data.upcoming.length > 0 && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
                    <b className="small">{t.absences.upcoming}</b>
                    {absences.data.upcoming.map((e: any) => (
                      <div key={e.id} className="small row wrap" style={{ gap: 8, marginTop: 6 }}>
                        <Tag tone={EXCUSE_TONE[e.status]}>{t.excuses.status[e.status]}</Tag>
                        <span className="num">{t.excuses.days(e.fromDate.slice(0, 10), e.toDate.slice(0, 10))}</span>
                        <span className="muted">{t.excuses.reason[e.reason] ?? e.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}
          {canNote && <StudentBehaviour student={{ id: s.id, name: latin }} />}
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
