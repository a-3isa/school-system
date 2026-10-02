'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, Field, PageHead, Pill, Tabs, toast } from '@/components/ui';
import { BLANK_PARENT, ParentFields, parentBody } from '@/components/ParentFields';

const BLANK = { code: '', firstName: '', lastName: '', nameAr: '', classId: '' };

export default function StudentsPage() {
  const { me } = useSession();
  const { t, lang } = useI18n();
  const router = useRouter();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const students = useApi<any[]>(`/students?active=true${q ? `&q=${encodeURIComponent(q)}` : ''}${classId ? `&classId=${classId}` : ''}`);
  const classes = useApi<any[]>('/classes');
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [parent, setParent] = useState(BLANK_PARENT);
  const [emailMissing, setEmailMissing] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    // Every student comes with a parent or guardian.
    const first = parentBody(parent);
    if (!first) {
      setEmailMissing(true);
      return;
    }
    const created = await act.run(() => post<any>('/students', { ...form, nameAr: form.nameAr || undefined, classId: form.classId || undefined, parent: first }));
    if (created) {
      toast(t.students.added(form.firstName));
      setForm({ ...BLANK, classId: form.classId });
      setParent(BLANK_PARENT);
      await students.reload();
    }
  }

  return (
    <>
      <PageHead
        sub={students.data ? t.students.sub(students.data.length) : undefined}
        title={isAdmin ? t.nav.students : t.students.titleStaff}
        actions={isAdmin && (
          <>
            <button type="button" className="btn primary" onClick={() => setAdding(true)}>{t.students.add}</button>
            <Link className="btn" href="/students/import">{t.nav.import}</Link>
          </>
        )}
      />
      <input type="search" className="input" aria-label={t.students.search} placeholder={t.students.search} value={q} onChange={(e) => setQ(e.target.value)} />
      <Tabs label={t.common.class} value={classId} onChange={setClassId} items={[['', t.common.allClasses], ...(classes.data ?? []).map((c): [string, string] => [c.id, c.name])]} />
      {isAdmin && adding && (
        <form className="form" onSubmit={add}>
          <div className="form-title">{t.students.add}</div>
          {act.error && <div className="full"><ErrorNote error={act.error} /></div>}
          <Field label={t.students.firstName} id="fn"><input id="fn" className="input" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
          <Field label={t.students.lastName} id="ln"><input id="ln" className="input" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          <Field label={t.students.nameAr} id="ar"><input id="ar" className="input" dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></Field>
          <Field label={t.students.code} id="code"><input id="code" className="input mono" dir="ltr" required placeholder="NV-4A-13" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label={t.common.class} id="fc">
            <select id="fc" className="input" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
              <option value="">{t.students.noClass}</option>
              {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="form-title">{t.students.firstParent}</div>
          <p className="full small muted" style={{ margin: 0, lineHeight: 1.5 }}>{t.students.firstParentHelp}</p>
          <ParentFields prefix="np" value={parent} emailMissing={emailMissing} onChange={(f) => { setParent(f); setEmailMissing(false); }} />
          <p className="full small muted" style={{ margin: 0, lineHeight: 1.5 }}>{t.student.signupHelp}</p>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={act.busy}>{t.students.add}</button>
            <button className="btn" type="button" onClick={() => setAdding(false)}>{t.common.cancel}</button>
          </div>
        </form>
      )}
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
