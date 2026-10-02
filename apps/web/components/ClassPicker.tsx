'use client';
import { useI18n } from '@/lib/i18n';

const STAGES = ['KG', 'PRIMARY', 'PREPARATORY', 'SECONDARY', 'OTHER'];

/** A grade's name in the page's language. */
export function useGradeName() {
  const { lang } = useI18n();
  return (g: { name: string; nameAr?: string | null }) => (lang === 'ar' && g.nameAr ? g.nameAr : g.name);
}

/** Classes grouped by stage, in grade order. */
export function byStage<T extends { grade: { stage?: string; order: number } }>(classes: T[]): [string, T[]][] {
  const sorted = [...classes].sort((a, b) => a.grade.order - b.grade.order);
  return STAGES.map((s): [string, T[]] => [s, sorted.filter((c) => (c.grade.stage ?? 'OTHER') === s)]).filter(([, list]) => list.length > 0);
}

/** A class drop-down with the classes grouped by stage. */
export function ClassSelect({ id, classes, value, onChange, empty, required }: {
  id?: string;
  classes: any[] | null | undefined;
  value: string;
  onChange: (id: string) => void;
  empty: string;
  required?: boolean;
}) {
  const { t } = useI18n();
  const groups = byStage(classes ?? []);
  return (
    <select id={id} className="input" value={value} required={required} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {groups.map(([stage, list]) =>
        groups.length > 1 || stage !== 'OTHER' ? (
          <optgroup key={stage} label={t.eg.stages[stage]}>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        ) : (
          list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
        ),
      )}
    </select>
  );
}

/** "28 of 30" with a bar, red when the class is full. */
export function Places({ n, capacity }: { n: number; capacity?: number | null }) {
  const { t } = useI18n();
  if (!capacity) return <span className="num">{n}</span>;
  const full = n >= capacity;
  return (
    <span className={`cap${full ? ' full' : ''}`} title={full ? t.eg.full : undefined}>
      <span className="num small">{t.eg.placesOf(n, capacity)}</span>
      <span className="cap-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (n / capacity) * 100)}%` }} /></span>
    </span>
  );
}

