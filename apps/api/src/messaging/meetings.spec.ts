import { slotsFor } from './meetings';

const TZ = 'Africa/Cairo';
const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

describe('slotsFor', () => {
  it('cuts a window into back-to-back slots', () => {
    const slots = slotsFor('2026-10-04', '14:00', '15:00', 20, TZ);
    expect(slots.map((s) => `${hhmm(s.startsAt)}–${hhmm(s.endsAt)}`)).toEqual(['14:00–14:20', '14:20–14:40', '14:40–15:00']);
  });

  it('drops a part-slot left over at the end', () => {
    const slots = slotsFor('2026-10-04', '14:00', '14:50', 20, TZ);
    expect(slots.map((s) => hhmm(s.startsAt))).toEqual(['14:00', '14:20']);
  });

  it('gives nothing when the window is shorter than one meeting', () => {
    expect(slotsFor('2026-10-04', '14:00', '14:10', 20, TZ)).toEqual([]);
  });

  it('uses the school’s clock, summer time included', () => {
    // Cairo is UTC+3 in October 2026 and UTC+2 in December.
    expect(slotsFor('2026-10-04', '14:00', '14:20', 20, TZ)[0].startsAt.toISOString()).toBe('2026-10-04T11:00:00.000Z');
    expect(slotsFor('2026-12-15', '14:00', '14:20', 20, TZ)[0].startsAt.toISOString()).toBe('2026-12-15T12:00:00.000Z');
  });
});
