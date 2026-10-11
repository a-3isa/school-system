'use client';
import { useState } from 'react';
import { patch, post, todayCairo } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Modal } from './Modal';
import { ErrorNote, Field } from './ui';

export const KINDS = ['CLASSWORK', 'QUIZ', 'HOMEWORK', 'PROJECT', 'MIDTERM', 'FINAL'] as const;
export type AssessmentKind = (typeof KINDS)[number];
export const isExam = (kind: string) => kind === 'MIDTERM' || kind === 'FINAL';
/** How much each kind counts towards the term unless the teacher says otherwise (the API uses the same). */
export const DEFAULT_WEIGHT: Record<AssessmentKind, number> = { CLASSWORK: 1, QUIZ: 1, HOMEWORK: 1, PROJECT: 2, MIDTERM: 3, FINAL: 4 };

/** Adding an assessment for a class and subject, or changing one. Exams also take a time and a room. */
export function AssessmentModal({ pair, assessment, onClose, onSaved }: {
  pair: { classId: string; className: string; subjectId: string; subjectName: string; subjectNameAr?: string | null };
  /** An existing assessment from the gradebook; its kind stays as it is. */
  assessment?: any;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, x, subject } = useI18n();
  const act = useAction();
  const rooms = useApi<any[]>('/rooms');
  const [kind, setKind] = useState<AssessmentKind>(assessment?.kind ?? 'QUIZ');
  const [title, setTitle] = useState<string>(assessment?.title ?? '');
  const [date, setDate] = useState<string>(assessment?.date ?? todayCairo());
  const [max, setMax] = useState<string>(String(assessment?.maxScore ?? 20));
  const [weight, setWeight] = useState<string>(assessment ? String(assessment.weight) : '');
  const [start, setStart] = useState<string>(assessment?.startTime ?? '09:00');
  const [end, setEnd] = useState<string>(assessment?.endTime ?? '10:30');
  const [room, setRoom] = useState<string>(assessment?.roomId ?? '');

  const exam = isExam(kind);
  const maxN = Number(max);
  const ready = title.trim().length > 0 && Number.isInteger(maxN) && maxN >= 1 && maxN <= 1000 && !!date && (!exam || (!!start && !!end));

  async function save() {
    const body: Record<string, unknown> = {
      title: title.trim(), date, maxScore: maxN,
      ...(weight !== '' ? { weight: Number(weight) } : {}),
      ...(exam ? { startTime: start, endTime: end, ...(assessment ? { roomId: room || null } : room ? { roomId: room } : {}) } : {}),
    };
    const ok = await act.run(() => (assessment
      ? patch(`/academics/assessments/${assessment.id}`, body)
      : post('/academics/assessments', { ...body, classId: pair.classId, subjectId: pair.subjectId, kind })));
    if (ok) await onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={assessment ? t.acad.editAssessment : t.acad.newAssessment}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button type="button" className="btn primary" disabled={act.busy || !ready} onClick={() => void save()}>{t.acad.saveAssessment}</button>
        </>
      }
    >
      <div className="form" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <ErrorNote error={act.error && x(act.error)} />
        <p className="muted" style={{ margin: 0 }}>{x(`${pair.className} · ${subject({ name: pair.subjectName, nameAr: pair.subjectNameAr })}`)}</p>
        {!assessment && (
          <div className="field">
            {t.beh.kindLabel}
            <div className="chips" role="radiogroup" aria-label={t.beh.kindLabel}>
              {KINDS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} aria-pressed={kind === k} className="chip-toggle" onClick={() => setKind(k)}>{t.acad.kind[k]}</button>
              ))}
            </div>
          </div>
        )}
        <Field label={t.acad.title} id="as-title">
          <input id="as-title" className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label={t.acad.date} id="as-date"><input id="as-date" className="input num" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t.acad.maxScore} id="as-max"><input id="as-max" className="input num" type="number" min={1} max={1000} step={1} style={{ maxWidth: 120 }} value={max} onChange={(e) => setMax(e.target.value)} /></Field>
          <Field label={t.acad.weight} id="as-weight">
            <input id="as-weight" className="input num" type="number" min={1} max={10} step={1} style={{ maxWidth: 100 }} placeholder={String(DEFAULT_WEIGHT[kind])} value={weight} onChange={(e) => setWeight(e.target.value)} />
          </Field>
        </div>
        <span className="small muted">{t.acad.weightHelp}</span>
        {exam && (
          <div className="row wrap" style={{ gap: 12 }}>
            <Field label={t.acad.startTime} id="as-start"><input id="as-start" className="input num" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label={t.acad.endTime} id="as-end"><input id="as-end" className="input num" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            <Field label={t.acad.room} id="as-room" className="grow">
              <select id="as-room" className="input" value={room} onChange={(e) => setRoom(e.target.value)}>
                <option value="">{t.acad.noRoom}</option>
                {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{x(r.name)}</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
