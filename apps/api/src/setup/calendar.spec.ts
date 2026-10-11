import { PrismaService } from '../prisma/prisma.service';
import { SchoolCalendar } from './calendar';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** A school year 2026/27 with the mid-year break from 24 Jan to 4 Feb and term 2 from 7 Feb. */
function calendar(over: Record<string, unknown> = {}) {
  const year = { id: 'y1', name: '2026/2027', startsOn: d('2026-09-13'), endsOn: d('2027-06-30'), term2StartsOn: d('2027-02-07'), breakFrom: d('2027-01-24'), breakTo: d('2027-02-04'), ...over };
  const prisma = {
    academicYear: {
      findFirst: jest.fn(async ({ where }: any) => (where.startsOn.lte >= year.startsOn && where.endsOn.gte <= year.endsOn ? year : null)),
    },
  };
  return new SchoolCalendar(prisma as unknown as PrismaService);
}

describe('SchoolCalendar.openDays', () => {
  const school = { id: 's1', schoolDays: [0, 1, 2, 3, 4] }; // Sunday to Thursday
  function calendarWith(holidays: { fromDate: Date; toDate: Date }[]) {
    const years = [{ startsOn: d('2026-09-13'), endsOn: d('2027-06-30'), breakFrom: d('2027-01-24'), breakTo: d('2027-02-04') }];
    return new SchoolCalendar({ holiday: { findMany: jest.fn(async () => holidays) }, academicYear: { findMany: jest.fn(async () => years) } } as unknown as PrismaService);
  }

  it('lists the school days, skipping weekends and holidays', async () => {
    // 4 Oct 2026 is a Sunday; 8 Oct is a Thursday; 6 Oct is a holiday here.
    const days = await calendarWith([{ fromDate: d('2026-10-06'), toDate: d('2026-10-06') }]).openDays(school, '2026-10-04', '2026-10-11');
    expect(days).toEqual(['2026-10-04', '2026-10-05', '2026-10-07', '2026-10-08', '2026-10-11']);
  });

  it('skips the mid-year break and days outside the year', async () => {
    expect(await calendarWith([]).openDays(school, '2027-01-21', '2027-02-07')).toEqual(['2027-01-21', '2027-02-07']);
    expect(await calendarWith([]).openDays(school, '2026-09-10', '2026-09-14')).toEqual(['2026-09-13', '2026-09-14']);
  });

  it('is empty for a backwards range', async () => {
    expect(await calendarWith([]).openDays(school, '2026-10-10', '2026-10-01')).toEqual([]);
  });
});

describe('SchoolCalendar.termOf', () => {
  it('finds term 1 and the day it ends before term 2 starts', async () => {
    const t = await calendar().termOf('s1', '2026-10-01');
    expect(t).toEqual({ yearId: 'y1', yearName: '2026/2027', term: 1, startsOn: '2026-09-13', endsOn: '2027-06-30', termStartsOn: '2026-09-13', termEndsOn: '2027-02-06' });
  });

  it('counts the mid-year break as term 1', async () => {
    expect((await calendar().termOf('s1', '2027-01-30'))?.term).toBe(1);
  });

  it('finds term 2 from its first day to the end of the year', async () => {
    const t = await calendar().termOf('s1', '2027-02-07');
    expect(t).toMatchObject({ term: 2, termStartsOn: '2027-02-07', termEndsOn: '2027-06-30' });
  });

  it('answers for weekends and holidays too (homework is often dated on a Friday)', async () => {
    expect((await calendar().termOf('s1', '2026-10-02'))?.term).toBe(1); // a Friday
  });

  it('is null outside any academic year', async () => {
    expect(await calendar().termOf('s1', '2026-08-01')).toBeNull();
    expect(await calendar().termOf('s1', '2027-07-01')).toBeNull();
  });

  it('treats a year without a second term as one long term 1', async () => {
    const t = await calendar({ term2StartsOn: null }).termOf('s1', '2027-03-01');
    expect(t).toMatchObject({ term: 1, termStartsOn: '2026-09-13', termEndsOn: '2027-06-30' });
  });
});
