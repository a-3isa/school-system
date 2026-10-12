'use client';
import { FormEvent, useState } from 'react';
import { del, patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, Tag, toast } from './ui';

/** Where one subject is used: its year groups, and its classes with their teachers and lessons. */
function SubjectUsage({ id }: { id: string }) {
  const { t, x, staff } = useI18n();
  const usage = useApi<any>(`/subjects/${id}`);
  if (!usage.data) return <div className="editor-row small muted">{usage.error ? x(usage.error) : t.common.loading}</div>;
  const u = usage.data;
  return (
    <div className="editor-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, background: 'var(--surface-2)' }}>
      <div className="stack small" style={{ gap: 4 }}>
        <b>{t.subj.yearGroupsLabel}</b>
        {u.yearGroups.length ? (
          <span className="row wrap" style={{ gap: 6 }}>
            {u.yearGroups.map((g: any) => <Tag key={g.id} tone="N">{x(g.name)}{g.lessonsPerWeek ? ` · ${t.subj.perWeekN(g.lessonsPerWeek)}` : ''}</Tag>)}
          </span>
        ) : <span className="muted">—</span>}
      </div>
      <div className="stack small" style={{ gap: 4 }}>
        <b>{t.subj.classesLabel}</b>
        {u.classes.length ? u.classes.map((c: any) => (
          <span key={c.classId}>{x(c.className)} · {c.teacher ? staff(c.teacher) : <span className="muted">{t.subj.noTeacher}</span>} · <span className="muted">{t.subj.placedN(c.lessons)}</span></span>
        )) : <span className="muted">—</span>}
      </div>
      {(u.lessons > 0 || u.assessments > 0) && <span className="small muted">{t.subj.inUse(u.lessons, u.assessments)}</span>}
    </div>
  );
}

/**
 * The school's subjects, all four of create, read, update and delete: add one (an English name and, optionally,
 * an Arabic one that Arabic screens and report cards use), see where it is used, fix its names, and delete it
 * while no lesson or mark uses it (that takes it out of its year groups and classes too).
 * Which year group studies it is set below, and who teaches it in each class on the Timetable page.
 */
export function SubjectsEditor() {
  const { t, x } = useI18n();
  const subjects = useApi<any[]>('/subjects');
  const act = useAction();
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', nameAr: '' });

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/subjects', { name, ...(nameAr.trim() ? { nameAr } : {}) }))) {
      setName('');
      setNameAr('');
      await subjects.reload();
    }
  }

  async function save(id: string) {
    if (await act.run(() => patch(`/subjects/${id}`, draft))) {
      setEditing(null);
      toast(t.subj.saved);
      await subjects.reload();
    }
  }

  async function remove(s: any) {
    if (!confirm(t.subj.deleteConfirm(s.name, s.yearGroups, s.classes))) return;
    if (await act.run(() => del(`/subjects/${s.id}`))) {
      toast(t.subj.deleted);
      setOpen(null);
      await subjects.reload();
    }
  }

  const rows: any[] = subjects.data ?? [];
  return (
    <div className="editor">
      <div className="editor-head"><b>{t.setup.subjects}</b><span className="num">{rows.length}</span></div>
      <ErrorNote error={(act.error ?? subjects.error) && x((act.error ?? subjects.error)!)} />
      {rows.map((s) =>
        editing === s.id ? (
          <div key={s.id} className="editor-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input className="input" aria-label={t.subj.nameEn} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ flex: '1 1 140px' }} />
            <input className="input" dir="rtl" aria-label={t.subj.nameAr} placeholder={t.subj.nameAr} value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} style={{ flex: '1 1 140px' }} />
            <button type="button" className="btn small primary" disabled={act.busy || !draft.name.trim()} onClick={() => void save(s.id)}>{t.subj.save}</button>
            <button type="button" className="btn small" onClick={() => setEditing(null)}>{t.common.cancel}</button>
          </div>
        ) : (
          <div key={s.id}>
            <div className="editor-row">
              <span>
                <button type="button" className="btn link" aria-expanded={open === s.id} title={open === s.id ? t.subj.hideDetails : t.subj.details} onClick={() => setOpen(open === s.id ? null : s.id)} style={{ justifyContent: 'flex-start', fontWeight: 500, color: 'inherit' }}>
                  {s.name}
                </button>
                {s.nameAr && <small dir="rtl" style={{ alignSelf: 'flex-start' }}>{s.nameAr}</small>}
                <small>{t.subj.usedIn(s.yearGroups, s.classes)}</small>
              </span>
              <div className="row" style={{ gap: 6, flex: 'none' }}>
                <button type="button" className="btn small" onClick={() => { setEditing(s.id); setDraft({ name: s.name, nameAr: s.nameAr ?? '' }); }}>{t.subj.edit}</button>
                <button type="button" className="icon-btn" aria-label={t.common.remove} title={t.common.remove} onClick={() => void remove(s)}>✕</button>
              </div>
            </div>
            {open === s.id && <SubjectUsage id={s.id} />}
          </div>
        ),
      )}
      {!rows.length && <Empty>{t.setup.none}</Empty>}
      <form className="editor-add" onSubmit={add} style={{ flexWrap: 'wrap' }}>
        <input className="input" required aria-label={t.subj.nameEn} placeholder={t.setup.newSubject} value={name} onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 100%' }} />
        <input className="input" dir="rtl" aria-label={t.subj.nameAr} placeholder={t.subj.nameAr} value={nameAr} onChange={(e) => setNameAr(e.target.value)} style={{ flex: '1 1 100%' }} />
        <button className="btn" type="submit" disabled={act.busy}>{t.common.add}</button>
      </form>
    </div>
  );
}
