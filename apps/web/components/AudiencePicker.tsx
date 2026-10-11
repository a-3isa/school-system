'use client';
import { useApi } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { byStage, useGradeName } from './ClassPicker';

export type AudienceKind = 'SCHOOL' | 'GRADES' | 'CLASSES' | 'ACTIVITY';
/** What the API takes as `audience` (see apps/api/src/common/audience.ts). */
export interface Audience {
  kind: AudienceKind;
  ids: string[];
}

/** Whole school, some year groups, some classes, or a club: who a message or event is for. */
export function AudiencePicker({ value, onChange, allowActivity, activities }: {
  value: Audience;
  onChange: (a: Audience) => void;
  /** Offer "A club" (needs `activities`). */
  allowActivity?: boolean;
  activities?: { id: string; name: string }[];
}) {
  const { t, x } = useI18n();
  const gradeName = useGradeName();
  const grades = useApi<any[]>(value.kind === 'GRADES' ? '/grades' : null);
  const classes = useApi<any[]>(value.kind === 'CLASSES' ? '/classes' : null);

  const kinds: AudienceKind[] = allowActivity ? ['SCHOOL', 'GRADES', 'CLASSES', 'ACTIVITY'] : ['SCHOOL', 'GRADES', 'CLASSES'];
  const toggle = (id: string) =>
    onChange({ ...value, ids: value.ids.includes(id) ? value.ids.filter((i) => i !== id) : [...value.ids, id] });

  const chip = (id: string, label: string) => (
    <button key={id} type="button" className="chip-toggle" aria-pressed={value.ids.includes(id)} onClick={() => toggle(id)}>{label}</button>
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="chips" role="radiogroup" aria-label={t.audience.label}>
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value.kind === k} className="chip-toggle" aria-pressed={value.kind === k} onClick={() => onChange({ kind: k, ids: [] })}>
            {t.audience[k]}
          </button>
        ))}
      </div>
      {value.kind === 'GRADES' && (
        <div className="chips" role="group" aria-label={t.audience.pickGrades}>
          {[...(grades.data ?? [])].sort((a, b) => a.order - b.order).map((g) => chip(g.id, gradeName(g)))}
        </div>
      )}
      {value.kind === 'CLASSES' && (
        <div className="stack" style={{ gap: 8 }} role="group" aria-label={t.audience.pickClasses}>
          {byStage(classes.data ?? []).map(([stage, list]) => (
            <div key={stage} className="stack" style={{ gap: 4 }}>
              <span className="small muted">{t.eg.stages[stage]}</span>
              <div className="chips">{list.map((c) => chip(c.id, x(c.name)))}</div>
            </div>
          ))}
        </div>
      )}
      {value.kind === 'ACTIVITY' && (
        <div className="chips" role="group" aria-label={t.audience.pickClub}>
          {(activities ?? []).map((a) => chip(a.id, a.name))}
        </div>
      )}
      <span className="small muted">{t.audience.summary(value.kind, value.ids.length)}</span>
    </div>
  );
}
