'use client';
import { FormEvent, useEffect, useState } from 'react';
import { blobUrl, cairoDate, cairoHm, cairoInstant, del, patch, post, upload } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Audience, AudiencePicker } from './AudiencePicker';
import { Modal } from './Modal';
import { Thumb, shrink } from './StudentFiles';
import { TimeInput } from './TimeInput';
import { ErrorNote, Field, Switch, toast } from './ui';

/** One saved photo, fetched with the login token, with its caption and a way to remove it. */
function EventPhoto({ eventId, photo, onRemove }: { eventId: string; photo: { id: string; caption: string | null; mime: string }; onRemove: () => void }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string>();
  const path = `/events/${eventId}/photos/${photo.id}`;
  useEffect(() => {
    let url: string | undefined;
    blobUrl(path).then((u) => setSrc((url = u))).catch(() => undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [path]);
  return (
    <span className="paper">
      <Thumb src={src} mime={photo.mime} label={photo.caption ?? t.act.photos} onOpen={() => src && window.open(src, '_blank', 'noopener')} />
      {photo.caption && <span className="small muted">{photo.caption}</span>}
      <button type="button" className="link-btn small" onClick={onRemove}>{t.common.remove}</button>
    </span>
  );
}

/** The photos of a saved event: add several at once (one request each), see them, remove one. */
function Gallery({ event, onChanged }: { event: any; onChanged: () => void | Promise<void> }) {
  const { t, x } = useI18n();
  const detail = useApi<any>(`/events/${event.id}`);
  const act = useAction();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [caption, setCaption] = useState('');
  const photos: any[] = detail.data?.photos ?? [];

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    let added = 0;
    setProgress({ done: 0, total: list.length });
    for (const [i, f] of list.entries()) {
      // One failed photo (too big, wrong kind, over the limit) is reported and the rest still go.
      const ok = await act.run(async () => { await upload(`/events/${event.id}/photos`, await shrink(f), caption.trim() ? { caption: caption.trim() } : {}); });
      if (ok) added++;
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (added) toast(t.act.uploaded(added));
    await detail.reload();
    await onChanged();
  }
  async function remove(id: string) {
    if (!confirm(t.act.deletePhotoConfirm)) return;
    if (await act.run(() => del(`/events/${event.id}/photos/${id}`))) {
      await detail.reload();
      await onChanged();
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <b>{t.act.photos} · {photos.length}</b>
      <ErrorNote error={act.error && x(act.error)} />
      <div className="paper-files">
        {photos.map((p) => <EventPhoto key={p.id} eventId={event.id} photo={p} onRemove={() => void remove(p.id)} />)}
      </div>
      <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
        <input className="input" aria-label={t.act.caption} placeholder={t.act.caption} maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} style={{ maxWidth: 260 }} />
        <label className={`btn${progress ? ' busy' : ''}`}>
          {progress ? t.act.uploading(progress.done, progress.total) : t.act.addPhotos}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={!!progress} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      <span className="small muted">{t.act.photosHelp}</span>
    </div>
  );
}

/** Writing an event: when, where, who it is for. Publishing tells the parents; photos are added once it is saved. */
export function EventModal({ event, onClose, onSaved }: {
  event: any | null;
  onClose: () => void;
  /** Called after any change, so the list refreshes; `close` says the dialog is done. */
  onSaved: (saved: any | null, close: boolean) => void | Promise<void>;
}) {
  const { t, x } = useI18n();
  const clubs = useApi<any[]>('/activities');
  const act = useAction();
  const [v, setV] = useState(() => ({
    title: event?.title ?? '', description: event?.description ?? '', place: event?.place ?? '',
    startDay: event ? cairoDate(event.startsAt) : '', startTime: event && !event.allDay ? cairoHm(event.startsAt) : '09:00',
    endDay: event ? cairoDate(event.endsAt) : '', endTime: event && !event.allDay ? cairoHm(event.endsAt) : '12:00',
    allDay: (event?.allDay ?? false) as boolean,
    audience: (event?.audience ?? { kind: 'SCHOOL', ids: [] }) as Audience,
  }));
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const published = !!event?.publishedAt;

  const body = () => ({
    title: v.title.trim(), description: v.description.trim() || undefined, place: v.place.trim() || undefined, allDay: v.allDay,
    startsAt: cairoInstant(v.startDay, v.allDay ? '00:00' : v.startTime).toISOString(),
    endsAt: cairoInstant(v.endDay || v.startDay, v.allDay ? '23:59' : v.endTime).toISOString(),
    audience: v.audience,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    let saved: any;
    if (await act.run(async () => { saved = event ? await patch(`/events/${event.id}`, body()) : await post('/events', body()); })) {
      toast(event ? t.act.eventSaved : t.act.eventCreated);
      // A new event stays open, so photos can be added to it.
      await onSaved(saved, !!event);
    }
  }
  async function publish() {
    if (!confirm(t.act.publishConfirm)) return;
    let told = 0;
    if (await act.run(async () => { told = (await post(`/events/${event.id}/publish`)).told; })) {
      toast(t.act.publishedDone(told));
      await onSaved(null, true);
    }
  }
  async function remove() {
    if (!confirm(t.act.deleteEventConfirm(event.title))) return;
    if (await act.run(() => del(`/events/${event.id}`))) {
      toast(t.act.eventDeleted);
      await onSaved(null, true);
    }
  }

  const ready = v.title.trim().length > 0 && !!v.startDay && (v.allDay || (/^([01]\d|2[0-3]):[0-5]\d$/.test(v.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.endTime))) && (v.audience.kind === 'SCHOOL' || v.audience.ids.length > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={event ? t.act.editEvent : t.act.newEvent}
      actions={
        <>
          {event && <button type="button" className="btn" disabled={act.busy} onClick={() => void remove()}>{t.act.deleteEvent}</button>}
          {event && !published && <button type="button" className="btn" disabled={act.busy} onClick={() => void publish()}>{t.act.publish}</button>}
          <button type="button" className="btn" onClick={onClose}>{t.common.close}</button>
          <button type="submit" form="event-form" className="btn primary" disabled={act.busy || !ready}>{act.busy ? t.common.saving : event ? t.act.save : t.common.add}</button>
        </>
      }
    >
      <form id="event-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorNote error={act.error && x(act.error)} />
        <Field label={t.act.eventTitle} id="ev-title"><input id="ev-title" className="input" required maxLength={120} value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label={t.act.description} id="ev-desc"><textarea id="ev-desc" className="input" rows={3} maxLength={2000} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="row wrap" style={{ gap: 16 }}>
          <div className="field">
            <span id="ev-start-l">{t.act.starts}</span>
            <span className="row" style={{ gap: 8 }} role="group" aria-labelledby="ev-start-l">
              <input className="input" type="date" required aria-label={t.act.starts} value={v.startDay} onChange={(e) => set({ startDay: e.target.value, endDay: v.endDay || e.target.value })} />
              {!v.allDay && <TimeInput className="input num" required aria-label={t.act.starts} style={{ width: 96 }} value={v.startTime} onChange={(s) => set({ startTime: s })} />}
            </span>
          </div>
          <div className="field">
            <span id="ev-end-l">{t.act.ends}</span>
            <span className="row" style={{ gap: 8 }} role="group" aria-labelledby="ev-end-l">
              <input className="input" type="date" aria-label={t.act.ends} min={v.startDay} value={v.endDay} onChange={(e) => set({ endDay: e.target.value })} />
              {!v.allDay && <TimeInput className="input num" required aria-label={t.act.ends} style={{ width: 96 }} value={v.endTime} onChange={(s) => set({ endTime: s })} />}
            </span>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 14, alignItems: 'flex-end' }}>
          <Field label={t.act.place} id="ev-place" className="grow"><input id="ev-place" className="input" maxLength={200} value={v.place} onChange={(e) => set({ place: e.target.value })} /></Field>
          <span className="row" style={{ gap: 8, paddingBlockEnd: 6 }}>
            <Switch on={v.allDay} label={t.act.allDay} onChange={(on) => set({ allDay: on })} />
            <span className="small">{t.act.allDay}</span>
          </span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t.act.audience}</span>
          <AudiencePicker value={v.audience} onChange={(a) => set({ audience: a })} allowActivity activities={(clubs.data ?? []).map((c) => ({ id: c.id, name: c.name }))} />
        </div>
        {event ? <Gallery event={event} onChanged={() => onSaved(null, false)} /> : <span className="small muted">{t.act.saveFirst}</span>}
      </form>
    </Modal>
  );
}
