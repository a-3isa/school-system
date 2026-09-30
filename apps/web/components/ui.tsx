'use client';
import { ReactNode, useEffect, useState } from 'react';

export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: string; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="card">
      {title && (
        <div className="card-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'alert' | 'info' | 'dark' | '';

export function Badge({ tone = '', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const STATUS_TONE: Record<string, Tone> = { PRESENT: 'ok', LATE: 'warn', ABSENT: 'alert', EXCUSED: 'info', ON_TRIP: 'info' };
export const STATUS_LABEL: Record<string, string> = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', EXCUSED: 'Excused', ON_TRIP: 'On a trip' };

export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      {error}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
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
      t = setTimeout(() => setMsg(null), 3000);
    };
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
