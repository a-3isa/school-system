import { confirmsArrival, decidePeriod, DEFAULT_RULES, normaliseMac, rulesFor } from './rules';

const start = new Date('2026-09-30T05:00:00Z'); // 08:00 Cairo
const end = new Date('2026-09-30T05:45:00Z');
const at = (min: number, sec = 0) => new Date(start.getTime() + min * 60_000 + sec * 1000);
const every = (gatewayId: string, rssi: number, from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => ({ gatewayId, rssi, seenAt: at(from + i, 10) }));

describe('decidePeriod', () => {
  const room = new Set(['G-204']);
  const rules = DEFAULT_RULES.room;

  it('marks present when in the room for the whole lesson', () => {
    const d = decidePeriod(every('G-204', -60, 0, 45), room, start, end, rules);
    expect(d).toEqual(expect.objectContaining({ status: 'PRESENT', share: 1, secondsInRoom: 2700 }));
  });

  it('marks late when first seen after 10 minutes', () => {
    expect(decidePeriod(every('G-204', -60, 12, 45), room, start, end, rules).status).toBe('LATE');
  });

  it('marks absent when never heard in the room', () => {
    expect(decidePeriod([], room, start, end, rules)).toEqual(expect.objectContaining({ status: 'ABSENT', firstSeenAt: null }));
  });

  it('marks absent when in the room for less than 70% of the lesson', () => {
    expect(decidePeriod(every('G-204', -60, 0, 20), room, start, end, rules).status).toBe('ABSENT');
  });

  it('gives the strap to the loudest gateway, not a neighbour heard through the wall', () => {
    // Heard by our room at -82 and by the next room at -58 all lesson long.
    const sights = [...every('G-204', -82, 0, 45), ...every('G-205', -58, 0, 45)];
    expect(decidePeriod(sights, room, start, end, rules).status).toBe('ABSENT');
    expect(decidePeriod(sights, new Set(['G-205']), start, end, rules).status).toBe('PRESENT');
  });

  it('ignores sightings outside the lesson or too quiet', () => {
    const sights = [...every('G-204', -95, 0, 45), { gatewayId: 'G-204', rssi: -50, seenAt: at(50) }];
    expect(decidePeriod(sights, room, start, end, rules).status).toBe('ABSENT');
  });
});

describe('confirmsArrival', () => {
  const g = (sec: number, rssi = -60) => ({ gatewayId: 'GATE', rssi, seenAt: at(0, sec) });

  it('needs the strap loud for at least 3 seconds', () => {
    expect(confirmsArrival([g(0)], DEFAULT_RULES.gate)).toBeNull();
    expect(confirmsArrival([g(0), g(4)], DEFAULT_RULES.gate)).toEqual(at(0, 0));
  });

  it('ignores quiet sightings from passers-by', () => {
    expect(confirmsArrival([g(0, -90), g(5, -90)], DEFAULT_RULES.gate)).toBeNull();
  });
});

describe('helpers', () => {
  it('normalises MAC addresses', () => {
    expect(normaliseMac('dc0d30aa4a11')).toBe('DC:0D:30:AA:4A:11');
    expect(normaliseMac('DC-0D-30-AA-4A-11')).toBe('DC:0D:30:AA:4A:11');
    expect(normaliseMac('nope')).toBeNull();
  });

  it('merges stored rules over the defaults', () => {
    expect(rulesFor({ room: { presentShare: 0.8 } }).room).toEqual({ ...DEFAULT_RULES.room, presentShare: 0.8 });
  });
});
