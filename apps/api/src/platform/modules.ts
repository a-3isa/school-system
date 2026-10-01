import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { AttendanceMode, Plan, Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsObject, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId } from '../auth/auth.decorators';
import { hashPassword } from '../auth/auth';
import { isModuleKey, MODULE_KEYS, ModuleKey, MODULES, PLAN_MODULES, SUBSCRIPTION_FEATURES, toggleModule } from './registry';

class AdminDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}

export class CreateSchoolDto {
  @IsString() name: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsEnum(Plan) plan: Plan;
  @ValidateNested() @Type(() => AdminDto) admin: AdminDto;
}

export class ToggleModuleDto {
  @IsBoolean() enabled: boolean;
}

export class FeaturesDto {
  @IsObject() features: Record<string, boolean>;
}

export class SetPlanDto {
  @IsEnum(Plan) plan: Plan;
}

@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** All modules with their state for one school, in catalog order. */
  async list(schoolId: string) {
    const rows = await this.prisma.schoolModule.findMany({ where: { schoolId } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return MODULE_KEYS.map((key) => {
      const def = MODULES[key];
      const row = byKey.get(key);
      return {
        key,
        name: def.name,
        requires: def.requires,
        enabled: key === 'core' || !!row?.enabled,
        features: { ...def.features, ...((row?.features as Record<string, boolean>) ?? {}) },
      };
    });
  }

  async enabledKeys(schoolId: string): Promise<ModuleKey[]> {
    const rows = await this.prisma.schoolModule.findMany({ where: { schoolId, enabled: true } });
    return rows.map((r) => r.key).filter(isModuleKey);
  }

  /** Writes a full set of enabled modules for a school. */
  async apply(schoolId: string, enabled: ModuleKey[], tx: Prisma.TransactionClient = this.prisma) {
    const on = new Set<ModuleKey>([...enabled, 'core']);
    for (const key of MODULE_KEYS) {
      await tx.schoolModule.upsert({
        where: { schoolId_key: { schoolId, key } },
        create: { schoolId, key, enabled: on.has(key), features: MODULES[key].features },
        update: { enabled: on.has(key) },
      });
    }
  }

  async toggle(actor: AuthUser, schoolId: string, key: string, enabled: boolean) {
    if (!isModuleKey(key)) throw new NotFoundException(`There is no module called “${key}”.`);
    await this.requireSchool(schoolId);
    const result = toggleModule(await this.enabledKeys(schoolId), key, enabled);
    if (!result.ok) throw new BadRequestException(result.reason);
    await this.apply(schoolId, result.enabled);
    await this.audit.log(actor, enabled ? 'module.enable' : 'module.disable', 'module', key, { alsoEnabled: result.alsoEnabled }, schoolId);
    return { modules: await this.list(schoolId), alsoEnabled: result.alsoEnabled };
  }

  async setFeatures(actor: AuthUser, schoolId: string, key: string, features: Record<string, boolean>) {
    if (!isModuleKey(key)) throw new NotFoundException(`There is no module called “${key}”.`);
    const known = Object.keys(MODULES[key].features);
    const unknown = Object.keys(features).filter((f) => !known.includes(f));
    if (unknown.length) throw new BadRequestException(`Unknown feature: ${unknown.join(', ')}.`);
    if (actor.role !== Role.OWNER && Object.keys(features).some((f) => SUBSCRIPTION_FEATURES[key]?.includes(f))) {
      throw new ForbiddenException('Automatic attendance comes with the subscription. Ask the platform owner.');
    }
    const row = await this.prisma.schoolModule.findUnique({ where: { schoolId_key: { schoolId, key } } });
    if (!row?.enabled && key !== 'core') throw new BadRequestException(`${MODULES[key].name} isn’t switched on.`);
    const merged = { ...MODULES[key].features, ...((row?.features as object) ?? {}), ...features };
    await this.prisma.schoolModule.update({ where: { schoolId_key: { schoolId, key } }, data: { features: merged } });
    // The subscription decides how attendance starts: from the straps, or by hand.
    if (key === 'attendance' && features.automatic !== undefined) {
      await this.prisma.school.update({ where: { id: schoolId }, data: { attendanceMode: features.automatic ? AttendanceMode.AUTOMATIC : AttendanceMode.MANUAL } });
    }
    await this.audit.log(actor, 'module.features', 'module', key, features, schoolId);
    return this.list(schoolId);
  }

  async setPlan(actor: AuthUser, schoolId: string, plan: Plan) {
    await this.requireSchool(schoolId);
    await this.prisma.$transaction(async (tx) => {
      await tx.school.update({ where: { id: schoolId }, data: { plan } });
      await this.apply(schoolId, PLAN_MODULES[plan], tx);
    });
    await this.audit.log(actor, 'school.plan', 'school', schoolId, { plan }, schoolId);
    return this.list(schoolId);
  }

  private async requireSchool(id: string) {
    const school = await this.prisma.school.findUnique({ where: { id } });
    if (!school) throw new NotFoundException('School not found.');
    return school;
  }
}

/** What a school's own staff see: the modules and features switched on for them. */
@Controller('modules')
export class SchoolModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.modules.list(schoolId);
  }

  // School admins may change features inside modules they have; switching whole
  // modules on or off belongs to the platform owner (it follows the subscription).
  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':key/features')
  features(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('key') key: string, @Body() dto: FeaturesDto) {
    return this.modules.setFeatures(user, schoolId, key, dto.features);
  }
}

/** The platform owner console: schools, plans and module switches. */
@Roles(Role.OWNER)
@Controller('owner/schools')
export class OwnerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const schools = await this.prisma.school.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { students: true } }, modules: { where: { enabled: true }, select: { key: true } } },
    });
    return schools.map(({ modules, _count, ...s }) => ({ ...s, students: _count.students, modules: modules.map((m) => m.key) }));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSchoolDto) {
    const email = dto.admin.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException('A user with this email already exists.');
    }
    const passwordHash = await hashPassword(dto.admin.password);
    const school = await this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({ data: { name: dto.name, nameAr: dto.nameAr, plan: dto.plan } });
      await this.modules.apply(school.id, PLAN_MODULES[dto.plan], tx);
      await tx.user.create({
        data: { schoolId: school.id, name: dto.admin.name, email, passwordHash, role: Role.SCHOOL_ADMIN },
      });
      return school;
    });
    await this.audit.log(user, 'school.create', 'school', school.id, { plan: dto.plan }, school.id);
    return { ...school, modules: await this.modules.list(school.id) };
  }

  @Get(':id/modules')
  modulesOf(@Param('id') id: string) {
    return this.modules.list(id);
  }

  @Put(':id/modules/:key')
  toggle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('key') key: string, @Body() dto: ToggleModuleDto) {
    return this.modules.toggle(user, id, key, dto.enabled);
  }

  @Put(':id/plan')
  plan(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetPlanDto) {
    return this.modules.setPlan(user, id, dto.plan);
  }

  /** Features of a school's module, including the subscription ones (automatic attendance). */
  @Patch(':id/modules/:key/features')
  features(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('key') key: string, @Body() dto: FeaturesDto) {
    return this.modules.setFeatures(user, id, key, dto.features);
  }
}

@Module({
  controllers: [SchoolModulesController, OwnerController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class PlatformModule {}
