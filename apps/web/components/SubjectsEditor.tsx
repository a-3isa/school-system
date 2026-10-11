'use client';
import { FormEvent, useState } from 'react';
import { del, patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Empty, ErrorNote, toast } from './ui';

/**
 * The school's subjects: a name in English and, optionally, in Arabic (shown on Arabic screens and
 * report cards). A name can be fixed later; a subject can be deleted only while nothing uses it.
 * Giving a subject a teacher is done in the timetable, class by class.
 */
export function SubjectsEditor() {
  const { t, x } = useI18n();
  const subjects = useApi<any[]>('/subjects');
  const act = useAction();
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
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
    if (!confirm(t.subj.deleteConfirm(s.name))) return;
    if (await act.run(() => del(`/subjects/${s.id}`))) {
      toast(t.subj.deleted);
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
          <div key={s.id} className="editor-row">
            <span><span>{s.name}</span>{s.nameAr && <small dir="rtl" style={{ alignSelf: 'flex-start' }}>{s.nameAr}</small>}</span>
            <div className="row" style={{ gap: 6, flex: 'none' }}>
              <button type="button" className="btn small" onClick={() => { setEditing(s.id); setDraft({ name: s.name, nameAr: s.nameAr ?? '' }); }}>{t.subj.edit}</button>
              <button type="button" className="icon-btn" aria-label={t.common.remove} title={t.common.remove} onClick={() => void remove(s)}>✕</button>
            </div>
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
