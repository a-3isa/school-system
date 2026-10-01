import { Controller, Get, Injectable, NotFoundException, Param, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequiresModule, Roles, SchoolId, SCHOOL_WIDE, STAFF } from '../auth/auth.decorators';
import { dbDate } from '../common/dates';
import { localParts, zonedTime } from '../common/time';
import { rulesFor } from './rules';

const MINUTE = 60_000;
/** Heard within this long: here now. */
const HERE_MS = 2 * MINUTE;
/** Not heard for longer than this: someone should look. */
const MISSING_MS = 10 * MINUTE;
/** Two visits to the same place this close together are one visit. */
const VISIT_GAP_MS = 3 * MINUTE;

type Place = { gatewayId: string; name: string; kind: string | null; room: string | null };
export type LocationState = 'here' | 'recent' | 'missing' | 'left' | 'away' | 'notSeen' | 'noStrap';

/**
 * Where each student is, from the same strap sightings that decide
 * attendance. In each minute a strap belongs to the gateway that heard it
 * loudest, so a child is in one place, not in every room that can hear them.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async places(schoolId: string) {
    const gateways = await this.prisma.gateway.findMany({ where: { schoolId }, include: { room: { select: { name: true } } } });
    return new Map<string, Place>(gateways.map((g) => [g.id, { gatewayId: g.id, name: g.name ?? g.serial, kind: g.kind, room: g.room?.name ?? null }]));
  }

  /** Per strap: the latest minute it was heard in [from, to], and the loudest gateway in that minute. */
  async lastHeard(schoolId: string, minRssi: number, from: Date, to: Date, strapIds?: string[]) {
    const only = strapIds ? Prisma.sql`AND "strapId" IN (${strapIds.length ? Prisma.join(strapIds) : Prisma.sql`NULL`})` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ strapId: string; gatewayId: string; seenAt: Date }[]>(Prisma.sql`
      SELECT DISTINCT ON ("strapId") "strapId", "gatewayId", "seenAt"
      FROM "Sighting"
      WHERE "schoolId" = ${schoolId} AND "seenAt" >= ${from} AND "seenAt" <= ${to} AND "rssi" >= ${minRssi} ${only}
      ORDER BY "strapId", date_trunc('minute', "seenAt") DESC, "rssi" DESC`);
    return new Map(rows.map((r) => [r.strapId, r]));
  }

  /** Gateways of a school by id, as places. */
  placesOf(schoolId: string) {
    return this.places(schoolId);
  }

  async now(schoolId: string, at = new Date()) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const minRssi = rulesFor(school.detection).room.minRssi;
    const { date, time, dayOfWeek } = localParts(at, school.timezone);
    const dayStart = zonedTime(date, '00:00', school.timezone);
    // A child not heard for a while is only a worry while school is on.
    const periods = await this.prisma.period.findMany({ where: { schoolId }, orderBy: { startTime: 'asc' }, select: { startTime: true, endTime: true } });
    const lastEnd = periods.reduce((m, p) => (p.endTime > m ? p.endTime : m), '00:00');
    const schoolHours = school.schoolDays.includes(dayOfWeek) && periods.length > 0 && time >= periods[0].startTime && time <= lastEnd;
    const byStrap = await this.lastHeard(schoolId, minRssi, dayStart, at);
    const places = await this.places(schoolId);
    const [students, gate] = await Promise.all([
      this.prisma.student.findMany({
        where: { schoolId, active: true },
        select: { id: true, firstName: true, lastName: true, class: { select: { id: true, name: true } }, strap: { select: { id: true } } },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.gatePresence.findMany({ where: { date: dbDate(date), student: { schoolId } } }),
    ]);
    const arrivals = new Map(gate.map((g) => [g.studentId, g.arrivedAt]));

    return {
      at: at.toISOString(),
      schoolHours,
      places: [...places.values()],
      students: students.map((s) => {
        const seen = s.strap ? byStrap.get(s.strap.id) : undefined;
        const place = seen ? places.get(seen.gatewayId) ?? null : null;
        const age = seen ? at.getTime() - seen.seenAt.getTime() : null;
        let state: LocationState;
        if (!s.strap) state = 'noStrap';
        else if (age === null) state = 'notSeen';
        else if (age <= HERE_MS) state = 'here';
        else if (age <= MISSING_MS) state = 'recent';
        else if (place?.kind === 'GATE') state = 'left';
        else state = schoolHours ? 'missing' : 'away';
        return {
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          class: s.class,
          state,
          place,
          seenAt: seen?.seenAt ?? null,
          arrivedAt: arrivals.get(s.id) ?? null,
        };
      }),
    };
  }

  /** One student's day as a list of visits: where, from when, until when. */
  async day(schoolId: string, studentId: string, date: string) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const student = await this.prisma.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true } });
    if (!student) throw new NotFoundException('Student not found.');
    dbDate(date);
    const minRssi = rulesFor(school.detection).room.minRssi;
    const from = zonedTime(date, '00:00', school.timezone);
    const to = new Date(from.getTime() + 24 * 60 * MINUTE);
    const minutes = await this.prisma.$queryRaw<{ minute: Date; gatewayId: string; first: Date; last: Date }[]>(Prisma.sql`
      SELECT DISTINCT ON (m.minute) m.minute, m."gatewayId", m.first, m.last
      FROM (
        SELECT date_trunc('minute', s."seenAt") AS minute, s."gatewayId", max(s."rssi") AS rssi, min(s."seenAt") AS first, max(s."seenAt") AS last
        FROM "Sighting" s JOIN "Strap" st ON st.id = s."strapId"
        WHERE st."studentId" = ${studentId} AND s."schoolId" = ${schoolId} AND s."seenAt" >= ${from} AND s."seenAt" < ${to} AND s."rssi" >= ${minRssi}
        GROUP BY 1, 2
      ) m
      ORDER BY m.minute, m.rssi DESC`);
    const places = await this.places(schoolId);
    const visits: { place: Place | null; from: Date; to: Date }[] = [];
    for (const m of minutes) {
      const prev = visits[visits.length - 1];
      if (prev && prev.place?.gatewayId === m.gatewayId && m.first.getTime() - prev.to.getTime() <= VISIT_GAP_MS) {
        prev.to = m.last;
      } else {
        visits.push({ place: places.get(m.gatewayId) ?? null, from: m.first, to: m.last });
      }
    }
    return visits;
  }
}

/** The dashboard's "where are they now" and each student's movements. */
@RequiresModule('attendance')
@Roles(...SCHOOL_WIDE)
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  now(@SchoolId() schoolId: string) {
    return this.locations.now(schoolId);
  }

  @Get('students/:id')
  day(@SchoolId() schoolId: string, @Param('id') id: string, @Query('date') date: string) {
    return this.locations.day(schoolId, id, date);
  }
}
