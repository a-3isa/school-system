'use client';
import { FormEvent, useState } from 'react';
import { del, post, timeCairo, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Empty, ErrorNote, Field, PageHead, Section, toast } from '@/components/ui';
import { TimeInput } from '@/components/TimeInput';

const LENGTHS = [10, 15, 20, 30];

export default function MeetingsPage() {
  const { me } = useSession();
  const { t, x, day, staff } = useI18n();
  const isAdmin = me.role === 'SCHOOL_ADMIN';
  const windows = useApi<any[]>('/meetings');
  const teachers = useApi<any[]>(isAdmin ? '/staff' : null);
  const act = useAction();
  const [form, setForm] = useState({ teacherId: '', date: todayCairo(), fromTime: '14:00', toTime: '15:00', slotMinutes: 20, place: '' });

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await act.run(() => post('/meetings/windows', { ...form, teacherId: isAdmin ? form.teacherId : undefined, place: form.place.trim() }))) {
      toast(t.mtg.created);
      await windows.reload();
    }
  }

  async function remove(id: string) {
    if (!confirm(t.mtg.confirmRemove)) return;
    let told = 0;
    if (await act.run(async () => { told = (await del(`/meetings/windows/${id}`)).cancelled; })) {
      toast(t.mtg.removed(told));
      await windows.reload();
    }
  }

  async function cancel(id: string) {
    if (await act.run(() => post(`/meetings/slots/${id}/cancel`))) {
      toast(t.mtg.cancelled);
      await windows.reload();
    }
  }

  return (
    <>
      <PageHead sub={t.mtg.sub} title={t.nav.meetings} />
      <ErrorNote error={(windows.error ?? act.error) && x((windows.error ?? act.error)!)} />
      <Section title={t.mtg.add}>
        <form className="panel" onSubmit={(e) => void add(e)} style={{ padding: 20, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {isAdmin && (
            <Field label={t.mtg.teacher} id="mtg-teacher">
              <select id="mtg-teacher" className="input" required value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>
                <option value="">{t.mtg.chooseTeacher}</option>
                {(teachers.data ?? []).filter((u) => u.role === 'TEACHER' && u.active !== false).map((u) => <option key={u.id} value={u.id}>{x(staff(u))}</option>)}
              </select>
            </Field>
          )}
          <Field label={t.mtg.date} id="mtg-date"><input id="mtg-date" className="input" type="date" min={todayCairo()} required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label={t.mtg.from} id="mtg-from"><TimeInput id="mtg-from" className="input num" required value={form.fromTime} onChange={(v) => setForm({ ...form, fromTime: v })} /></Field>
          <Field label={t.mtg.to} id="mtg-to"><TimeInput id="mtg-to" className="input num" required value={form.toTime} onChange={(v) => setForm({ ...form, toTime: v })} /></Field>
          <Field label={t.mtg.slot} id="mtg-slot">
            <select id="mtg-slot" className="input" value={form.slotMinutes} onChange={(e) => setForm({ ...form, slotMinutes: Number(e.target.value) })}>
              {LENGTHS.map((n) => <option key={n} value={n}>{t.mtg.minutes(n)}</option>)}
            </select>
          </Field>
          <Field label={t.mtg.place} id="mtg-place" help={t.mtg.placeHelp}>
            <input id="mtg-place" className="input" maxLength={120} required value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} />
          </Field>
          <button className="btn primary" type="submit" disabled={act.busy || (isAdmin && !form.teacherId)}>{t.mtg.create}</button>
        </form>
      </Section>

      <Section title={t.nav.meetings}>
        <div className="panel">
          {windows.data?.length ? (
            windows.data.map((w) => {
              const booked = w.slots.filter((s: any) => s.bookedBy).length;
              return (
                <article key={w.id} className="list-row" style={{ gap: 10, padding: '16px 20px' }}>
                  <div className="row wrap" style={{ alignItems: 'baseline' }}>
                    <strong>{x(`${day(w.date.slice(0, 10), { weekday: 'long', day: 'numeric', month: 'long' })} · ${w.fromTime}–${w.toTime}`)}</strong>
                    <span className="small muted">{x(w.place)} · {isAdmin ? `${x(staff(w.teacher))} · ` : ''}{t.mtg.slots(w.slots.length, booked)}</span>
                    <button type="button" className="link-btn small" style={{ marginInlineStart: 'auto' }} disabled={act.busy} onClick={() => void remove(w.id)}>{t.mtg.remove}</button>
                  </div>
                  <div className="slots">
                    {w.slots.map((s: any) => (
                      <span key={s.id} className={`slot${s.bookedBy ? ' booked' : ''}`}>
                        <b className="num">{timeCairo(s.startsAt)}</b>
                        {s.bookedBy ? (
                          <>
                            <span>{x(t.mtg.bookedBy(s.bookedBy.name, s.student?.firstName ?? ''))}</span>
                            {s.note && <span className="muted">“{x(s.note)}”</span>}
                            <button type="button" className="link-btn small" disabled={act.busy} onClick={() => void cancel(s.id)}>{t.mtg.cancel}</button>
                          </>
                        ) : (
                          <span className="muted">{t.mtg.free}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })
          ) : windows.data ? (
            <Empty title={t.mtg.none}>{t.mtg.noneSub}</Empty>
          ) : (
            <Empty>{t.common.loading}</Empty>
          )}
        </div>
      </Section>
    </>
  );
}
