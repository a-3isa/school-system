'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Card, Empty, ErrorNote, Field, PageHead, toast } from '@/components/ui';

export default function StudentsPage() {
  const { me } = useSession();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const students = useApi<any[]>(`/students?active=true${q ? `&q=${encodeURIComponent(q)}` : ''}${classId ? `&classId=${classId}` : ''}`);
  const classes = useApi<any[]>('/classes');
  const act = useAction();
  const [form, setForm] = useState({ code: '', firstName: '', lastName: '', nameAr: '', classId: '' });

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/students', { ...form, nameAr: form.nameAr || undefined, classId: form.classId || undefined }))) {
      toast(`${form.firstName} added.`);
      setForm({ code: '', firstName: '', lastName: '', nameAr: '', classId: form.classId });
      await students.reload();
    }
  }

  return (
    <>
      <PageHead eyebrow="People" title="Students & parents" sub="One record per child, shared by every module. Each child can have up to two parent accounts." />
      <div className="form-row">
        <Field label="Search" id="q">
          <input id="q" className="input" placeholder="Name or student code" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Class" id="cls">
          <select id="cls" className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorNote error={students.error} />
      <div className="grid" style={{ gridTemplateColumns: isAdmin ? 'minmax(0, 1.6fr) minmax(0, 1fr)' : '1fr' }}>
        <Card title={`${students.data?.length ?? '…'} students`} pad={false}>
          {students.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th>Code</th><th>Class</th><th>Parents</th></tr>
                </thead>
                <tbody>
                  {students.data.map((s) => (
                    <tr key={s.id}>
                      <td><Link href={`/students/${s.id}`}>{s.firstName} {s.lastName}</Link>{s.nameAr && <div className="muted small" dir="rtl">{s.nameAr}</div>}</td>
                      <td className="num">{s.code}</td>
                      <td>{s.class?.name ?? '—'}</td>
                      <td>{s.guardians.length ? s.guardians.map((g: any) => g.user.name).join(', ') : <span className="muted">None yet</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{students.loading ? 'Loading…' : 'No students match.'}</Empty>
          )}
        </Card>
        {isAdmin && (
          <Card title="Add a student">
            <form className="stack" onSubmit={add}>
              <ErrorNote error={act.error} />
              <Field label="Student code" id="code"><input id="code" className="input" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <div className="form-row">
                <Field label="First name" id="fn"><input id="fn" className="input" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
                <Field label="Last name" id="ln"><input id="ln" className="input" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
              </div>
              <Field label="Name in Arabic (optional)" id="ar"><input id="ar" className="input" dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></Field>
              <Field label="Class" id="fc">
                <select id="fc" className="input" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                  <option value="">No class yet</option>
                  {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <button className="btn primary" type="submit" disabled={act.busy}>Add student</button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
