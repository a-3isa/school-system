'use client';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { del, post, put } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { AssessmentModal, isExam } from '@/components/AssessmentModal';
import { Empty, ErrorNote, Note, PageHead, Tabs, Tag, toast } from '@/components/ui';

/** What is typed in one cell: a score, or absent (ABS), or absent with an excuse (EXC). */
interface Cell {
  score: string;
  state: '' | 'ABS' | 'EXC';
}

const fromMark = (m: { score: number | null; absent: boolean; excused: boolean } | undefined): Cell =>
  !m ? { score: '', state: '' } : m.absent ? { score: '', state: m.excused ? 'EXC' : 'ABS' } : { score: m.score === null ? '' : String(m.score), state: '' };
/** Two cells are the same mark whatever way the number was typed ("18" and "18.0"). */
const norm = (c: Cell) => c.state || (c.score.trim() === '' ? '' : String(Number(c.score)));
const NEXT: Record<Cell['state'], Cell['state']> = { '': 'ABS', ABS: 'EXC', EXC: '' };

export default function GradebookPage() {
  const { me } = useSession();
  const { t, x, dir, subject } = useI18n();
  const pairs = useApi<any[]>('/academics/teaching');
  const [pairKey, setPairKey] = useState('');
  const [termSel, setTermSel] = useState<'1' | '2' | null>(null);
  const [edits, setEdits] = useState<Record<string, Cell>>({});
  const [modal, setModal] = useState<{ assessment?: any } | null>(null);
  const save = useAction();
  const act = useAction();
  const refs = useRef(new Map<string, HTMLInputElement>());

  const list = pairs.data ?? [];
  const pair = list.find((p) => `${p.classId}:${p.subjectId}` === pairKey) ?? list.find((p) => p.canMark) ?? list[0]; // starts on a subject they can mark
  const gb = useApi<any>(pair ? `/academics/gradebook?classId=${pair.classId}&subjectId=${pair.subjectId}${termSel ? `&term=${termSel}` : ''}` : null);
  const term = String(termSel ?? gb.data?.term ?? 1) as '1' | '2';
  const canMark = !!pair?.canMark;

  // A different class, subject or term starts with nothing typed.
  useEffect(() => setEdits({}), [pair?.classId, pair?.subjectId, termSel]);

  const students: any[] = gb.data?.students ?? [];
  const assessments: any[] = gb.data?.assessments ?? [];
  const key = (s: string, a: string) => `${s}:${a}`;
  const cellOf = (s: any, a: any): Cell => edits[key(s.id, a.id)] ?? fromMark(s.marks[a.id]);
  const invalid = (c: Cell, a: any) => c.state === '' && c.score.trim() !== '' && !(Number(c.score) >= 0 && Number(c.score) <= a.maxScore);

  const dirty = students.flatMap((s) => assessments.filter((a) => norm(cellOf(s, a)) !== norm(fromMark(s.marks[a.id]))).map((a) => ({ s, a })));
  const anyInvalid = dirty.some(({ s, a }) => invalid(cellOf(s, a), a));

  function setCell(s: any, a: any, c: Cell) {
    setEdits((e) => ({ ...e, [key(s.id, a.id)]: c }));
  }

  async function submit() {
    const byAssessment = new Map<string, any[]>();
    for (const { s, a } of dirty) {
      const c = cellOf(s, a);
      const comment = s.marks[a.id]?.comment ?? undefined; // a comment already there is kept
      const mark = c.state ? { studentId: s.id, absent: true, excused: c.state === 'EXC', comment } : c.score.trim() === '' ? { studentId: s.id, comment } : { studentId: s.id, score: Number(c.score), comment };
      byAssessment.set(a.id, [...(byAssessment.get(a.id) ?? []), mark]);
    }
    const ok = await save.run(async () => {
      for (const [id, marks] of byAssessment) await put(`/academics/assessments/${id}/marks`, { marks });
      setEdits({});
      await gb.reload();
    });
    if (ok) toast(t.acad.marksSaved);
  }

  async function menu(a: any, choice: string) {
    if (!choice) return;
    if (choice === 'edit') return setModal({ assessment: a });
    if (dirty.length) return toast(t.acad.saveFirst);
    if (choice === 'publish' && confirm(t.acad.publishConfirm)) {
      let told = 0;
      if (await act.run(async () => { told = (await post(`/academics/assessments/${a.id}/publish`)).told ?? 0; })) toast(t.acad.publishedToast(told));
    } else if (choice === 'unpublish' && confirm(t.acad.unpublishConfirm)) {
      if (await act.run(() => post(`/academics/assessments/${a.id}/unpublish`))) toast(t.acad.unpublishedToast);
    } else if (choice === 'delete' && confirm(t.acad.deleteConfirm)) {
      if (await act.run(() => del(`/academics/assessments/${a.id}`))) toast(t.acad.deletedToast);
    }
    await gb.reload();
  }

  /** Arrow keys and Enter move between cells, the way the register moves between rows. */
  function move(e: KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const rtl = dir === 'rtl';
    const [dr, dc] = e.key === 'ArrowDown' || e.key === 'Enter' ? [1, 0] : e.key === 'ArrowUp' ? [-1, 0] : e.key === 'ArrowLeft' ? [0, rtl ? 1 : -1] : e.key === 'ArrowRight' ? [0, rtl ? -1 : 1] : [0, 0];
    if (!dr && !dc) return;
    const target = refs.current.get(`${r + dr}:${c + dc}`);
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.select();
  }

  const chooser = (
    <div className="toolbar">
      <select className="input" aria-label={t.acad.pick} value={pair ? `${pair.classId}:${pair.subjectId}` : ''} onChange={(e) => setPairKey(e.target.value)} style={{ maxWidth: 280 }}>
        {list.map((p) => <option key={`${p.classId}:${p.subjectId}`} value={`${p.classId}:${p.subjectId}`}>{x(`${p.className} · ${subject({ name: p.subjectName, nameAr: p.subjectNameAr })}`)}</option>)}
      </select>
      <Tabs label={t.acad.pick} value={term} onChange={(v) => setTermSel(v)} items={[['1', t.acad.term(1)], ['2', t.acad.term(2)]]} />
    </div>
  );

  return (
    <>
      <PageHead
        sub={t.acad.gradebookSub}
        title={t.nav.gradebook}
        actions={pair && canMark ? <button type="button" className="btn primary" onClick={() => setModal({})}>{t.acad.newAssessment}</button> : undefined}
      />
      {pair && chooser}
      <ErrorNote error={(pairs.error ?? gb.error ?? act.error ?? save.error) && x((pairs.error ?? gb.error ?? act.error ?? save.error)!)} />
      {pairs.data && !list.length && <Empty title={t.acad.noPairs}>{t.acad.noPairsSub}</Empty>}
      {pair && !canMark && <Note tone="info">{t.acad.readOnly}</Note>}
      {pair && canMark && assessments.some((a) => a.publishedAt) && <p className="small muted" style={{ margin: 0 }}>{t.acad.afterPublish}</p>}
      {pair && gb.data && (
        <section className="panel scroll">
          {assessments.length ? (
            <table className="gb">
              <thead>
                <tr>
                  <th className="stu">{t.acad.student}</th>
                  {assessments.map((a) => (
                    <th key={a.id}>
                      <div className="gb-head">
                        <b>{x(a.title)}</b>
                        <span className="row wrap" style={{ gap: 6 }}>
                          <Tag tone={isExam(a.kind) ? 'L' : 'E'}>{t.acad.kind[a.kind] ?? a.kind}</Tag>
                          <Tag tone={a.publishedAt ? 'P' : ''}>{a.publishedAt ? t.acad.published : t.acad.draft}</Tag>
                        </span>
                        <span className="small muted num"><bdi dir="ltr">{a.date}</bdi> · {t.acad.outOf(a.maxScore)}</span>
                        {canMark && (
                          <select className="input small-select" aria-label={`${a.title}: ${t.common.choose}`} value="" onChange={(e) => void menu(a, e.target.value)}>
                            <option value="">⋯</option>
                            <option value="edit">{t.acad.edit}</option>
                            {!a.publishedAt && <option value="publish">{t.acad.publish}</option>}
                            {a.publishedAt && me.role === 'SCHOOL_ADMIN' && <option value="unpublish">{t.acad.unpublish}</option>}
                            {!a.publishedAt && <option value="delete">{t.acad.delete}</option>}
                          </select>
                        )}
                      </div>
                    </th>
                  ))}
                  <th>{t.acad.percentCol}</th>
                  <th>{t.acad.gradeCol}</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, r) => (
                  <tr key={s.id}>
                    <td className="stu">{x(s.name)}</td>
                    {assessments.map((a, c) => {
                      const cell = cellOf(s, a);
                      const changed = norm(cell) !== norm(fromMark(s.marks[a.id]));
                      return (
                        <td key={a.id}>
                          <div className={`gb-cell${changed ? ' changed' : ''}`}>
                            {cell.state ? (
                              <span className="gb-flag" title={cell.state === 'EXC' ? t.acad.excusedTip : t.acad.absentTip}>{cell.state === 'EXC' ? t.acad.excusedShort : t.acad.absentShort}</span>
                            ) : (
                              <input
                                ref={(el) => { if (el) refs.current.set(`${r}:${c}`, el); else refs.current.delete(`${r}:${c}`); }}
                                className="input num"
                                inputMode="decimal"
                                aria-label={`${s.name} · ${a.title}`}
                                aria-invalid={invalid(cell, a) || undefined}
                                disabled={!canMark}
                                value={cell.score}
                                onChange={(e) => setCell(s, a, { score: e.target.value.replace(',', '.'), state: '' })}
                                onKeyDown={(e) => move(e, r, c)}
                              />
                            )}
                            {canMark && (
                              <button type="button" className="gb-abs" aria-pressed={cell.state !== ''} title={cell.state === 'ABS' ? t.acad.absentTip : cell.state === 'EXC' ? t.acad.excusedTip : t.acad.absentShort} onClick={() => setCell(s, a, { score: '', state: NEXT[cell.state] })}>
                                {cell.state === 'EXC' ? '–' : cell.state === 'ABS' ? '✕' : t.acad.absentShort}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="num strong">{s.percent === null ? <span className="muted">—</span> : x(`${s.percent}%`)}</td>
                    <td>{s.band ? <Tag tone="N">{x(s.band.label)}</Tag> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title={t.acad.noAssessments}>{canMark ? t.acad.noAssessmentsSub : undefined}</Empty>
          )}
        </section>
      )}
      {pair && gb.data && canMark && assessments.length > 0 && (
        <div className="gb-foot">
          <span className="small muted" aria-live="polite">{anyInvalid ? t.acad.checkScores : dirty.length ? t.acad.unsavedN(dirty.length) : `✓ ${t.acad.marksSaved}`}</span>
          <button type="button" className="btn primary" disabled={!dirty.length || anyInvalid || save.busy} onClick={() => void submit()}>{save.busy ? t.common.saving : t.acad.saveN(dirty.length)}</button>
        </div>
      )}
      {modal && pair && (
        <AssessmentModal
          key={modal.assessment?.id ?? 'new'}
          pair={pair}
          assessment={modal.assessment}
          onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); toast(t.acad.assessmentSaved); await gb.reload(); }}
        />
      )}
    </>
  );
}
