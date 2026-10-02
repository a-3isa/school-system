'use client';
import Link from 'next/link';
import { FormEvent, Fragment, useState } from 'react';
import { patch } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Places, useGradeName } from '@/components/ClassPicker';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, Field, Pill, Section, toast } from '@/components/ui';

const SYSTEMS = ['NATIONAL_ARABIC', 'NATIONAL_LANGUAGES', 'BRITISH', 'AMERICAN', 'IB', 'FRENCH', 'GERMAN', 'AZHAR', 'OTHER'];

/** The admin's form for a class's details. */
function EditClass({ c, onSaved }: { c: any; onSaved: () => void }) {
  const { t, staff } = useI18n();
  const teachers = useApi<any[]>('/staff?role=TEACHER');
  const act = useAction();
  const [f, setF] = useState({ name: c.name, section: c.section ?? '', system: c.system ?? '', gender: c.gender, stream: c.stream ?? '', capacity: c.capacity ? String(c.capacity) : '', homeroomTeacherId: c.homeroomTeacher?.id ?? '' });
  async function save(e: FormEvent) {
    e.preventDefault();
    const body = { name: f.name, section: f.section, system: f.system || null, gender: f.gender, stream: f.stream || null, capacity: f.capacity ? Number(f.capacity) : null, homeroomTeacherId: f.homeroomTeacherId };
    if (await act.run(() => patch(`/classes/${c.id}`, body))) {
      toast(t.eg.classSaved);
      onSaved();
    }
  }
  return (
    <form className="form" onSubmit={save}>
      <div className="form-title">{t.eg.editClass}</div>
      {act.error && <div className="full"><ErrorNote error={act.error} /></div>}
      <Field label={t.common.name} id="e-name"><input id="e-name" className="input" dir="ltr" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t.eg.section} id="e-sec"><input id="e-sec" className="input" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} /></Field>
      <Field label={t.eg.system} id="e-sys">
        <select id="e-sys" className="input" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })}>
          <option value="">{t.eg.noSystem}</option>
          {SYSTEMS.map((s) => <option key={s} value={s}>{t.eg.systems[s]}</option>)}
        </select>
      </Field>
      <Field label={t.eg.gender} id="e-gen">
        <select id="e-gen" className="input" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
          {['MIXED', 'BOYS', 'GIRLS'].map((g) => <option key={g} value={g}>{t.eg.genders[g]}</option>)}
        </select>
      </Field>
      {c.grade.stage === 'SECONDARY' && (
        <Field label={t.eg.stream} id="e-str">
          <select id="e-str" className="input" value={f.stream} onChange={(e) => setF({ ...f, stream: e.target.value })}>
            <option value="">{t.eg.noSystem}</option>
            {['SCIENCE', 'MATHEMATICS', 'LITERARY'].map((s) => <option key={s} value={s}>{t.eg.streams[s]}</option>)}
          </select>
        </Field>
      )}
      <Field label={t.eg.capacity} id="e-cap"><input id="e-cap" className="input num" type="number" min={1} max={100} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
      <Field label={t.classes.homeroom} id="e-home">
        <select id="e-home" className="input" value={f.homeroomTeacherId} onChange={(e) => setF({ ...f, homeroomTeacherId: e.target.value })}>
          <option value="">{t.classes.noHomeroom}</option>
          {teachers.data?.map((tc) => <option key={tc.id} value={tc.id}>{staff(tc)}</option>)}
        </select>
      </Field>
      <div className="form-actions"><button className="btn primary" type="submit" disabled={act.busy}>{t.eg.saveClass}</button></div>
    </form>
  );
}

export default function ClassPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang, staff } = useI18n();
  const { me } = useSession();
  const gradeName = useGradeName();
  const cls = useApi<any>(`/classes/${id}`);
  const [editing, setEditing] = useState(false);

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
          <span>{t.eg.stage}<b>{t.eg.stages[c.grade.stage]}</b></span>
          <span>{t.classes.grade}<b>{gradeName(c.grade)}</b></span>
          {c.stream && <span>{t.eg.stream}<b>{t.eg.streams[c.stream]}</b></span>}
          {c.system && <span>{t.eg.system}<b>{t.eg.systems[c.system]}</b></span>}
          <span>{t.eg.gender}<b>{t.eg.genders[c.gender]}</b></span>
          <span>{t.classes.homeroom}<b>{c.homeroomTeacher ? staff(c.homeroomTeacher) : '—'}</b></span>
          <span>{t.classes.students}<b><Places n={c.students.length} capacity={c.capacity} /></b></span>
        </div>
      </header>
      {me.role === 'SCHOOL_ADMIN' && (editing
        ? <EditClass c={c} onSaved={() => { setEditing(false); void cls.reload(); }} />
        : <div><button type="button" className="btn small" onClick={() => setEditing(true)}>{t.eg.editClass}</button></div>)}
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
