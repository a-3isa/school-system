import { AttendanceStatus } from '@prisma/client';

/**
 * Detection rules for automatic attendance, set per school. Numbers are
 * starting points to tune against real straps and rooms.
 */
export interface DetectionRules {
  gate: { minRssi: number; minSeconds: number };
  room: {
    minRssi: number;
    // Share of the period a strap must be in the room to count as present (decision R5).
    presentShare: number;
    // First seen later than this many minutes after the start = late (decision R5).
    lateAfterMinutes: number;
  };
  // Leaving through the gate: no sighting anywhere for this long afterwards.
  leftAfterMinutes: number;
  // A gateway silent for this long counts as offline.
  gatewayOfflineMinutes: number;
  lowBattery: number;
}

export const DEFAULT_RULES: DetectionRules = {
  gate: { minRssi: -70, minSeconds: 3 },
  room: { minRssi: -85, presentShare: 0.7, lateAfterMinutes: 10 },
  leftAfterMinutes: 10,
  gatewayOfflineMinutes: 5,
  lowBattery: 20,
};

export function rulesFor(stored: unknown): DetectionRules {
  const s = (stored ?? {}) as Partial<DetectionRules>;
  return {
    ...DEFAULT_RULES,
    ...s,
    gate: { ...DEFAULT_RULES.gate, ...(s.gate ?? {}) },
    room: { ...DEFAULT_RULES.room, ...(s.room ?? {}) },
  };
}

export interface Sight {
  gatewayId: string;
  rssi: number;
  seenAt: Date;
}

export interface PeriodDecision {
  status: AttendanceStatus;
  firstSeenAt: Date | null;
  secondsInRoom: number;
  share: number;
}

const MINUTE = 60_000;

/**
 * Decides one student's attendance in one lesson from their strap's sightings.
 *
 * The lesson is split into one-minute slots. In each slot the strap belongs to
 * the gateway that heard it loudest anywhere in the school, so a strap heard
 * weakly through the wall from the next classroom isn't counted here.
 */
export function decidePeriod(sights: Sight[], roomGateways: Set<string>, start: Date, end: Date, rules: DetectionRules['room']): PeriodDecision {
  const slots = Math.max(1, Math.round((end.getTime() - start.getTime()) / MINUTE));
  const loudest = new Map<number, Sight>();
  for (const s of sights) {
    const t = s.seenAt.getTime();
    if (t < start.getTime() || t >= end.getTime() || s.rssi < rules.minRssi) continue;
    const slot = Math.floor((t - start.getTime()) / MINUTE);
    const best = loudest.get(slot);
    if (!best || s.rssi > best.rssi) loudest.set(slot, s);
  }
  const inRoom = [...loudest.entries()].filter(([, s]) => roomGateways.has(s.gatewayId)).sort((a, b) => a[0] - b[0]);
  if (!inRoom.length) return { status: AttendanceStatus.ABSENT, firstSeenAt: null, secondsInRoom: 0, share: 0 };

  const firstSlot = inRoom[0][0];
  const firstSeenAt = inRoom[0][1].seenAt;
  const share = inRoom.length / slots;
  const late = firstSlot >= rules.lateAfterMinutes;
  const status = late ? AttendanceStatus.LATE : share >= rules.presentShare ? AttendanceStatus.PRESENT : AttendanceStatus.ABSENT;
  return { status, firstSeenAt, secondsInRoom: inRoom.length * 60, share: Math.round(share * 100) / 100 };
}

/** Whether gate sightings confirm an arrival: loud enough for long enough. */
export function confirmsArrival(sights: Sight[], rules: DetectionRules['gate']): Date | null {
  const loud = sights.filter((s) => s.rssi >= rules.minRssi).sort((a, b) => a.seenAt.getTime() - b.seenAt.getTime());
  for (let i = 0; i < loud.length; i++) {
    for (let j = loud.length - 1; j > i; j--) {
      const span = (loud[j].seenAt.getTime() - loud[i].seenAt.getTime()) / 1000;
      if (span > 60) continue; // must be one continuous visit, not two
      if (span >= rules.minSeconds) return loud[i].seenAt;
    }
  }
  return null;
}

/** Normalises a MAC address to upper case with colons. */
export function normaliseMac(mac: string): string | null {
  const hex = mac.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(':');
}
