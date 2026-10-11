import { BadRequestException, Body, Controller, Delete, Get, Injectable, Param, Put } from '@nestjs/common';
import { Prisma, Role, SchoolSystem } from '@prisma/client';
import { IsArray } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { Band, bandsFor, checkBands } from './grades';
import { ScoreService } from './scores';

const SYSTEMS = Object.values(SchoolSystem);

export class SetBandsDto {
  @IsArray() bands: unknown[];
}

/** A school's grade bands: what each percentage is called, for every school system, with its own changes laid over the defaults. */
@Injectable()
export class BandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scores: ScoreService,
  ) {}

  async all(schoolId: string): Promise<Record<string, Band[]>> {
    const overrides = await this.scores.overrides(schoolId);
    return Object.fromEntries(SYSTEMS.map((s) => [s, bandsFor(s, overrides)]));
  }

  private system(value: string): SchoolSystem {
    if (!SYSTEMS.includes(value as SchoolSystem)) throw new BadRequestException('Choose a school system.');
    return value as SchoolSystem;
  }

  private async store(schoolId: string, overrides: Record<string, Band[]>) {
    await this.prisma.school.update({ where: { id: schoolId }, data: { gradeBands: overrides as unknown as Prisma.InputJsonValue } });
  }

  async set(user: AuthUser, schoolId: string, value: string, dto: SetBandsDto) {
    const system = this.system(value);
    const checked = checkBands(dto.bands);
    if (!checked.ok) throw new BadRequestException(checked.message);
    const overrides = await this.scores.overrides(schoolId);
    await this.store(schoolId, { ...overrides, [system]: checked.bands });
    await this.audit.log(user, 'bands.update', 'school', schoolId, { system, count: checked.bands.length });
    return this.all(schoolId);
  }

  async reset(user: AuthUser, schoolId: string, value: string) {
    const system = this.system(value);
    const { [system]: _gone, ...rest } = await this.scores.overrides(schoolId);
    await this.store(schoolId, rest);
    await this.audit.log(user, 'bands.reset', 'school', schoolId, { system });
    return this.all(schoolId);
  }
}

@RequiresModule('academics')
@Controller('academics/bands')
export class BandsController {
  constructor(private readonly bands: BandsService) {}

  @Roles(...STAFF)
  @Get()
  all(@SchoolId() schoolId: string) {
    return this.bands.all(schoolId);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Put(':system')
  set(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('system') system: string, @Body() dto: SetBandsDto) {
    return this.bands.set(user, schoolId, system, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':system')
  reset(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('system') system: string) {
    return this.bands.reset(user, schoolId, system);
  }
}
