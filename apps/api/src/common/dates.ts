import { BadRequestException } from '@nestjs/common';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD school date as the value stored in a Postgres DATE column. */
export function dbDate(date: string): Date {
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new BadRequestException('Dates must look like 2026-09-30.');
  }
  return new Date(`${date}T00:00:00Z`);
}

/** Back from a DATE column to YYYY-MM-DD. */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Weekday (0 = Sunday) of a YYYY-MM-DD date. */
export const weekday = (date: string) => dbDate(date).getUTCDay();
