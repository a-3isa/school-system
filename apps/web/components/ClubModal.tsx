'use client';
import { FormEvent, useState } from 'react';
import { patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useGradeName } from './ClassPicker';
import { Modal } from './Modal';
import { TimeInput } from './TimeInput';
import { ErrorNote, Field, Switch } from './ui';

/** Making a club, or changing one: when it meets, where, who runs it, who may join and what it costs. */
export function ClubModal({ club, paidOn, onClose, onSaved }: {
  club: any | null;
  /** Fees are shown and taken only while the school keeps paid clubs on. */
  paidOn: boolean;
  onClose: () => void;
  onSaved: (club: any) => void | Promise<void>;
}) {
  const { t, x, staff, lang } = useI18n();
  const gradeName = useGradeName();
  const school = useApi<any>('/school');
  const rooms = useApi<any[]>('/rooms');
  const grades = useApi<any[]>('/grades');
  const people = useApi<any[]>('/staff');
  const act = useAction();
  const [v, setV] = useState(() => ({
    name: club?.name ?? '', nameAr: club?.nameAr ?? '', description: club?.description ?? '',
    days: (club?.days ?? []) as number[], startTime: club?.startTime ?? '14:30', endTime: club?.endTime ?? '15:30',
    roomId: club?.room?.id ?? '', supervisorId: club?.supervisor?.id ?? '', capacity: String(club?.capacity ?? 20),
    gradeIds: (club?.gradeIds ?? []) as string[], fee: club?.fee != null ? String(club.fee) : '', signupOpen: (club?.signupOpen ?? true) as boolean,
  }));
  const set = (patch_: Partial<typeof v>) => setV((o) => ({ ...o, ...patch_ }));
  const schoolDays: number[] = school.data?.schoolDays ?? [0, 1, 2, 3, 4];
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((i) => i !== id) : [...list, id]);
  // English has short day names; Arabic uses the full ones, which are short enough.
  const shortDay = (d: number) => (lang === 'ar' ? t.days[d] : t.days[d].slice(0, 3));

  async function submit(e: FormEvent) {
    e.preventDefault();
    // An edit sends what was emptied as null, so a cleared field is cleared; a new club leaves it out.
    const blank = (s: string) => (club ? (s.trim() ? s.trim() : null) : s.trim() || undefined);
    const body = {
      name: v.name.trim(), nameAr: blank(v.nameAr), description: blank(v.description), supervisorId: v.supervisorId || (club ? null : undefined), roomId: v.roomId || (club ? null : undefined),
      days: [...v.days].sort(), startTime: v.startTime, endTime: v.endTime, capacity: Number(v.capacity), gradeIds: v.gradeIds, signupOpen: v.signupOpen,
      ...(paidOn ? { fee: v.fee.trim() === '' ? (club ? null : undefined) : Number(v.fee) } : {}),
    };
    let saved: any;
    if (await act.run(async () => { saved = club ? await patch(`/activities/${club.id}`, body) : await post('/activities', body); })) await onSaved(saved);
  }

  const ready = v.name.trim().length >= 2 && v.days.length > 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.endTime) && Number(v.capacity) >= 1;

  return (
    <Modal
      open
      onClose={onClose}
      title={club ? t.act.editClub : t.act.newClub}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button type="submit" form="club-form" className="btn primary" disabled={act.busy || !ready}>{act.busy ? t.common.saving : club ? t.act.save : t.common.add}</button>
        </>
      }
    >
      <form id="club-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorNote error={act.error && x(act.error)} />
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label={t.act.name} id="club-name" className="grow"><input id="club-name" className="input" required maxLength={80} value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label={t.act.nameAr} id="club-name-ar" className="grow"><input id="club-name-ar" className="input" dir="rtl" maxLength={80} value={v.nameAr} onChange={(e) => set({ nameAr: e.target.value })} /></Field>
        </div>
        <Field label={t.act.description} id="club-desc"><textarea id="club-desc" className="input" rows={2} maxLength={1000} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t.act.days}</span>
          <div className="chips" role="group" aria-label={t.act.days}>
            {schoolDays.map((d) => (
              <button key={d} type="button" className="chip-toggle" aria-pressed={v.days.includes(d)} onClick={() => set({ days: v.days.includes(d) ? v.days.filter((i) => i !== d) : [...v.days, d] })}>{shortDay(d)}</button>
            ))}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label={t.act.starts} id="club-start"><TimeInput id="club-start" className="input num" required style={{ width: 110 }} value={v.startTime} onChange={(s) => set({ startTime: s })} /></Field>
          <Field label={t.act.ends} id="club-end"><TimeInput id="club-end" className="input num" required style={{ width: 110 }} value={v.endTime} onChange={(s) => set({ endTime: s })} /></Field>
          <Field label={t.act.capacity} id="club-cap"><input id="club-cap" className="input num" type="number" min={1} max={500} required style={{ width: 110 }} value={v.capacity} onChange={(e) => set({ capacity: e.target.value })} /></Field>
          {paidOn && <Field label={t.act.fee} id="club-fee"><input id="club-fee" className="input num" type="number" min={0} max={100000} style={{ width: 150 }} value={v.fee} onChange={(e) => set({ fee: e.target.value })} /></Field>}
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label={t.act.room} id="club-room" className="grow">
            <select id="club-room" className="input" value={v.roomId} onChange={(e) => set({ roomId: e.target.value })}>
              <option value="">{t.act.noRoom}</option>
              {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label={t.act.supervisor} id="club-sup" className="grow">
            <select id="club-sup" className="input" value={v.supervisorId} onChange={(e) => set({ supervisorId: e.target.value })}>
              <option value="">{t.act.noSupervisor}</option>
              {(people.data ?? []).filter((p) => p.role === 'TEACHER' || p.role === 'SCHOOL_ADMIN').map((p) => <option key={p.id} value={p.id}>{staff(p)}</option>)}
            </select>
          </Field>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t.act.yearGroups}</span>
          <div className="chips" role="group" aria-label={t.act.yearGroups}>
            {[...(grades.data ?? [])].sort((a, b) => a.order - b.order).map((g) => (
              <button key={g.id} type="button" className="chip-toggle" aria-pressed={v.gradeIds.includes(g.id)} onClick={() => set({ gradeIds: toggle(v.gradeIds, g.id) })}>{x(gradeName(g))}</button>
            ))}
          </div>
          {!v.gradeIds.length && <span className="small muted">{t.act.allYearGroups}</span>}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Switch on={v.signupOpen} label={t.act.signupOpen} onChange={(on) => set({ signupOpen: on })} />
          <span className="small">{t.act.signupOpen}</span>
        </div>
      </form>
    </Modal>
  );
}
