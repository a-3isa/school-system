'use client';
import { del, put } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useGradeName } from './ClassPicker';
import { Empty, ErrorNote, Section } from './ui';

/**
 * What each year group studies. The periods are the school's and the same for every class; a year group has
 * its subjects (and, if the school counts them, the lessons a week of each); every class of it then studies
 * the same ones. Which teacher takes a subject in a class, and where it sits in the week, is decided per class
 * on the Timetable page.
 */
export function GradeSubjectsEditor() {
  const { t, x, subject } = useI18n();
  const gradeName = useGradeName();
  const grades = useApi<any[]>('/grades');
  const subjects = useApi<any[]>('/subjects');
  const curriculum = useApi<{ gradeId: string; subjectId: string; lessonsPerWeek: number | null }[]>('/curriculum');
  const act = useAction();

  const row = (gradeId: string, subjectId: string) => curriculum.data?.find((r) => r.gradeId === gradeId && r.subjectId === subjectId);
  const path = (gradeId: string, subjectId: string) => `/grades/${gradeId}/subjects/${subjectId}`;
  const save = async (fn: () => Promise<unknown>) => {
    if (await act.run(fn)) await curriculum.reload();
  };

  const err = act.error ?? grades.error ?? subjects.error ?? curriculum.error;
  return (
    <Section id="year-group-subjects" title={t.subj.gradeTitle} aside={t.subj.gradeSub}>
      <ErrorNote error={err && x(err)} />
      {grades.data && !grades.data.length && <Empty>{t.subj.noGrades}</Empty>}
      {subjects.data && !subjects.data.length && <Empty>{t.subj.noSubjects}</Empty>}
      {!!subjects.data?.length && (grades.data ?? []).map((g) => (
        <div key={g.id} className="panel" style={{ marginBlockEnd: 12 }}>
          <div className="editor-head"><b>{x(gradeName(g))}</b><span className="num">{(curriculum.data ?? []).filter((r) => r.gradeId === g.id).length}</span></div>
          <div className="chips" style={{ padding: '14px 18px', gap: 12 }} role="group" aria-label={x(gradeName(g))}>
            {subjects.data!.map((s) => {
              const r = row(g.id, s.id);
              return (
                <span key={s.id} className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="chip-toggle"
                    aria-pressed={!!r}
                    disabled={act.busy}
                    title={t.subj.studies(gradeName(g), subject(s))}
                    onClick={() => void save(() => (r ? del(path(g.id, s.id)) : put(path(g.id, s.id), {})))}
                  >
                    {r ? '✓ ' : ''}{x(subject(s))}
                  </button>
                  {r && (
                    <input
                      key={`${g.id}:${s.id}:${r.lessonsPerWeek ?? ''}`}
                      className="input num"
                      type="number"
                      min={1}
                      max={20}
                      aria-label={t.subj.perWeekFor(subject(s))}
                      title={t.subj.perWeek}
                      placeholder="#"
                      defaultValue={r.lessonsPerWeek ?? ''}
                      style={{ width: 64, height: 36 }}
                      onBlur={(e) => {
                        if (e.target.value === String(r.lessonsPerWeek ?? '')) return;
                        void save(() => put(path(g.id, s.id), { lessonsPerWeek: e.target.value === '' ? null : Number(e.target.value) }));
                      }}
                    />
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </Section>
  );
}
