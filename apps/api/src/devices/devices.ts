import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { GatewayKind, Prisma, Role } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { mapPrismaError } from '../common/validation';
import { normaliseMac, rulesFor } from './rules';

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** Easy to read out and type: no 0/O or 1/I. */
function claimCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `GW-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export class RegisterGatewayDto {
  @Matches(/^[A-Za-z0-9-]{4,40}$/, { message: 'serial may use letters, digits and dashes (4–40)' }) serial: string;
}

export class ClaimGatewayDto {
  @IsString() claimCode: string;
  @IsString() @MinLength(1) name: string;
  @IsEnum(GatewayKind) kind: GatewayKind;
  @ValidateIf((o) => o.kind === GatewayKind.ROOM) @IsString() roomId?: string;
}

export class UpdateGatewayDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsEnum(GatewayKind) kind?: GatewayKind;
  @IsOptional() @IsString() roomId?: string;
}

export class StrapDto {
  @IsString() mac: string;
  @IsOptional() @IsString() studentId?: string;
}

export class AssignStrapDto {
  // null unassigns the strap
  @ValidateIf((o) => o.studentId !== null) @IsString() studentId: string | null;
}

export class RulesDto {
  @IsObject() rules: Record<string, unknown>;
}

const gatewaySelect = {
  id: true, serial: true, name: true, kind: true, firmware: true, lastSeenAt: true, createdAt: true,
  room: { select: { id: true, name: true } },
} satisfies Prisma.GatewaySelect;

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async registerGateway(user: AuthUser, serial: string) {
    const secret = randomBytes(24).toString('base64url');
    const code = claimCode();
    const gw = await this.prisma.gateway
      .create({ data: { serial, claimCode: code, secretHash: hashSecret(secret) } })
      .catch((e) => mapPrismaError(e, `Gateway ${serial} is already registered.`));
    await this.audit.log(user, 'gateway.register', 'gateway', gw.id, { serial }, null);
    // The secret is shown once, to be written into the device's firmware settings.
    return { id: gw.id, serial, claimCode: code, secret };
  }

  /** Gives a gateway a new secret (lost, leaked or mistyped); the old one stops working at once. */
  async newSecret(user: AuthUser, id: string) {
    const secret = randomBytes(24).toString('base64url');
    const gw = await this.prisma.gateway.update({ where: { id }, data: { secretHash: hashSecret(secret) } }).catch(() => {
      throw new NotFoundException('Gateway not found.');
    });
    await this.audit.log(user, 'gateway.secret', 'gateway', gw.id, { serial: gw.serial }, null);
    return { id: gw.id, serial: gw.serial, claimCode: gw.claimCode, secret };
  }

  private async checkRoom(schoolId: string, kind: GatewayKind | undefined, roomId: string | undefined) {
    if (kind === GatewayKind.ROOM && !roomId) throw new BadRequestException('A room gateway needs a room.');
    if (roomId && !(await this.prisma.room.findFirst({ where: { id: roomId, schoolId } }))) {
      throw new BadRequestException('Room not found in this school.');
    }
  }

  async claim(user: AuthUser, schoolId: string, dto: ClaimGatewayDto) {
    const gw = await this.prisma.gateway.findUnique({ where: { claimCode: dto.claimCode.trim().toUpperCase() } });
    if (!gw) throw new NotFoundException('No gateway has this claim code. Check the label on the device.');
    if (gw.schoolId && gw.schoolId !== schoolId) throw new BadRequestException('This gateway belongs to another school.');
    await this.checkRoom(schoolId, dto.kind, dto.roomId);
    const updated = await this.prisma.gateway.update({
      where: { id: gw.id },
      data: { schoolId, name: dto.name, kind: dto.kind, roomId: dto.kind === GatewayKind.ROOM ? dto.roomId : null },
      select: gatewaySelect,
    });
    await this.audit.log(user, 'gateway.claim', 'gateway', gw.id, { ...dto });
    return updated;
  }

  async updateGateway(user: AuthUser, schoolId: string, id: string, dto: UpdateGatewayDto) {
    const gw = await this.prisma.gateway.findFirst({ where: { id, schoolId } });
    if (!gw) throw new NotFoundException('Gateway not found.');
    const kind = dto.kind ?? gw.kind ?? undefined;
    const roomId = dto.roomId ?? gw.roomId ?? undefined;
    await this.checkRoom(schoolId, kind, roomId);
    const updated = await this.prisma.gateway.update({
      where: { id },
      data: { name: dto.name, kind, roomId: kind === GatewayKind.ROOM ? roomId : null },
      select: gatewaySelect,
    });
    await this.audit.log(user, 'gateway.update', 'gateway', id, { ...dto });
    return updated;
  }

  async release(user: AuthUser, schoolId: string, id: string) {
    const { count } = await this.prisma.gateway.updateMany({ where: { id, schoolId }, data: { schoolId: null, roomId: null, name: null, kind: null } });
    if (!count) throw new NotFoundException('Gateway not found.');
    await this.audit.log(user, 'gateway.release', 'gateway', id);
    return { ok: true };
  }

  gateways(schoolId: string) {
    return this.prisma.gateway.findMany({ where: { schoolId }, select: gatewaySelect, orderBy: { name: 'asc' } });
  }

  straps(schoolId: string) {
    return this.prisma.strap.findMany({
      where: { schoolId },
      include: { student: { select: { id: true, firstName: true, lastName: true, class: { select: { name: true } } } } },
      orderBy: { mac: 'asc' },
    });
  }

  private async checkStudent(schoolId: string, studentId?: string | null) {
    if (studentId && !(await this.prisma.student.findFirst({ where: { id: studentId, schoolId } }))) {
      throw new BadRequestException('Student not found in this school.');
    }
  }

  async addStrap(user: AuthUser, schoolId: string, dto: StrapDto) {
    const mac = normaliseMac(dto.mac);
    if (!mac) throw new BadRequestException('That isn’t a valid strap address (12 hex digits, like DC:0D:30:AA:4A:11).');
    await this.checkStudent(schoolId, dto.studentId);
    const strap = await this.prisma.strap
      .create({ data: { schoolId, mac, studentId: dto.studentId } })
      .catch((e) => mapPrismaError(e, 'This strap is already registered, or the student already has a strap.'));
    await this.audit.log(user, 'strap.add', 'strap', strap.id, { mac, studentId: dto.studentId ?? null });
    return strap;
  }

  async assignStrap(user: AuthUser, schoolId: string, id: string, studentId: string | null) {
    if (!(await this.prisma.strap.findFirst({ where: { id, schoolId } }))) throw new NotFoundException('Strap not found.');
    await this.checkStudent(schoolId, studentId);
    const strap = await this.prisma.strap
      .update({ where: { id }, data: { studentId } })
      .catch((e) => mapPrismaError(e, 'This student already has a strap. Unassign it first.'));
    await this.audit.log(user, studentId ? 'strap.assign' : 'strap.unassign', 'strap', id, { studentId });
    return strap;
  }

  async rules(schoolId: string) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    return rulesFor(school.detection);
  }

  async setRules(user: AuthUser, schoolId: string, rules: Record<string, unknown>) {
    const merged = rulesFor(rules);
    const bad =
      merged.room.presentShare <= 0 || merged.room.presentShare > 1 ||
      merged.room.lateAfterMinutes < 0 || merged.gate.minSeconds < 0 ||
      [merged.gate.minRssi, merged.room.minRssi].some((r) => typeof r !== 'number' || r > 0 || r < -120);
    if (bad) throw new BadRequestException('Those rules are out of range.');
    await this.prisma.school.update({ where: { id: schoolId }, data: { detection: merged as unknown as Prisma.InputJsonValue } });
    await this.audit.log(user, 'detection.rules', 'school', schoolId, merged as unknown as Prisma.InputJsonValue);
    return merged;
  }
}

@Roles(Role.OWNER)
@Controller('owner/gateways')
export class OwnerGatewaysController {
  constructor(private readonly devices: DevicesService, private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.gateway.findMany({
      select: { ...gatewaySelect, claimCode: true, school: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterGatewayDto) {
    return this.devices.registerGateway(user, dto.serial);
  }

  @Post(':id/secret')
  newSecret(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.devices.newSecret(user, id);
  }
}

@Roles(Role.SCHOOL_ADMIN)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Roles(...STAFF)
  @Get('gateways')
  gateways(@SchoolId() schoolId: string) {
    return this.devices.gateways(schoolId);
  }

  @Post('gateways/claim')
  claim(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: ClaimGatewayDto) {
    return this.devices.claim(user, schoolId, dto);
  }

  @Patch('gateways/:id')
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateGatewayDto) {
    return this.devices.updateGateway(user, schoolId, id, dto);
  }

  @Delete('gateways/:id')
  release(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.devices.release(user, schoolId, id);
  }

  @Roles(...STAFF)
  @Get('straps')
  straps(@SchoolId() schoolId: string) {
    return this.devices.straps(schoolId);
  }

  @Post('straps')
  addStrap(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: StrapDto) {
    return this.devices.addStrap(user, schoolId, dto);
  }

  @Patch('straps/:id')
  assign(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: AssignStrapDto) {
    return this.devices.assignStrap(user, schoolId, id, dto.studentId);
  }

  @Get('rules')
  rules(@SchoolId() schoolId: string) {
    return this.devices.rules(schoolId);
  }

  @Put('rules')
  setRules(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: RulesDto) {
    return this.devices.setRules(user, schoolId, dto.rules);
  }
}
