'use client';
import { FormEvent, useState } from 'react';
import { cairoDate, cairoHm, cairoInstant, patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { byStage } from './ClassPicker';
import { Modal } from './Modal';
import { TimeInput } from './TimeInput';
import { ErrorNote, Field } from './ui';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Planning a trip, or changing one: the day, the lessons it takes, who goes, who leads, the fee and the answer deadline. */
export function TripModal({ trip, onClose, onSaved }: {
  trip: any | null;
  onClose: () => void;
  onSaved: (trip: any) => void | Promise<void>;
}) {
  const { t, x, staff } = useI18n();
  const periods = useApi<any[]>('/periods');
  const classes = useApi<any[]>('/classes');
  const people = useApi<any[]>('/staff');
  const act = useAction();
  const open = trip?.status === 'OPEN';
  const [v, setV] = useState(() => ({
    title: trip?.title ?? '', destination: trip?.destination ?? '', description: trip?.description ?? '',
    date: trip ? String(trip.date).slice(0, 10) : '', departTime: trip?.departTime ?? '08:00', returnTime: trip?.returnTime ?? '14:00',
    fromPeriod: trip?.fromPeriod != null ? String(trip.fromPeriod) : '', toPeriod: trip?.toPeriod != null ? String(trip.toPeriod) : '',
    fee: trip?.fee != null ? String(trip.fee) : '', leaderId: trip?.leader?.id ?? '',
    classIds: (trip?.classes ?? []).map((c: any) => c.id) as string[],
    answerDay: trip ? cairoDate(trip.consentBy) : '', answerTime: trip ? cairoHm(trip.consentBy) : '18:00',
  }));
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const sorted = [...(periods.data ?? [])].sort((a, b) => a.number - b.number);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const wholeDay = !v.fromPeriod || !v.toPeriod;
    const body = {
      title: v.title.trim(), destination: v.destination.trim(), description: trip ? (v.description.trim() || null) : v.description.trim() || undefined,
      date: v.date, departTime: v.departTime, returnTime: v.returnTime,
      fromPeriod: wholeDay ? (trip ? null : undefined) : Number(v.fromPeriod), toPeriod: wholeDay ? (trip ? null : undefined) : Number(v.toPeriod),
      fee: v.fee.trim() === '' ? (trip ? null : undefined) : Number(v.fee), leaderId: v.leaderId || (trip ? null : undefined),
      consentBy: cairoInstant(v.answerDay, v.answerTime).toISOString(),
      // The classes are fixed once the trip is open.
      ...(open ? {} : { classIds: v.classIds }),
    };
    let saved: any;
    if (await act.run(async () => { saved = trip ? await patch(`/trips/${trip.id}`, body) : await post('/trips', body); })) await onSaved(saved);
  }

  const ready = v.title.trim().length >= 2 && v.destination.trim().length >= 2 && !!v.date && TIME.test(v.departTime) && TIME.test(v.returnTime) && !!v.answerDay && TIME.test(v.answerTime) && v.classIds.length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={trip ? t.act.editTrip : t.act.newTrip}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button type="submit" form="trip-form" className="btn primary" disabled={act.busy || !ready}>{act.busy ? t.common.saving : trip ? t.act.save : t.common.add}</button>
        </>
      }
    >
      <form id="trip-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorNote error={act.error && x(act.error)} />
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label={t.act.title} id="trip-title" className="grow"><input id="trip-title" className="input" required maxLength={120} value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label={t.act.destination} id="trip-dest" className="grow"><input id="trip-dest" className="input" required maxLength={120} value={v.destination} onChange={(e) => set({ destination: e.target.value })} /></Field>
        </div>
        <Field label={t.act.description} id="trip-desc"><textarea id="trip-desc" className="input" rows={2} maxLength={2000} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label={t.common.date} id="trip-date"><input id="trip-date" className="input" type="date" required value={v.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label={t.act.departs} id="trip-dep"><TimeInput id="trip-dep" className="input num" required style={{ width: 100 }} value={v.departTime} onChange={(s) => set({ departTime: s })} /></Field>
          <Field label={t.act.returns} id="trip-ret"><TimeInput id="trip-ret" className="input num" required style={{ width: 100 }} value={v.returnTime} onChange={(s) => set({ returnTime: s })} /></Field>
          <Field label={t.act.tripFee} id="trip-fee"><input id="trip-fee" className="input num" type="number" min={0} max={100000} style={{ width: 130 }} value={v.fee} onChange={(e) => set({ fee: e.target.value })} /></Field>
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label={t.act.fromPeriod} id="trip-from">
            <select id="trip-from" className="input" value={v.fromPeriod} onChange={(e) => set({ fromPeriod: e.target.value, toPeriod: e.target.value ? v.toPeriod || e.target.value : '' })}>
              <option value="">{t.act.wholeDay}</option>
              {sorted.map((p) => <option key={p.id} value={p.number}>{t.today.periodN(p.number)} · {p.startTime}</option>)}
            </select>
          </Field>
          {v.fromPeriod && (
            <Field label={t.act.toPeriod} id="trip-to">
              <select id="trip-to" className="input" value={v.toPeriod} onChange={(e) => set({ toPeriod: e.target.value })}>
                {sorted.filter((p) => p.number >= Number(v.fromPeriod)).map((p) => <option key={p.id} value={p.number}>{t.today.periodN(p.number)} · {p.endTime}</option>)}
              </select>
            </Field>
          )}
          <Field label={t.act.leader} id="trip-leader" className="grow">
            <select id="trip-leader" className="input" value={v.leaderId} onChange={(e) => set({ leaderId: e.target.value })}>
              <option value="">{t.act.noLeader}</option>
              {(people.data ?? []).filter((p) => p.role === 'TEACHER' || p.role === 'SCHOOL_ADMIN').map((p) => <option key={p.id} value={p.id}>{staff(p)}</option>)}
            </select>
          </Field>
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <div className="field">
            <span id="trip-by-l">{t.act.answerBy}</span>
            <span className="row" style={{ gap: 8 }} role="group" aria-labelledby="trip-by-l">
              <input className="input" type="date" required aria-label={t.act.answerBy} value={v.answerDay} onChange={(e) => set({ answerDay: e.target.value })} />
              <TimeInput className="input num" required aria-label={t.act.answerBy} style={{ width: 96 }} value={v.answerTime} onChange={(s) => set({ answerTime: s })} />
            </span>
            <span className="help">{t.act.answerByHelp}</span>
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t.act.classes}</span>
          {byStage(classes.data ?? []).map(([stage, list]) => (
            <div key={stage} className="stack" style={{ gap: 4 }}>
              <span className="small muted">{t.eg.stages[stage]}</span>
              <div className="chips" role="group" aria-label={t.act.classes}>
                {list.map((c) => (
                  <button key={c.id} type="button" className="chip-toggle" disabled={open} aria-pressed={v.classIds.includes(c.id)} onClick={() => set({ classIds: v.classIds.includes(c.id) ? v.classIds.filter((i) => i !== c.id) : [...v.classIds, c.id] })}>{x(c.name)}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </form>
    </Modal>
  );
}
