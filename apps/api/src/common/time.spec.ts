import { localParts } from './time';

describe('localParts', () => {
  it('converts UTC to Cairo local time', () => {
    // 30 Sep 2026 is a Wednesday; Cairo is UTC+3 in summer time.
    expect(localParts(new Date('2026-09-30T05:10:00Z'), 'Africa/Cairo')).toEqual({ dayOfWeek: 3, date: '2026-09-30', time: '08:10' });
  });

  it('rolls over the date near midnight', () => {
    expect(localParts(new Date('2026-09-30T22:30:00Z'), 'Africa/Cairo').date).toBe('2026-10-01');
  });
});

import { zonedTime } from './time';

describe('zonedTime', () => {
  it('turns Cairo local time into the right instant', () => {
    expect(zonedTime('2026-09-30', '08:00', 'Africa/Cairo').toISOString()).toBe('2026-09-30T05:00:00.000Z');
    expect(zonedTime('2026-12-15', '08:00', 'Africa/Cairo').toISOString()).toBe('2026-12-15T06:00:00.000Z');
  });
});
