'use client';
import { useI18n } from '@/lib/i18n';
import { Field } from './ui';

const COUNTRY_CODES = [['+20', 'EG +20'], ['+966', 'SA +966'], ['+971', 'AE +971'], ['+44', 'UK +44']];
export const RELATIONS = ['MOTHER', 'FATHER', 'GUARDIAN'] as const;

export interface ParentForm { relation: string; name: string; email: string; code: string; phone: string }
export const BLANK_PARENT: ParentForm = { relation: 'MOTHER', name: '', email: '', code: '+20', phone: '' };

/** The body the API takes for a parent, or null when the email is missing. */
export function parentBody(f: ParentForm) {
  if (!f.email.trim() || !f.email.includes('@')) return null;
  const digits = f.phone.replace(/\D/g, '').replace(/^0+/, '');
  return { relation: f.relation, name: f.name.trim(), email: f.email.trim(), ...(digits ? { phone: `${f.code}${digits}` } : {}) };
}

/** Relation, name, email and mobile of a parent or guardian. */
export function ParentFields({ value, onChange, taken = [], emailMissing, prefix }: {
  value: ParentForm;
  onChange: (f: ParentForm) => void;
  taken?: string[];
  emailMissing?: boolean;
  prefix: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t.student.relation} id={`${prefix}-rel`}>
        <select id={`${prefix}-rel`} className="input" value={value.relation} onChange={(e) => onChange({ ...value, relation: e.target.value })}>
          {RELATIONS.filter((r) => !taken.includes(r) || r === value.relation).map((r) => <option key={r} value={r}>{t.students.rel[r]}</option>)}
        </select>
      </Field>
      <Field label={t.student.fullName} id={`${prefix}-name`}>
        <input id={`${prefix}-name`} className="input" required value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </Field>
      <Field label={t.student.emailRequired} id={`${prefix}-email`} className="full" error={emailMissing ? t.student.emailNeeded : undefined}>
        <input id={`${prefix}-email`} className="input" type="email" dir="ltr" placeholder="name@example.com" aria-invalid={emailMissing} value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} />
      </Field>
      <Field label={t.student.mobileOptional} id={`${prefix}-phone`} className="full">
        <span className="phone" dir="ltr">
          <select className="input" aria-label={t.student.countryCode} value={value.code} onChange={(e) => onChange({ ...value, code: e.target.value })}>
            {COUNTRY_CODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input id={`${prefix}-phone`} className="input num" dir="ltr" inputMode="tel" placeholder="100 555 0192" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        </span>
      </Field>
    </>
  );
}
