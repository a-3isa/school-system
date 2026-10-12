'use client';
import { ReactNode, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

export type Status = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED' | 'ON_TRIP';
/** Tone letters match the status colours: Present, Late, Absent, Excused, On a trip, plus N for neutral blue. */
export type Tone = 'P' | 'L' | 'A' | 'E' | 'T' | 'N' | '';
export const STATUS_TONE: Record<Status, Tone> = { PRESENT: 'P', LATE: 'L', ABSENT: 'A', EXCUSED: 'E', ON_TRIP: 'T' };
/** Each status also has a shape, so it reads without colour. */
export const STATUS_GLYPH: Record<Status, string> = { PRESENT: '✓', LATE: '◔', ABSENT: '✕', EXCUSED: '–', ON_TRIP: '↗' };
export const STATUSES: Status[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'ON_TRIP'];

export function PageHead({ sub, title, actions, crumb }: { sub?: ReactNode; title: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <header className="head">
      <div className="head-text">
        {crumb && <nav className="crumb">{crumb}</nav>}
        {sub && <span className="head-sub">{sub}</span>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </header>
  );
}

export function Section({ title, aside, children, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      {(title || aside) && (
        <div className="section-head">
          {title ? <h2>{title}</h2> : <span />}
          {aside && <span className="aside">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={color ? { color } : undefined}>{value}</span>
      {sub !== undefined && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

export function Pill({ tone = '', glyph, children }: { tone?: Tone; glyph?: string; children: ReactNode }) {
  return (
    <span className={`pill${tone ? ` tone-${tone}` : ''}`}>
      {glyph && <span className="glyph" aria-hidden="true">{glyph}</span>}
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: Status }) {
  const { t } = useI18n();
  return <Pill tone={STATUS_TONE[status]} glyph={STATUS_GLYPH[status]}>{t.status[status]}</Pill>;
}

export function Tag({ tone = '', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag${tone ? ` tone-${tone}` : ''}`}>{children}</span>;
}

export function Tabs<V extends string>({ items, value, onChange, label }: { items: [V, ReactNode][]; value: V; onChange: (v: V) => void; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span className="track"><span className="knob" /></span>
      {on ? t.common.on : t.common.off}
    </button>
  );
}

export function Note({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error'; title?: ReactNode; children?: ReactNode }) {
  const glyph = tone === 'error' ? '✕' : tone === 'warn' ? '!' : 'i';
  return (
    <div className={`note ${tone === 'info' ? '' : tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <b aria-hidden="true">{glyph}</b>
      <span className="note-body">
        {title && <b>{title}</b>}
        {children && <span>{children}</span>}
      </span>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <Note tone="error">{error}</Note>;
}

export function Empty({ children, title }: { children?: ReactNode; title?: ReactNode }) {
  if (title) {
    return (
      <div className="empty big">
        <b>{title}</b>
        {children && <span>{children}</span>}
      </div>
    );
  }
  return <div className="empty">{children}</div>;
}

export function Field({ label, id, help, error, children, className }: { label: ReactNode; id?: string; help?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field${className ? ` ${className}` : ''}`} htmlFor={id}>
      {label}
      {children}
      {error ? <span className="help error" role="alert">{error}</span> : help ? <span className="help">{help}</span> : null}
    </label>
  );
}

/** "Updated just now" / "Updated 12 s ago", quietly, without moving the layout. */
export function LiveStamp({ at }: { at: number | null }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  if (at === null) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  return <span className="live" aria-live="off">{s < 3 ? t.common.justNow : t.common.secondsAgo(s)}</span>;
}

/** Initials for the avatar circle. */
export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

let showToast: (m: string) => void = () => {};
export const toast = (m: string) => showToast(m);

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    showToast = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 4000);
    };
    return () => clearTimeout(t);
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}
