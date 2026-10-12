'use client';
import { useState } from 'react';
import { cairoInstant, nowCairo, patch, post, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { has, useSession } from '@/lib/session';
import { Modal } from './Modal';
import { ErrorNote, Field, Tone } from './ui';
import { TimeInput } from './TimeInput';

export type Kind = 'PRAISE' | 'CONCERN' | 'INCIDENT';
/** Merit points a note of each kind may carry (the API enforces the same). */
export const RANGE: Record<Kind, [number, number]> = { PRAISE: [1, 5], CONCERN: [-5, -1], INCIDENT: [-10, 0] };
/** Each kind has a shape as well as a colour, so it reads without colour. */
export const KIND_GLYPH: Record<Kind, string> = { PRAISE: '★', CONCERN: '!', INCIDENT: '⚠' };
export const KIND_TONE: Record<Kind, Tone> = { PRAISE: 'P', CONCERN: 'L', INCIDENT: 'A' };

/**
 * Writing a note about a student, or changing one. Give `student` to write
 * about one student (from their page or the register); leave it out to choose.
 */
export function NoteModal({ student, note, onClose, onSaved }: {
  student?: { id: string; name: string };
  /** An existing note to change; its kind and student stay as they are. */
  note?: any;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, x } = useI18n();
  const { me } = useSession();
  const merits = has(me, 'behavior', 'merits');
  const kinds: Kind[] = me.role === 'TEACHER' ? ['PRAISE', 'CONCERN'] : ['PRAISE', 'CONCERN', 'INCIDENT'];
  const cats = useApi<Record<Kind, string[]>>('/behaviour/categories');
  const students = useApi<any[]>(student || note ? null : '/behaviour/students');
  const act = useAction();

  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState(student?.id ?? '');
  const [kind, setKind] = useState<Kind>(note?.kind ?? 'PRAISE');
  const [category, setCategory] = useState<string>(note?.category ?? '');
  const [text, setText] = useState<string>(note?.text ?? '');
  const [points, setPoints] = useState<string>(note?.points != null ? String(note.points) : '');
  const [share, setShare] = useState<boolean>(note ? note.visibleToParents : true);
  const [severity, setSeverity] = useState<string>(note?.severity ?? 'MINOR');
  const [action, setAction] = useState<string>(note?.actionTaken ?? '');
  const [place, setPlace] = useState<string>(note?.place ?? '');
  const [date, setDate] = useState(todayCairo());
  const [time, setTime] = useState(nowCairo());

  const classes = [...new Map((students.data ?? []).filter((s) => s.class).map((s) => [s.class.id, s.class.name])).entries()];
  const pickable = (students.data ?? []).filter((s) => !classId || s.class?.id === classId);
  const [min, max] = RANGE[kind];

  const pickKind = (k: Kind) => {
    setKind(k);
    setCategory('');
    setShare(k !== 'INCIDENT'); // an incident is kept back until Student Affairs decides
    setPoints('');
  };

  const ready = !!(studentId || note) && !!category && text.trim().length >= 3;

  async function save() {
    const body: Record<string, unknown> = {
      category, text: text.trim(), visibleToParents: share,
      ...(merits ? (points === '' ? (note ? { points: null } : {}) : { points: Number(points) }) : {}),
      ...(kind === 'INCIDENT' ? { severity, actionTaken: action.trim() || undefined, place: place.trim() || undefined } : {}),
    };
    const ok = await act.run(() => (note
      ? patch(`/behaviour/${note.id}`, body)
      : post('/behaviour', { ...body, studentId, kind, occurredAt: cairoInstant(date, time).toISOString() })));
    if (ok) await onSaved();
  }

  const who = student?.name ?? (note ? `${note.student.firstName} ${note.student.lastName}` : null);
  return (
    <Modal
      open
      onClose={onClose}
      title={note ? t.beh.edit : who ? t.beh.noteTitle(x(who)) : t.beh.new}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button type="button" className="btn primary" disabled={act.busy || !ready} onClick={() => void save()}>{t.beh.save}</button>
        </>
      }
    >
      <div className="form" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <ErrorNote error={act.error && x(act.error)} />
        {!student && !note && (
          <div className="row wrap" style={{ gap: 12 }}>
            <Field label={t.common.class} id="note-class">
              <select id="note-class" className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setStudentId(''); }}>
                <option value="">{t.common.allClasses}</option>
                {classes.map(([cid, name]) => <option key={cid} value={cid}>{x(name)}</option>)}
              </select>
            </Field>
            <Field label={t.beh.student} id="note-student" className="grow">
              <select id="note-student" className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">{t.beh.chooseStudent}</option>
                {pickable.map((s) => <option key={s.id} value={s.id}>{x(`${s.firstName} ${s.lastName}`)}</option>)}
              </select>
            </Field>
          </div>
        )}
        {!note && (
          <div className="field">
            {t.beh.kindLabel}
            <div className="chips" role="radiogroup" aria-label={t.beh.kindLabel}>
              {kinds.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} aria-pressed={kind === k} className="chip-toggle" onClick={() => pickKind(k)}>
                  <span aria-hidden="true">{KIND_GLYPH[k]} </span>{t.beh.kind[k]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          {t.beh.category}
          <div className="chips" role="radiogroup" aria-label={t.beh.category}>
            {(cats.data?.[kind] ?? []).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={category === c} aria-pressed={category === c} className="chip-toggle" onClick={() => setCategory(c)}>{t.beh.cat[c] ?? c}</button>
            ))}
          </div>
        </div>
        <Field label={t.beh.text} id="note-text">
          <textarea id="note-text" className="input" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {kind === 'INCIDENT' && (
          <>
            <div className="row wrap" style={{ gap: 12 }}>
              <Field label={t.beh.severityLabel} id="note-severity">
                <select id="note-severity" className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  {Object.keys(t.beh.severity).map((v) => <option key={v} value={v}>{t.beh.severity[v]}</option>)}
                </select>
              </Field>
              <Field label={t.beh.place} id="note-place" className="grow">
                <input id="note-place" className="input" maxLength={200} value={place} onChange={(e) => setPlace(e.target.value)} />
              </Field>
            </div>
            <Field label={t.beh.actionTaken} id="note-action">
              <textarea id="note-action" className="input" rows={2} maxLength={1000} value={action} onChange={(e) => setAction(e.target.value)} />
            </Field>
          </>
        )}
        {merits && (
          <Field label={t.beh.points} id="note-points" help={t.beh.pointsHelp(min, max)}>
            <input id="note-points" className="input num" type="number" min={min} max={max} step={1} style={{ maxWidth: 140 }} value={points} onChange={(e) => setPoints(e.target.value)} />
          </Field>
        )}
        {!note && (
          <div className="row wrap" style={{ gap: 12 }}>
            <Field label={t.beh.date} id="note-date"><input id="note-date" className="input" type="date" max={todayCairo()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label={t.beh.time} id="note-time"><TimeInput id="note-time" className="input num" value={time} onChange={(v) => setTime(v)} /></Field>
          </div>
        )}
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>{t.beh.share}</span>
        </label>
      </div>
    </Modal>
  );
}
