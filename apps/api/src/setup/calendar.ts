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
}

@Global()
@Module({ providers: [SchoolCalendar], exports: [SchoolCalendar] })
export class CalendarModule {}
