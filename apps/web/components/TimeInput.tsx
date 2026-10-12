'use client';
import { InputHTMLAttributes } from 'react';
import { useI18n } from '@/lib/i18n';

/** "0830", "830" and "8:30" all become "08:30", and anything else typed is dropped. */
export function formatTime(raw: string): string {
  const short = /^(\d):(\d{0,2})$/.exec(raw);
  if (short) return `0${short[1]}:${short[2]}`;
  let digits = raw.replace(/\D/g, '').slice(0, 4);
  // An hour can't start with 3 to 9, so "8" means 08.
  if (digits && digits[0] > '2') digits = `0${digits}`.slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/**
 * A time of day the school's way: 24-hour, Latin digits, whatever the language of the device.
 * (The browser's own time picker follows the device, so on an Arabic phone or PC it shows 12-hour
 * with Arabic digits and AM/PM.)
 */
export function TimeInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      dir="ltr"
      maxLength={5}
      placeholder="HH:mm"
      pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
      title={t.common.timeHint}
      value={value}
      onChange={(e) => onChange(formatTime(e.target.value))}
    />
  );
}
