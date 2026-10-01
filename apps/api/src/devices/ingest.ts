import { BadRequestException, Body, Controller, HttpCode, Injectable, Logger, OnModuleDestroy, OnModuleInit, Post, Req, UnauthorizedException } from '@nestjs/common';
import { AttendanceMode, Gateway, GatewayKind } from '@prisma/client';
import { plainToInstance, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, Min, validate, ValidateNested } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import { connect, MqttClient } from 'mqtt';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications';
import { Public } from '../auth/auth.decorators';
import { localParts } from '../common/time';
import { dbDate } from '../common/dates';
import { hashSecret } from './devices';
import { confirmsArrival, normaliseMac, rulesFor } from './rules';

class SightingDto {
  @IsString() mac: string;
  @IsInt() @Min(-127) @Max(20) rssi: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) battery?: number;
  // When the gateway heard it (ms since epoch). Buffered reports can be hours old.
  @IsOptional() @IsInt() at?: number;
}

export class SightingsDto {
  @IsOptional() @IsString() firmware?: string;
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => SightingDto) sightings: SightingDto[];
}

export class MqttAuthDto {
  @IsString() username: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsString() action?: string;
}

const DAY = 86_400_000;

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Checks a gateway's serial and secret. */
  async authenticate(serial: string, secret: string): Promise<Gateway | null> {
    const gw = await this.prisma.gateway.findUnique({ where: { serial } });
    if (!gw) return null;
    const a = Buffer.from(gw.secretHash, 'hex');
    const b = Buffer.from(hashSecret(secret), 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? gw : null;
  }

  /** Stores what a gateway heard and handles gate arrivals straight away. */
  async ingest(gw: Gateway, dto: SightingsDto, now = new Date()) {
    await this.prisma.gateway.update({ where: { id: gw.id }, data: { lastSeenAt: now, firmware: dto.firmware ?? undefined } });
    if (!gw.schoolId) return { stored: 0, unknown: dto.sightings.length, note: 'Gateway not claimed by a school yet.' };
    const schoolId = gw.schoolId;

    const macs = [...new Set(dto.sightings.map((s) => normaliseMac(s.mac)).filter((m): m is string => !!m))];
    const straps = await this.prisma.strap.findMany({ where: { schoolId, mac: { in: macs } } });
    const byMac = new Map(straps.map((s) => [s.mac, s]));

    const rows: { schoolId: string; gatewayId: string; strapId: string; rssi: number; seenAt: Date }[] = [];
    const latest = new Map<string, { seenAt: Date; battery?: number }>();
    let unknown = 0;
    for (const s of dto.sightings) {
      const strap = byMac.get(normaliseMac(s.mac) ?? '');
      if (!strap) {
        unknown++;
        continue;
      }
      let seenAt = s.at ? new Date(s.at) : now;
      if (seenAt.getTime() > now.getTime() + 60_000 || seenAt.getTime() < now.getTime() - DAY) seenAt = now; // bad clock
      rows.push({ schoolId, gatewayId: gw.id, strapId: strap.id, rssi: s.rssi, seenAt });
      const prev = latest.get(strap.id);
      if (!prev || seenAt > prev.seenAt) latest.set(strap.id, { seenAt, battery: s.battery ?? prev?.battery });
    }
    if (rows.length) await this.prisma.sighting.createMany({ data: rows });
    for (const [strapId, l] of latest) {
      await this.prisma.strap.update({ where: { id: strapId }, data: { lastSeenAt: l.seenAt, battery: l.battery ?? undefined } });
    }
    if (gw.kind === GatewayKind.GATE && rows.length) await this.handleGate(gw, rows);
    return { stored: rows.length, unknown };
  }

  /**
   * At a gate: the first confirmed sighting of the day is the arrival (the
   * parent is told), later loud sightings may mean the child is going out.
   */
  private async handleGate(gw: Gateway, rows: { strapId: string; seenAt: Date }[]) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: gw.schoolId! } });
    if (school.attendanceMode !== AttendanceMode.AUTOMATIC) return;
    const rules = rulesFor(school.detection);
    const straps = await this.prisma.strap.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.strapId))] }, studentId: { not: null } },
      include: { student: { include: { guardians: { where: { restricted: false } } } } },
    });
    for (const strap of straps) {
      const student = strap.student!;
      // Look around the times in this batch (it may have been buffered for hours).
      const times = rows.filter((r) => r.strapId === strap.id).map((r) => r.seenAt.getTime());
      const recent = await this.prisma.sighting.findMany({
        where: { strapId: strap.id, gatewayId: gw.id, seenAt: { gte: new Date(Math.min(...times) - 60_000), lte: new Date(Math.max(...times) + 60_000) } },
        orderBy: { seenAt: 'asc' },
      });
      const loud = recent.filter((s) => s.rssi >= rules.gate.minRssi);
      if (!loud.length) continue;
      const { date } = localParts(loud[0].seenAt, school.timezone);
      const day = dbDate(date);
      const presence = await this.prisma.gatePresence.findUnique({ where: { studentId_date: { studentId: student.id, date: day } } });

      if (!presence?.arrivedAt) {
        const arrivedAt = confirmsArrival(recent, rules.gate);
        if (!arrivedAt) continue;
        await this.prisma.gatePresence.upsert({
          where: { studentId_date: { studentId: student.id, date: day } },
          create: { studentId: student.id, date: day, arrivedAt },
          update: { arrivedAt },
        });
        const at = localParts(arrivedAt, school.timezone).time;
        await this.notifications.notify(
          student.guardians.map((g) => ({
            schoolId: school.id,
            userId: g.userId,
            type: 'attendance.arrived',
            title: `${student.firstName} arrived at school`,
            body: `${student.firstName} came in through ${gw.name ?? 'the gate'} at ${at}.`,
            data: { studentId: student.id, date, time: at },
          })),
        );
        continue;
      }
      // Already in school: a loud gate sighting well after arriving may be leaving.
      const last = loud[loud.length - 1].seenAt;
      if (last.getTime() - presence.arrivedAt.getTime() > 5 * 60_000 && !presence.leftAt) {
        await this.prisma.gatePresence.update({ where: { studentId_date: { studentId: student.id, date: day } }, data: { lastGateAt: last } });
      }
    }
  }
}

/** HTTP endpoints for gateways, and for the MQTT broker to check gateways. */
@Public()
@Controller('gateway')
export class GatewayController {
  constructor(
    private readonly ingest: IngestService,
    private readonly prisma: PrismaService,
  ) {}

  private async gateway(req: { headers: Record<string, string | undefined> }) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Basic ')) throw new UnauthorizedException('Gateway credentials missing.');
    const [serial, ...rest] = Buffer.from(header.slice(6), 'base64').toString().split(':');
    const gw = await this.ingest.authenticate(serial, rest.join(':'));
    if (!gw) throw new UnauthorizedException('Unknown gateway or wrong secret.');
    return gw;
  }

  @Post('sightings')
  @HttpCode(200)
  async sightings(@Req() req: any, @Body() dto: SightingsDto) {
    return this.ingest.ingest(await this.gateway(req), dto);
  }

  /** MQTT broker hook (EMQX HTTP auth): lets a gateway connect with its serial and secret. */
  @Post('mqtt/auth')
  @HttpCode(200)
  async mqttAuth(@Body() dto: MqttAuthDto) {
    if (process.env.MQTT_USERNAME && dto.username === process.env.MQTT_USERNAME) {
      return { result: dto.password === process.env.MQTT_PASSWORD ? 'allow' : 'deny' };
    }
    const gw = await this.ingest.authenticate(dto.username, dto.password ?? '');
    return { result: gw ? 'allow' : 'deny' };
  }

  /** MQTT broker hook (EMQX HTTP authorisation): a gateway may only publish to its own topics. */
  @Post('mqtt/acl')
  @HttpCode(200)
  async mqttAcl(@Body() dto: MqttAuthDto) {
    if (process.env.MQTT_USERNAME && dto.username === process.env.MQTT_USERNAME) return { result: 'allow' };
    const ownTopic = dto.topic?.startsWith(`gw/${dto.username}/`);
    const exists = await this.prisma.gateway.findUnique({ where: { serial: dto.username } });
    return { result: exists && ownTopic && dto.action === 'publish' ? 'allow' : 'deny' };
  }
}

/**
 * Gateways publish JSON to gw/<serial>/sightings (same body as the HTTP
 * endpoint). The broker has already checked who they are, so here the
 * serial in the topic identifies the gateway. Only runs when MQTT_URL is set.
 */
@Injectable()
export class MqttBridge implements OnModuleInit, OnModuleDestroy {
  private client?: MqttClient;
  private readonly logger = new Logger('MQTT');

  constructor(
    private readonly ingest: IngestService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const url = process.env.MQTT_URL;
    if (!url) return;
    this.client = connect(url, { username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD, clientId: `api-${process.pid}` });
    this.client.on('connect', () => {
      this.logger.log(`Connected to ${url}`);
      this.client!.subscribe('$share/api/gw/+/sightings', { qos: 1 });
    });
    this.client.on('error', (e) => this.logger.error(e.message));
    this.client.on('message', (topic, payload) => void this.handle(topic, payload));
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  async handle(topic: string, payload: Buffer) {
    const serial = topic.split('/')[1];
    try {
      const gw = await this.prisma.gateway.findUnique({ where: { serial } });
      if (!gw) return;
      const body = plainToInstance(SightingsDto, JSON.parse(payload.toString()));
      const errors = await validate(body);
      if (errors.length) throw new BadRequestException(errors.map((e) => e.property).join(', '));
      await this.ingest.ingest(gw, body);
    } catch (e) {
      this.logger.warn(`Bad message from ${serial}: ${(e as Error).message}`);
    }
  }
}
