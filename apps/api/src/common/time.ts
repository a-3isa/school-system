const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday (0 = Sunday), date (YYYY-MM-DD) and time (HH:mm) of `at` in a time zone. */
export function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    dayOfWeek: WEEKDAYS.indexOf(get('weekday')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** The instant that is `hhmm` on `date` (YYYY-MM-DD) in a time zone. */
export function zonedTime(date: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of the zone at that moment, found by formatting the guess there.
  const offsetAt = (t: number) => {
    const p = localParts(new Date(t), timeZone);
    const [py, pmo, pd] = p.date.split('-').map(Number);
    const [ph, pmi] = p.time.split(':').map(Number);
    return Date.UTC(py, pmo - 1, pd, ph, pmi) - Math.floor(t / 60000) * 60000;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass handles a daylight-saving change in between
  return new Date(t);
}
