import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { weekday } from '../common/dates';

/** Why a day has no school, or which term it is in. */
export interface DayStatus {
  open: boolean;
  reason?: 'WEEKEND' | 'HOLIDAY' | 'BREAK' | 'OUTSIDE_YEAR';
  name?: string; // the holiday's name, e.g. "Armed Forces Day"
  term?: 1 | 2;
  year?: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The school's calendar: a school day is one of its weekdays, inside a school
 * year (when the school has set one), outside the mid-year break and not a
 * holiday. A school that hasn't set a year yet only has weekdays.
 */
@Injectable()
export class SchoolCalendar {
  constructor(private readonly prisma: PrismaService) {}

  async day(school: { id: string; schoolDays: number[] }, date: string): Promise<DayStatus> {
    if (!school.schoolDays.includes(weekday(date))) return { open: false, reason: 'WEEKEND' };
    const day = new Date(`${date}T00:00:00Z`);
    const [holiday, years] = await Promise.all([
      this.prisma.holiday.findFirst({ where: { schoolId: school.id, fromDate: { lte: day }, toDate: { gte: day } }, orderBy: { fromDate: 'asc' } }),
      this.prisma.academicYear.findMany({ where: { schoolId: school.id }, orderBy: { startsOn: 'asc' } }),
    ]);
    if (holiday) return { open: false, reason: 'HOLIDAY', name: holiday.name };
    if (!years.length) return { open: true };
    const year = years.find((y) => iso(y.startsOn) <= date && date <= iso(y.endsOn));
    if (!year) return { open: false, reason: 'OUTSIDE_YEAR' };
    if (year.breakFrom && year.breakTo && iso(year.breakFrom) <= date && date <= iso(year.breakTo)) {
      return { open: false, reason: 'BREAK', year: year.name };
    }
    const term = year.term2StartsOn && date >= iso(year.term2StartsOn) ? 2 : 1;
    return { open: true, term, year: year.name };
  }

  async isOpen(school: { id: string; schoolDays: number[] }, date: string) {
    return (await this.day(school, date)).open;
  }

  /** The school days from `from` to `to` (both YYYY-MM-DD, inclusive), found with two queries rather than one per day. */
  async openDays(school: { id: string; schoolDays: number[] }, from: string, to: string): Promise<string[]> {
    if (from > to) return [];
    const [holidays, years] = await Promise.all([
      this.prisma.holiday.findMany({ where: { schoolId: school.id, toDate: { gte: new Date(`${from}T00:00:00Z`) }, fromDate: { lte: new Date(`${to}T00:00:00Z`) } } }),
      this.prisma.academicYear.findMany({ where: { schoolId: school.id }, orderBy: { startsOn: 'asc' } }),
    ]);
    const out: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400_000) {
      const date = iso(new Date(t));
      if (!school.schoolDays.includes(weekday(date))) continue;
      if (holidays.some((h) => iso(h.fromDate) <= date && date <= iso(h.toDate))) continue;
      if (years.length) {
        const year = years.find((y) => iso(y.startsOn) <= date && date <= iso(y.endsOn));
        if (!year) continue;
        if (year.breakFrom && year.breakTo && iso(year.breakFrom) <= date && date <= iso(year.breakTo)) continue;
      }
      out.push(date);
    }
    return out;
  }

  /**
   * The academic year and term a date falls in, open day or not. The mid-year
   * break counts as term 1. `null` when the date is in no academic year.
   */
  async termOf(schoolId: string, date: string): Promise<TermOf | null> {
    const day = new Date(`${date}T00:00:00Z`);
    const year = await this.prisma.academicYear.findFirst({ where: { schoolId, startsOn: { lte: day }, endsOn: { gte: day } } });
    if (!year) return null;
    const startsOn = iso(year.startsOn);
    const endsOn = iso(year.endsOn);
    const term2 = year.term2StartsOn ? iso(year.term2StartsOn) : null;
    const term: 1 | 2 = term2 && date >= term2 ? 2 : 1;
    const dayBefore = (d: string) => iso(new Date(new Date(`${d}T00:00:00Z`).getTime() - 86400_000));
    return {
      yearId: year.id,
      yearName: year.name,
      term,
      startsOn,
      endsOn,
      termStartsOn: term === 2 ? term2! : startsOn,
      termEndsOn: term === 1 && term2 ? dayBefore(term2) : endsOn,
    };
  }
}

export interface TermOf {
  yearId: string;
  yearName: string;
  term: 1 | 2;
  startsOn: string;
  endsOn: string;
  termStartsOn: string;
  termEndsOn: string;
}

@Global()
@Module({ providers: [SchoolCalendar], exports: [SchoolCalendar] })
export class CalendarModule {}
