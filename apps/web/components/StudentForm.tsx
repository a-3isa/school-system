'use client';
import { FormEvent, useMemo, useState } from 'react';
import { patch, post, todayCairo } from '@/lib/api';
import { ageOnFirstOctober, countries, nextCode, parseNationalId } from '@/lib/enrol';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { BLANK_PARENT, ParentFields, parentBody, ParentForm, RELATIONS } from './ParentFields';
import { PaperFile, PaperPicker, REQUIRED_FILES } from './StudentFiles';
import { ErrorNote, Field, Tabs } from './ui';
import { ClassSelect } from './ClassPicker';

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const TEXT = ['firstName', 'lastName', 'nameAr', 'code', 'classId', 'dateOfBirth', 'nationality', 'nationalId', 'passportNo', 'religion', 'placeOfBirth', 'address', 'previousSchool', 'enrolledOn', 'bloodType', 'allergies', 'medicalNotes', 'emergencyName', 'emergencyRelation', 'emergencyPhone'] as const;
type Values = Record<(typeof TEXT)[number] | 'gender', string>;

/** The student's details as form values: every field a string, '' when not known. */
function toValues(s?: any): Values {
  const v = Object.fromEntries([...TEXT, 'gender'].map((k) => [k, s?.[k] ?? ''])) as Values;
  v.dateOfBirth = s?.dateOfBirth ? s.dateOfBirth.slice(0, 10) : '';
  v.enrolledOn = s?.enrolledOn ? s.enrolledOn.slice(0, 10) : s ? '' : todayCairo();
  v.classId = s?.class?.id ?? s?.classId ?? '';
  v.nationality = s ? s.nationality ?? '' : 'EG';
  return v;
}

/**
 * Adding a student (all sections, with the first parent and the papers), or
 * editing one's details (parents and papers are managed on the student page).
 */
export function StudentForm({ student, onSaved, onCancel }: { student?: any; onSaved: (s: any) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const editing = !!student;
  const classes = useApi<any[]>('/classes');
  const all = useApi<any[]>(editing ? null : '/students');
  const act = useAction();
  const [v, setV] = useState<Values>(() => toValues(student));
  const [parents, setParents] = useState<ParentForm[]>([BLANK_PARENT]);
  const [emailMissing, setEmailMissing] = useState<number | null>(null);
  const [files, setFiles] = useState<PaperFile[]>([]);
  const [filesMissing, setFilesMissing] = useState(false);
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const suggested = useMemo(() => (all.data ? nextCode(all.data.map((s) => s.code)) : ''), [all.data]);
  const code = v.code || (editing ? '' : suggested);
  const nations = useMemo(() => countries(lang), [lang]);
  const egyptian = v.nationality === 'EG';
  const id = v.nationalId ? parseNationalId(v.nationalId, lang) : null;
  const age = v.dateOfBirth ? ageOnFirstOctober(v.dateOfBirth) : null;

  // A valid national number fills in the date of birth and gender when they are still empty.
  function onNationalId(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 14);
    const read = parseNationalId(digits, lang);
    setV((x) => ({ ...x, nationalId: digits, ...(read && !x.dateOfBirth ? { dateOfBirth: read.dateOfBirth } : {}), ...(read && !x.gender ? { gender: read.gender } : {}) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const k of [...TEXT, 'gender'] as const) {
      let value = k === 'code' ? code : v[k].trim();
      // The national number belongs to Egyptians; for others the hidden field is cleared.
      if (k === 'nationalId' && !egyptian) value = '';
      // A local mobile like 0101 111 2222 is written with the country code.
      if (k === 'emergencyPhone' && value) value = value.replace(/[\s-]/g, '').replace(/^00/, '+').replace(/^0(?=1)/, '+20');
      // When adding, leave out what wasn't filled; when editing, '' clears it.
      if (value || editing) body[k] = value;
    }
    if (editing) {
      delete body.code;
      if (!v.religion) body.religion = null;
      await act.run(async () => onSaved(await patch(`/students/${student.id}`, body)));
      return;
    }
    const people = parents.map(parentBody);
    const bad = people.findIndex((p) => !p);
    if (bad >= 0) {
      setEmailMissing(bad);
      return;
    }
    if (REQUIRED_FILES.some((k) => !files.some((f) => f.kind === k))) {
      setFilesMissing(true);
      return;
    }
    body.parent = people[0];
    if (people.length > 1) body.moreParents = people.slice(1);
    body.files = files.map((f) => f.id);
    await act.run(async () => onSaved(await post('/students', body)));
  }

  // A class with its places taken (not counting this student, when editing their own class).
  const chosen = classes.data?.find((c) => c.id === v.classId);
  const full = chosen?.capacity && chosen._count.students - (student?.class?.id === chosen.id ? 1 : 0) >= chosen.capacity ? chosen : null;
  const takenBy = (i: number) => parents.filter((_, j) => j !== i).map((p) => p.relation);
  const missingKinds = REQUIRED_FILES.filter((k) => !files.some((f) => f.kind === k)).map((k) => t.papers.kinds[k]);

  return (
    <form className="stack" style={{ gap: 20 }} onSubmit={submit}>
      <section className="form">
        <div className="form-title">{t.enrol.secStudent}</div>
        <Field label={t.enrol.firstName} id="s-fn"><input id="s-fn" className="input" required value={v.firstName} onChange={set('firstName')} /></Field>
        <Field label={t.enrol.lastName} id="s-ln"><input id="s-ln" className="input" required value={v.lastName} onChange={set('lastName')} /></Field>
        <Field label={t.enrol.nameAr} id="s-ar" className="full" help={t.enrol.nameArHelp}><input id="s-ar" className="input" dir="rtl" lang="ar" value={v.nameAr} onChange={set('nameAr')} /></Field>
        {!editing && (
          <Field label={t.enrol.code} id="s-code" help={!v.code && suggested ? t.enrol.codeHelp(suggested) : undefined}>
            <input id="s-code" className="input mono" dir="ltr" required value={code} onChange={set('code')} />
          </Field>
        )}
        <Field label={t.enrol.nationality} id="s-nat">
          <select id="s-nat" className="input" required value={v.nationality} onChange={set('nationality')}>
            <option value="">{t.common.choose}</option>
            {nations.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </Field>
        {egyptian ? (
          <Field
            label={t.enrol.nationalId}
            id="s-nid"
            help={id ? t.enrol.idSays(id.dateOfBirth, id.place, id.gender === 'MALE' ? t.enrol.boy : t.enrol.girl) : t.enrol.nationalIdHelp}
            error={
              v.nationalId.length === 14 && !id ? t.enrol.idBad
              : id && v.dateOfBirth && id.dateOfBirth !== v.dateOfBirth ? t.enrol.idDobDiff(id.dateOfBirth)
              : id && v.gender && id.gender !== v.gender ? t.enrol.idGenderDiff
              : undefined
            }
          >
            <input id="s-nid" className="input mono num" dir="ltr" inputMode="numeric" required maxLength={14} placeholder="3XXXXXXXXXXXXX" value={v.nationalId} onChange={(e) => onNationalId(e.target.value)} />
          </Field>
        ) : (
          <Field label={t.enrol.passport} id="s-pp"><input id="s-pp" className="input mono" dir="ltr" value={v.passportNo} onChange={set('passportNo')} /></Field>
        )}
        <Field label={t.enrol.dob} id="s-dob" help={age ? t.enrol.ageOn(age.on, age.years, age.months) : undefined}>
          <input id="s-dob" className="input" type="date" required max={todayCairo()} value={v.dateOfBirth} onChange={set('dateOfBirth')} />
        </Field>
        <div className="field">
          <span id="s-g">{t.enrol.gender}</span>
          <Tabs label={t.enrol.gender} value={v.gender} onChange={(g) => setV((x) => ({ ...x, gender: g }))} items={[['MALE', t.enrol.boy], ['FEMALE', t.enrol.girl]]} />
          {/* Keeps the browser's "please fill" check for the gender. */}
          <input aria-labelledby="s-g" className="visually-hidden" tabIndex={-1} required value={v.gender} onChange={() => undefined} />
        </div>
        <Field label={t.enrol.placeOfBirth} id="s-pob"><input id="s-pob" className="input" value={v.placeOfBirth} onChange={set('placeOfBirth')} /></Field>
        <Field label={t.enrol.religion} id="s-rel" help={t.enrol.religionHelp}>
          <select id="s-rel" className="input" value={v.religion} onChange={set('religion')}>
            <option value="">{t.enrol.none}</option>
            {['MUSLIM', 'CHRISTIAN', 'OTHER'].map((r) => <option key={r} value={r}>{t.enrol.religions[r]}</option>)}
          </select>
        </Field>
      </section>

      <section className="form">
        <div className="form-title">{t.enrol.secSchool}</div>
        <Field label={t.common.class} id="s-class" error={full ? t.eg.overCapacity(full.name) : undefined}>
          <ClassSelect id="s-class" classes={classes.data} value={v.classId} empty={t.students.noClass} onChange={(id) => setV((x) => ({ ...x, classId: id }))} />
        </Field>
        <Field label={t.enrol.enrolledOn} id="s-enr"><input id="s-enr" className="input" type="date" value={v.enrolledOn} onChange={set('enrolledOn')} /></Field>
        <Field label={t.enrol.previousSchool} id="s-prev" help={t.enrol.previousSchoolHelp}><input id="s-prev" className="input" value={v.previousSchool} onChange={set('previousSchool')} /></Field>
        <Field label={t.enrol.address} id="s-addr" className="full" help={t.enrol.addressHelp}><input id="s-addr" className="input" value={v.address} onChange={set('address')} /></Field>
      </section>

      <section className="form">
        <div className="form-title">{t.enrol.secHealth}</div>
        <Field label={t.enrol.bloodType} id="s-blood">
          <select id="s-blood" className="input" value={v.bloodType} onChange={set('bloodType')}>
            <option value="">{t.enrol.unknown}</option>
            {BLOOD.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label={t.enrol.allergies} id="s-all"><input id="s-all" className="input" placeholder={t.enrol.allergiesPh} value={v.allergies} onChange={set('allergies')} /></Field>
        <Field label={t.enrol.medical} id="s-med" className="full"><textarea id="s-med" className="input" rows={2} placeholder={t.enrol.medicalPh} value={v.medicalNotes} onChange={set('medicalNotes')} /></Field>
        <div className="form-title" style={{ marginTop: 4 }}>{t.enrol.secEmergency}</div>
        <p className="full small muted" style={{ margin: 0 }}>{t.enrol.emHelp}</p>
        <Field label={t.enrol.emName} id="s-emn"><input id="s-emn" className="input" value={v.emergencyName} onChange={set('emergencyName')} /></Field>
        <Field label={t.enrol.emRelation} id="s-emr"><input id="s-emr" className="input" placeholder={t.enrol.emRelationPh} value={v.emergencyRelation} onChange={set('emergencyRelation')} /></Field>
        <Field label={t.enrol.emPhone} id="s-emp"><input id="s-emp" className="input num" dir="ltr" inputMode="tel" placeholder="+201001234567" value={v.emergencyPhone} onChange={set('emergencyPhone')} /></Field>
      </section>

      {!editing && (
        <section className="form">
          <div className="form-title">{t.enrol.secParents}</div>
          <p className="full small muted" style={{ margin: 0, lineHeight: 1.5 }}>{t.students.firstParentHelp}</p>
          {parents.map((p, i) => (
            <div key={i} className="full parent-block">
              <div className="row between"><b>{t.enrol.parentN(i + 1)}</b>{i > 0 && <button type="button" className="link-btn small" onClick={() => setParents(parents.filter((_, j) => j !== i))}>{t.enrol.removeParent}</button>}</div>
              <div className="parent-form" style={{ padding: 0, background: 'none' }}>
                <ParentFields prefix={`p${i}`} value={p} taken={takenBy(i)} emailMissing={emailMissing === i} onChange={(f) => { setParents(parents.map((x, j) => (j === i ? f : x))); setEmailMissing(null); }} />
              </div>
            </div>
          ))}
          {parents.length < RELATIONS.length && (
            <div className="full">
              <button type="button" className="btn small" onClick={() => setParents([...parents, { ...BLANK_PARENT, relation: RELATIONS.find((r) => !parents.some((p) => p.relation === r))! }])}>{t.enrol.addAnother}</button>
            </div>
          )}
          <p className="full small muted" style={{ margin: 0, lineHeight: 1.5 }}>{t.student.signupHelp}</p>
        </section>
      )}

      {!editing && (
        <section className="form">
          <div className="form-title">{t.enrol.secDocs}</div>
          <p className="full small muted" style={{ margin: 0, lineHeight: 1.5 }}>{t.enrol.docsHelp}</p>
          <PaperPicker files={files} onChange={(f) => { setFiles(f); setFilesMissing(false); }} />
          {filesMissing && <span className="full help error" role="alert">{t.papers.missing(missingKinds.join(lang === 'ar' ? '، ' : ', '))}</span>}
        </section>
      )}

      <ErrorNote error={act.error} />
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn primary" type="submit" disabled={act.busy}>{act.busy ? t.common.saving : editing ? t.enrol.saveEdit : t.enrol.save}</button>
        <button className="btn" type="button" onClick={onCancel}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
