'use client';
import Link from 'next/link';
import { FormEvent, ReactNode, useState } from 'react';
import { del, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Dict } from '@/lib/strings';
import { byStage, useGradeName } from '@/components/ClassPicker';
import { SubjectsEditor } from '@/components/SubjectsEditor';
import { Empty, ErrorNote, Field, PageHead, Section, toast } from '@/components/ui';

const ROOM_KINDS = ['CLASSROOM', 'LAB', 'LIBRARY', 'SPORTS', 'OTHER'] as const;
const STAGES = ['KG', 'PRIMARY', 'PREPARATORY', 'SECONDARY'] as const;
const SYSTEMS = ['NATIONAL_ARABIC', 'NATIONAL_LANGUAGES', 'BRITISH', 'AMERICAN', 'IB', 'FRENCH', 'GERMAN', 'AZHAR', 'OTHER'] as const;
const STREAMS = ['SCIENCE', 'MATHEMATICS', 'LITERARY'] as const;

/** A small list with a remove button on each row and an add form underneath. */
function Editor({ title, rows, onAdd, children }: { title: string; rows: { key: string; a: ReactNode; b?: ReactNode; remove?: () => void }[]; onAdd: (e: FormEvent) => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="editor">
      <div className="editor-head"><b>{title}</b><span className="num">{rows.length}</span></div>
      {rows.map((r) => (
        <div key={r.key} className="editor-row">
          <span><span>{r.a}</span>{r.b && <small>{r.b}</small>}</span>
          {r.remove && <RemoveButton onClick={r.remove} />}
        </div>
      ))}
      {!rows.length && <Empty>{t.setup.none}</Empty>}
      <form className="editor-add" onSubmit={onAdd}>
        {children}
        <button className="btn" type="submit">{t.common.add}</button>
      </form>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return <button type="button" className="icon-btn" aria-label={t.common.remove} title={t.common.remove} onClick={onClick}>✕</button>;
}

/** The suggested name of a class: 4/1 for Primary 4 section 1, Prep 2/3, Sec 1/2, KG1/1. */
function suggestName(grade: any, section: string) {
  if (!grade || !section) return '';
  const n = grade.name.match(/(\d+)\s*$/)?.[1];
  const prefix = !n ? grade.name : grade.stage === 'PRIMARY' ? n : grade.stage === 'KG' ? `KG${n}` : grade.stage === 'PREPARATORY' ? `Prep ${n}` : grade.stage === 'SECONDARY' ? `Sec ${n}` : grade.name;
  return `${prefix}/${section}`;
}

export default function SetupPage() {
  const { t, x, lang, staff } = useI18n();
  const gradeName = useGradeName();
  const grades = useApi<any[]>('/grades');
  const classes = useApi<any[]>('/classes');
  const rooms = useApi<any[]>('/rooms');
  const periods = useApi<any[]>('/periods');
  const years = useApi<any[]>('/school/years');
  const holidays = useApi<any[]>('/school/holidays');
  const teachers = useApi<any[]>('/staff?role=TEACHER');
  const act = useAction();

  const [stages, setStages] = useState<string[]>(['PRIMARY']);
  const [grade, setGrade] = useState({ name: '', nameAr: '', stage: 'OTHER', order: 20 });
  const [cls, setCls] = useState({ gradeId: '', section: '1', name: '', system: '', gender: 'MIXED', stream: '', capacity: '', homeroomTeacherId: '' });
  const [room, setRoom] = useState({ name: '', kind: 'CLASSROOM' });
  const [period, setPeriod] = useState({ number: 1, startTime: '08:00', endTime: '08:45' });
  const [year, setYear] = useState({ name: '2026/2027', startsOn: '2026-09-13', endsOn: '2027-06-30', term2StartsOn: '2027-02-07', breakFrom: '2027-01-24', breakTo: '2027-02-04' });
  const [holiday, setHoliday] = useState({ name: '', fromDate: '', toDate: '' });

  const run = (fn: () => Promise<unknown>, done: () => void, message = t.setup.added) => async (e?: FormEvent) => {
    e?.preventDefault();
    if (await act.run(fn)) {
      toast(message);
      done();
    }
  };
  const remove = (path: string, reload: () => Promise<void>) => async () => {
    if (await act.run(() => del(path))) await reload();
  };
  const kind = (k: string) => t.setup.roomKinds[k as keyof Dict['setup']['roomKinds']] ?? k;
  const pickedGrade = grades.data?.find((g) => g.id === cls.gradeId);
  const suggested = suggestName(pickedGrade, cls.section.trim());
  const className = cls.name || suggested;
  const gradeGroups = STAGES.concat(['OTHER' as any]).map((s) => [s, (grades.data ?? []).filter((g) => g.stage === s)] as const).filter(([, l]) => l.length);
  const date = (d: string) => <bdi dir="ltr">{d.slice(0, 10)}</bdi>;

  return (
    <>
      <PageHead sub={t.setup.sub} title={t.nav.structure} />
      <ErrorNote error={act.error} />

      <Section title={t.eg.stagesTitle}>
        <div className="panel pad stack" style={{ gap: 14 }}>
          <p className="small muted" style={{ margin: 0 }}>{t.eg.stagesHelp}</p>
          <div className="row wrap" style={{ gap: 16, alignItems: 'center' }}>
            {STAGES.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" checked={stages.includes(s)} onChange={(e) => setStages(e.target.checked ? [...stages, s] : stages.filter((y) => y !== s))} />
                {t.eg.stages[s]}
              </label>
            ))}
            <button type="button" className="btn primary small" disabled={!stages.length || act.busy} onClick={() => void run(() => post('/grades/egypt', { stages }), () => void grades.reload(), t.eg.egyptAdded)()}>{t.eg.addEgypt}</button>
          </div>
          {gradeGroups.length ? (
            <div className="stage-grid">
              {gradeGroups.map(([stage, list]) => (
                <div key={stage} className="stage-col">
                  <b>{t.eg.stages[stage]}</b>
                  {list.map((g) => (
                    <span key={g.id} className="stage-grade">
                      <span>{gradeName(g)}</span>
                      <RemoveButton onClick={remove(`/grades/${g.id}`, grades.reload)} />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ) : <Empty>{t.setup.none}</Empty>}
          <form className="editor-add" style={{ borderRadius: 8 }} onSubmit={run(() => post('/grades', { ...grade, nameAr: grade.nameAr || undefined }), () => { setGrade({ ...grade, name: '', nameAr: '', order: grade.order + 1 }); void grades.reload(); })}>
            <span className="small muted" style={{ alignSelf: 'center' }}>{t.eg.ownGrade}</span>
            <input className="input" required aria-label={t.setup.newGrade} placeholder={t.setup.newGrade} value={grade.name} onChange={(e) => setGrade({ ...grade, name: e.target.value })} />
            <input className="input" dir="rtl" aria-label={t.enrol.nameAr} placeholder="الاسم بالعربية" value={grade.nameAr} onChange={(e) => setGrade({ ...grade, nameAr: e.target.value })} />
            <select className="input" aria-label={t.eg.stage} value={grade.stage} onChange={(e) => setGrade({ ...grade, stage: e.target.value })}>
              {[...STAGES, 'OTHER'].map((s) => <option key={s} value={s}>{t.eg.stages[s]}</option>)}
            </select>
            <input className="input num" type="number" aria-label={t.setup.order} value={grade.order} onChange={(e) => setGrade({ ...grade, order: Number(e.target.value) })} style={{ flex: '0 0 64px' }} />
            <button className="btn" type="submit">{t.common.add}</button>
          </form>
        </div>
      </Section>

      <Section title={t.eg.classesTitle} aside={String(classes.data?.length ?? '')}>
        <div className="panel">
          <p className="small muted" style={{ margin: 0, padding: '14px 18px 4px' }}>{t.eg.classesHelp}</p>
          {byStage(classes.data ?? []).map(([stage, list]) => (
            <div key={stage}>
              <div className="stage-head">{t.eg.stages[stage]}</div>
              {list.map((c) => (
                <div key={c.id} className="editor-row">
                  <span>
                    <span><Link href={`/classes/${c.id}`}><bdi dir="ltr">{c.name}</bdi></Link></span>
                    <small>{x([gradeName(c.grade), c.system && t.eg.systems[c.system], c.gender !== 'MIXED' && t.eg.genders[c.gender], c.stream && t.eg.streams[c.stream], c.capacity ? t.eg.placesOf(c._count.students, c.capacity) : t.setup.nStudents(c._count.students), c.homeroomTeacher?.name].filter(Boolean).join(' · '))}</small>
                  </span>
                  <RemoveButton onClick={remove(`/classes/${c.id}`, classes.reload)} />
                </div>
              ))}
            </div>
          ))}
          {!classes.data?.length && <Empty>{t.setup.none}</Empty>}
          <form
            className="form"
            style={{ border: 0, borderTop: '1px solid var(--line-soft)', borderRadius: 0, background: 'var(--surface-2)' }}
            onSubmit={run(
              () => post('/classes', { name: className, gradeId: cls.gradeId, section: cls.section || undefined, system: cls.system || undefined, gender: cls.gender, stream: cls.stream || undefined, capacity: cls.capacity ? Number(cls.capacity) : undefined, homeroomTeacherId: cls.homeroomTeacherId || undefined }),
              () => { setCls({ ...cls, section: String((Number(cls.section) || 0) + 1), name: '' }); void classes.reload(); },
            )}
          >
            <Field label={t.setup.grade} id="c-grade">
              <select id="c-grade" className="input" required value={cls.gradeId} onChange={(e) => setCls({ ...cls, gradeId: e.target.value, stream: '' })}>
                <option value="">{t.common.choose}</option>
                {gradeGroups.map(([stage, list]) => (
                  <optgroup key={stage} label={t.eg.stages[stage]}>{list.map((g) => <option key={g.id} value={g.id}>{gradeName(g)}</option>)}</optgroup>
                ))}
              </select>
            </Field>
            <Field label={t.eg.section} id="c-sec"><input id="c-sec" className="input" value={cls.section} onChange={(e) => setCls({ ...cls, section: e.target.value })} /></Field>
            <Field label={t.common.name} id="c-name" help={!cls.name && suggested ? t.eg.nameSuggest(suggested) : undefined}>
              <input id="c-name" className="input" dir="ltr" required value={className} onChange={(e) => setCls({ ...cls, name: e.target.value })} />
            </Field>
            <Field label={t.eg.system} id="c-sys">
              <select id="c-sys" className="input" value={cls.system} onChange={(e) => setCls({ ...cls, system: e.target.value })}>
                <option value="">{t.eg.noSystem}</option>
                {SYSTEMS.map((s) => <option key={s} value={s}>{t.eg.systems[s]}</option>)}
              </select>
            </Field>
            <Field label={t.eg.gender} id="c-gen">
              <select id="c-gen" className="input" value={cls.gender} onChange={(e) => setCls({ ...cls, gender: e.target.value })}>
                {['MIXED', 'BOYS', 'GIRLS'].map((g) => <option key={g} value={g}>{t.eg.genders[g]}</option>)}
              </select>
            </Field>
            {pickedGrade?.stage === 'SECONDARY' && (
              <Field label={t.eg.stream} id="c-str">
                <select id="c-str" className="input" value={cls.stream} onChange={(e) => setCls({ ...cls, stream: e.target.value })}>
                  <option value="">{t.eg.noSystem}</option>
                  {STREAMS.map((s) => <option key={s} value={s}>{t.eg.streams[s]}</option>)}
                </select>
              </Field>
            )}
            <Field label={t.eg.capacity} id="c-cap"><input id="c-cap" className="input num" type="number" min={1} max={100} placeholder="30" value={cls.capacity} onChange={(e) => setCls({ ...cls, capacity: e.target.value })} /></Field>
            <Field label={t.setup.homeroom} id="c-home">
              <select id="c-home" className="input" value={cls.homeroomTeacherId} onChange={(e) => setCls({ ...cls, homeroomTeacherId: e.target.value })}>
                <option value="">{t.setup.homeroom}</option>
                {teachers.data?.map((tc) => <option key={tc.id} value={tc.id}>{staff(tc)}</option>)}
              </select>
            </Field>
            <div className="form-actions"><button className="btn primary" type="submit" disabled={act.busy}>{t.common.add}</button></div>
          </form>
        </div>
      </Section>

      <div className="cols">
        <Section title={t.eg.yearTitle}>
          <div className="panel">
            <p className="small muted" style={{ margin: 0, padding: '14px 18px 4px' }}>{t.eg.yearHelp}</p>
            {years.data?.map((y) => (
              <div key={y.id} className="editor-row">
                <span>
                  <span><bdi dir="ltr">{y.name}</bdi></span>
                  <small>{date(y.startsOn)} – {date(y.endsOn)}{y.term2StartsOn && <> · {t.eg.term2} {date(y.term2StartsOn)}</>}{y.breakFrom && <> · {t.eg.breakFrom} {date(y.breakFrom)} {t.eg.breakTo} {date(y.breakTo)}</>}</small>
                </span>
                <RemoveButton onClick={remove(`/school/years/${y.id}`, years.reload)} />
              </div>
            ))}
            {!years.data?.length && <div className="list-foot">{t.eg.noYear}</div>}
            <form className="form" style={{ border: 0, borderTop: '1px solid var(--line-soft)', borderRadius: 0, background: 'var(--surface-2)' }} onSubmit={run(() => post('/school/years', year), () => void years.reload(), t.eg.yearAdded)}>
              <Field label={t.eg.yearName} id="y-n"><input id="y-n" className="input" dir="ltr" required placeholder="2026/2027" value={year.name} onChange={(e) => setYear({ ...year, name: e.target.value })} /></Field>
              <Field label={t.eg.firstDay} id="y-s"><input id="y-s" className="input" type="date" required value={year.startsOn} onChange={(e) => setYear({ ...year, startsOn: e.target.value })} /></Field>
              <Field label={t.eg.lastDay} id="y-e"><input id="y-e" className="input" type="date" required value={year.endsOn} onChange={(e) => setYear({ ...year, endsOn: e.target.value })} /></Field>
              <Field label={t.eg.term2} id="y-t"><input id="y-t" className="input" type="date" value={year.term2StartsOn} onChange={(e) => setYear({ ...year, term2StartsOn: e.target.value })} /></Field>
              <Field label={t.eg.breakFrom} id="y-bf"><input id="y-bf" className="input" type="date" value={year.breakFrom} onChange={(e) => setYear({ ...year, breakFrom: e.target.value })} /></Field>
              <Field label={t.eg.breakTo} id="y-bt"><input id="y-bt" className="input" type="date" value={year.breakTo} onChange={(e) => setYear({ ...year, breakTo: e.target.value })} /></Field>
              <div className="form-actions"><button className="btn primary" type="submit" disabled={act.busy}>{t.eg.addYear}</button></div>
            </form>
          </div>
        </Section>

        <Section title={t.eg.holidaysTitle} aside={String(holidays.data?.length ?? '')}>
          <div className="panel">
            <p className="small muted" style={{ margin: 0, padding: '14px 18px 4px' }}>{t.eg.holidaysHelp}</p>
            {holidays.data?.map((h) => (
              <div key={h.id} className="editor-row">
                <span><span>{h.name}</span><small>{date(h.fromDate)}{h.toDate.slice(0, 10) !== h.fromDate.slice(0, 10) && <> – {date(h.toDate)}</>}</small></span>
                <RemoveButton onClick={remove(`/school/holidays/${h.id}`, holidays.reload)} />
              </div>
            ))}
            {!holidays.data?.length && <div className="list-foot">{t.eg.noHolidays}</div>}
            {years.data?.[0] && (
              <div className="list-foot">
                <button type="button" className="btn small" disabled={act.busy} onClick={async () => {
                  let added: any[] = [];
                  if (await act.run(async () => { added = await post('/school/holidays/egypt', { yearId: years.data![0].id, lang }); })) {
                    toast(t.eg.holidaysAdded(added.length));
                    void holidays.reload();
                  }
                }}>{t.eg.addEgyptHolidays} · <bdi dir="ltr">{years.data[0].name}</bdi></button>
              </div>
            )}
            <form className="form" style={{ border: 0, borderTop: '1px solid var(--line-soft)', borderRadius: 0, background: 'var(--surface-2)' }} onSubmit={run(() => post('/school/holidays', { ...holiday, toDate: holiday.toDate || holiday.fromDate }), () => { setHoliday({ name: '', fromDate: '', toDate: '' }); void holidays.reload(); })}>
              <Field label={t.eg.holidayName} id="h-n" className="full"><input id="h-n" className="input" required placeholder={lang === 'ar' ? 'عيد الفطر' : 'Eid al-Fitr'} value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} /></Field>
              <Field label={t.eg.from} id="h-f"><input id="h-f" className="input" type="date" required value={holiday.fromDate} onChange={(e) => setHoliday({ ...holiday, fromDate: e.target.value })} /></Field>
              <Field label={t.eg.to} id="h-t"><input id="h-t" className="input" type="date" min={holiday.fromDate} value={holiday.toDate} onChange={(e) => setHoliday({ ...holiday, toDate: e.target.value })} /></Field>
              <div className="form-actions"><button className="btn primary" type="submit" disabled={act.busy}>{t.eg.addHoliday}</button></div>
            </form>
          </div>
        </Section>
      </div>

      <div className="editors">
        <Editor
          title={t.setup.rooms}
          rows={(rooms.data ?? []).map((r) => ({ key: r.id, a: r.name, b: kind(r.kind), remove: remove(`/rooms/${r.id}`, rooms.reload) }))}
          onAdd={run(() => post('/rooms', room), () => { setRoom({ ...room, name: '' }); void rooms.reload(); })}
        >
          <input className="input" required aria-label={t.setup.newRoom} placeholder={t.setup.newRoom} value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} />
          <select className="input" aria-label={t.setup.kind} value={room.kind} onChange={(e) => setRoom({ ...room, kind: e.target.value })}>
            {ROOM_KINDS.map((k) => <option key={k} value={k}>{kind(k)}</option>)}
          </select>
        </Editor>

        <Editor
          title={t.setup.periods}
          rows={(periods.data ?? []).map((p) => ({ key: p.id, a: t.today.periodN(p.number), b: <bdi dir="ltr">{p.startTime}–{p.endTime}</bdi>, remove: remove(`/periods/${p.id}`, periods.reload) }))}
          onAdd={run(() => post('/periods', period), () => { setPeriod({ number: period.number + 1, startTime: period.endTime, endTime: period.endTime }); void periods.reload(); })}
        >
          <input className="input num" type="number" min={1} aria-label={t.setup.number} value={period.number} onChange={(e) => setPeriod({ ...period, number: Number(e.target.value) })} style={{ flex: '0 0 64px' }} />
          <input className="input num" type="time" required aria-label={t.setup.starts} value={period.startTime} onChange={(e) => setPeriod({ ...period, startTime: e.target.value })} />
          <input className="input num" type="time" required aria-label={t.setup.ends} value={period.endTime} onChange={(e) => setPeriod({ ...period, endTime: e.target.value })} />
        </Editor>

        <SubjectsEditor />
      </div>
    </>
  );
}
