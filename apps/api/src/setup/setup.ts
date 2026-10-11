import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { sniff } from '../students/files';
import { AttendanceMode, ClassGender, Role, RoomKind, SchoolSystem, SecondaryStream, Stage } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, SCHOOL_WIDE, STAFF } from '../auth/auth.decorators';
import { defined, mapPrismaError, TIME_RE, toMinutes } from '../common/validation';
import { SchoolCalendar } from './calendar';
import { dbDate } from '../common/dates';

// ---------- DTOs ----------

export class SchoolSettingsDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsEnum(AttendanceMode) attendanceMode?: AttendanceMode;
  @IsOptional() @Matches(TIME_RE, { message: 'absenceNoticeTime must look like 08:15' }) absenceNoticeTime?: string;
  /** Office hours shown to parents in chat; messages can be sent at any time. */
  @IsOptional() @Matches(TIME_RE, { message: 'chatFrom must look like 08:00' }) chatFrom?: string;
  @IsOptional() @Matches(TIME_RE, { message: 'chatTo must look like 15:00' }) chatTo?: string;
  /** Printed under the principal's comment on report cards; an empty value clears it. */
  @IsOptional() @IsString() @MaxLength(100) principalName?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  schoolDays?: number[];
}

export class GradeDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsEnum(Stage) stage?: Stage;
  @IsInt() order: number;
}

export class EgyptGradesDto {
  @IsArray() @ArrayMinSize(1) @IsEnum(Stage, { each: true }) stages: Stage[];
}

/** The details of a class beyond its name and grade, as Egyptian schools keep them. */
class ClassDetailsDto {
  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() homeroomTeacherId?: string;
  @IsOptional() @ValidateIf((d) => d.system !== null) @IsEnum(SchoolSystem) system?: SchoolSystem | null;
  @IsOptional() @IsEnum(ClassGender) gender?: ClassGender;
  @IsOptional() @ValidateIf((d) => d.stream !== null) @IsEnum(SecondaryStream) stream?: SecondaryStream | null;
  @IsOptional() @ValidateIf((d) => d.capacity !== null) @IsInt() @Min(1) @Max(100) capacity?: number | null;
}

export class ClassDto extends ClassDetailsDto {
  @IsString() @MinLength(1) name: string;
  @IsString() gradeId: string;
}

export class UpdateClassDto extends ClassDetailsDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() gradeId?: string;
}

export class YearDto {
  @IsString() @Matches(/^\d{4}\/\d{4}$/, { message: 'Name the year like 2026/2027.' }) name: string;
  @IsDateString() startsOn: string;
  @IsDateString() endsOn: string;
  @IsOptional() @IsDateString() term2StartsOn?: string;
  @IsOptional() @IsDateString() breakFrom?: string;
  @IsOptional() @IsDateString() breakTo?: string;
}

export class HolidayDto {
  @IsString() @MinLength(1) name: string;
  @IsDateString() fromDate: string;
  @IsDateString() toDate: string;
}

export class EgyptHolidaysDto {
  @IsString() yearId: string;
  @IsIn(['en', 'ar']) lang: 'en' | 'ar';
}

// The grades of Egyptian schooling, stage by stage.
const ORDINAL_AR = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'];
export const EGYPT_GRADES: { stage: Stage; name: string; nameAr: string; order: number }[] = [
  { stage: Stage.KG, name: 'KG 1', nameAr: 'الروضة الأولى', order: 1 },
  { stage: Stage.KG, name: 'KG 2', nameAr: 'الروضة الثانية', order: 2 },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ stage: Stage.PRIMARY, name: `Primary ${n}`, nameAr: `الصف ${ORDINAL_AR[n - 1]} الابتدائي`, order: 2 + n })),
  ...[1, 2, 3].map((n) => ({ stage: Stage.PREPARATORY, name: `Preparatory ${n}`, nameAr: `الصف ${ORDINAL_AR[n - 1]} الإعدادي`, order: 8 + n })),
  ...[1, 2, 3].map((n) => ({ stage: Stage.SECONDARY, name: `Secondary ${n}`, nameAr: `الصف ${ORDINAL_AR[n - 1]} الثانوي`, order: 11 + n })),
];

// Egypt's public holidays that fall on the same date every year. The Islamic
// ones (the Eids, the Hijri new year, the Prophet's birthday) move with the
// moon, so the school adds them when they are announced.
export const EGYPT_FIXED_HOLIDAYS: { month: number; day: number; en: string; ar: string }[] = [
  { month: 1, day: 7, en: 'Coptic Christmas', ar: 'عيد الميلاد المجيد' },
  { month: 1, day: 25, en: 'January 25 Revolution and Police Day', ar: 'ثورة 25 يناير وعيد الشرطة' },
  { month: 4, day: 25, en: 'Sinai Liberation Day', ar: 'عيد تحرير سيناء' },
  { month: 5, day: 1, en: 'Labour Day', ar: 'عيد العمال' },
  { month: 6, day: 30, en: 'June 30 Revolution', ar: 'ثورة 30 يونيو' },
  { month: 7, day: 23, en: 'July 23 Revolution', ar: 'ثورة 23 يوليو' },
  { month: 10, day: 6, en: 'Armed Forces Day', ar: 'عيد القوات المسلحة' },
];

export class RoomDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsEnum(RoomKind) kind?: RoomKind;
}

export class SubjectDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(80) nameAr?: string;
}

export class UpdateSubjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  /** An empty value clears the Arabic name. */
  @IsOptional() @IsString() @MaxLength(80) nameAr?: string;
}

export class PeriodDto {
  @IsInt() @Min(1) number: number;
  @Matches(TIME_RE, { message: 'startTime must look like 08:00' }) startTime: string;
  @Matches(TIME_RE, { message: 'endTime must look like 08:45' }) endTime: string;
}

// ---------- Service ----------

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  school(schoolId: string) {
    return this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
  }

  async updateSchool(user: AuthUser, schoolId: string, dto: SchoolSettingsDto) {
    if (dto.attendanceMode === AttendanceMode.AUTOMATIC) {
      const mod = await this.prisma.schoolModule.findUnique({ where: { schoolId_key: { schoolId, key: 'attendance' } } });
      const automatic = (mod?.features as Record<string, boolean> | undefined)?.automatic;
      if (!mod?.enabled || !automatic) {
        throw new BadRequestException('Automatic attendance isn’t included in this school’s plan.');
      }
    }
    if (dto.chatFrom !== undefined || dto.chatTo !== undefined) {
      const now = await this.school(schoolId);
      if (toMinutes(dto.chatFrom ?? now.chatFrom) >= toMinutes(dto.chatTo ?? now.chatTo)) {
        throw new BadRequestException('Office hours must end after they start.');
      }
    }
    const school = await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        ...dto,
        schoolDays: dto.schoolDays ? [...new Set(dto.schoolDays)].sort() : undefined,
        principalName: dto.principalName === undefined ? undefined : dto.principalName.trim() || null,
      },
    });
    await this.audit.log(user, 'school.update', 'school', schoolId, { ...dto });
    return school;
  }

  async checkPeriod(schoolId: string, dto: PeriodDto, ignoreId?: string) {
    const start = toMinutes(dto.startTime);
    const end = toMinutes(dto.endTime);
    if (end <= start) throw new BadRequestException('A period must end after it starts.');
    const others = await this.prisma.period.findMany({ where: { schoolId, NOT: ignoreId ? { id: ignoreId } : undefined } });
    const clash = others.find((p) => start < toMinutes(p.endTime) && toMinutes(p.startTime) < end);
    if (clash) throw new BadRequestException(`Overlaps period ${clash.number} (${clash.startTime}–${clash.endTime}).`);
  }

  /**
   * A school year runs forward, its second term and mid-year break fall
   * inside it, and it doesn't overlap another year.
   */
  async checkYear(schoolId: string, dto: YearDto, ignoreId?: string) {
    const d = (v?: string) => (v ? dbDate(v.slice(0, 10)) : null);
    const [start, end, term2, from, to] = [d(dto.startsOn)!, d(dto.endsOn)!, d(dto.term2StartsOn), d(dto.breakFrom), d(dto.breakTo)];
    if (end <= start) throw new BadRequestException('The year must end after it starts.');
    if (term2 && (term2 <= start || term2 > end)) throw new BadRequestException('The second term must start inside the year.');
    if (!from !== !to) throw new BadRequestException('Give the mid-year break both a first and a last day.');
    if (from && to && (to < from || from < start || to > end)) throw new BadRequestException('The mid-year break must be inside the year, and end after it starts.');
    const overlap = await this.prisma.academicYear.findFirst({ where: { schoolId, NOT: ignoreId ? { id: ignoreId } : undefined, startsOn: { lte: end }, endsOn: { gte: start } } });
    if (overlap) throw new BadRequestException(`It overlaps the year ${overlap.name}.`);
    return { name: dto.name, startsOn: start, endsOn: end, term2StartsOn: term2, breakFrom: from, breakTo: to };
  }

  /** A class's grade and homeroom teacher belong to the school; only secondary classes have a stream. */
  async checkClass(schoolId: string, dto: { gradeId: string; homeroomTeacherId?: string | null; stream?: SecondaryStream | null }) {
    await this.assertOwned('grade', schoolId, dto.gradeId, 'Grade');
    await this.assertOwned('user', schoolId, dto.homeroomTeacherId || undefined, 'Teacher');
    if (dto.stream) {
      const grade = await this.prisma.grade.findUniqueOrThrow({ where: { id: dto.gradeId } });
      if (grade.stage !== Stage.SECONDARY) throw new BadRequestException('Only secondary classes have a stream (science, mathematics or literary).');
    }
  }

  async assertOwned(model: 'grade' | 'user', schoolId: string, id: string | undefined, label: string) {
    if (!id) return;
    const row = model === 'grade'
      ? await this.prisma.grade.findFirst({ where: { id, schoolId } })
      : await this.prisma.user.findFirst({ where: { id, schoolId, role: Role.TEACHER } });
    if (!row) throw new BadRequestException(`${label} not found in this school.`);
  }
}

// ---------- Controllers ----------

@Controller('school')
export class SchoolController {
  constructor(private readonly setup: SetupService, private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly calendar: SchoolCalendar) {}

  @Get()
  get(@SchoolId() schoolId: string) {
    return this.setup.school(schoolId);
  }

  /** The school's crest, for staff and parents of the school. */
  @Get('logo')
  async logo(@SchoolId() schoolId: string, @Res() res: Response) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { logo: true, logoMime: true } });
    if (!school.logo || !school.logoMime) throw new NotFoundException('This school has no crest yet.');
    res.setHeader('content-type', school.logoMime);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'private, max-age=600');
    res.send(Buffer.from(school.logo));
  }

  /** Sets the crest: a PNG, JPEG or WebP image up to 1 MB (no SVG: it could carry script). */
  @Roles(Role.SCHOOL_ADMIN)
  @Put('logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }))
  async setLogo(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Attach the crest as “file”.');
    const mime = sniff(file.buffer);
    if (!mime || mime === 'application/pdf') throw new BadRequestException('Please use a PNG, JPG or WebP image for the crest.');
    await this.prisma.school.update({ where: { id: schoolId }, data: { logo: new Uint8Array(file.buffer), logoMime: mime } });
    await this.audit.log(user, 'school.logo', 'school', schoolId, { size: file.size });
    return { ok: true };
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete('logo')
  async removeLogo(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string) {
    await this.prisma.school.update({ where: { id: schoolId }, data: { logo: null, logoMime: null } });
    await this.audit.log(user, 'school.logo', 'school', schoolId, { removed: true });
    return { ok: true };
  }

  /** Whether there's school on a day, and which term it is in. */
  @Roles(...STAFF)
  @Get('day')
  async day(@SchoolId() schoolId: string, @Query('date') date: string) {
    dbDate(date);
    return { date, ...(await this.calendar.day(await this.setup.school(schoolId), date)) };
  }

  // ---- the school year ----

  @Roles(...STAFF)
  @Get('years')
  years(@SchoolId() schoolId: string) {
    return this.prisma.academicYear.findMany({ where: { schoolId }, orderBy: { startsOn: 'desc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post('years')
  async addYear(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: YearDto) {
    const data = await this.setup.checkYear(schoolId, dto);
    const year = await this.prisma.academicYear.create({ data: { ...data, schoolId } }).catch((e) => mapPrismaError(e, `The year ${dto.name} already exists.`));
    await this.audit.log(user, 'year.create', 'school', schoolId, { ...dto });
    return year;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch('years/:id')
  async updateYear(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: YearDto) {
    if (!(await this.prisma.academicYear.findFirst({ where: { id, schoolId } }))) throw new NotFoundException('School year not found.');
    const data = await this.setup.checkYear(schoolId, dto, id);
    const year = await this.prisma.academicYear.update({ where: { id }, data }).catch((e) => mapPrismaError(e, `The year ${dto.name} already exists.`));
    await this.audit.log(user, 'year.update', 'school', schoolId, { id, ...dto });
    return year;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete('years/:id')
  async removeYear(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.academicYear.deleteMany({ where: { id, schoolId } });
    if (!count) throw new NotFoundException('School year not found.');
    await this.audit.log(user, 'year.delete', 'school', schoolId, { id });
    return { ok: true };
  }

  // ---- holidays ----

  @Roles(...STAFF)
  @Get('holidays')
  holidays(@SchoolId() schoolId: string) {
    return this.prisma.holiday.findMany({ where: { schoolId }, orderBy: { fromDate: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post('holidays')
  async addHoliday(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: HolidayDto) {
    if (dto.toDate < dto.fromDate) throw new BadRequestException('A holiday must end on or after the day it starts.');
    const holiday = await this.prisma.holiday.create({ data: { schoolId, name: dto.name.trim(), fromDate: dbDate(dto.fromDate.slice(0, 10)), toDate: dbDate(dto.toDate.slice(0, 10)) } });
    await this.audit.log(user, 'holiday.create', 'school', schoolId, { ...dto });
    return holiday;
  }

  /** Adds Egypt's fixed-date public holidays that fall inside a school year (and on a school day). */
  @Roles(Role.SCHOOL_ADMIN)
  @Post('holidays/egypt')
  async addEgyptHolidays(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: EgyptHolidaysDto) {
    const year = await this.prisma.academicYear.findFirst({ where: { id: dto.yearId, schoolId } });
    if (!year) throw new NotFoundException('School year not found.');
    const school = await this.setup.school(schoolId);
    const existing = await this.prisma.holiday.findMany({ where: { schoolId } });
    const added = [];
    for (let y = year.startsOn.getUTCFullYear(); y <= year.endsOn.getUTCFullYear(); y++) {
      for (const h of EGYPT_FIXED_HOLIDAYS) {
        const day = new Date(Date.UTC(y, h.month - 1, h.day));
        if (day < year.startsOn || day > year.endsOn || !school.schoolDays.includes(day.getUTCDay())) continue;
        if (year.breakFrom && year.breakTo && year.breakFrom <= day && day <= year.breakTo) continue; // already off
        if (existing.some((e) => e.fromDate <= day && day <= e.toDate)) continue;
        added.push(await this.prisma.holiday.create({ data: { schoolId, name: h[dto.lang], fromDate: day, toDate: day } }));
      }
    }
    await this.audit.log(user, 'holiday.egypt', 'school', schoolId, { yearId: year.id, added: added.length });
    return added;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete('holidays/:id')
  async removeHoliday(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.holiday.deleteMany({ where: { id, schoolId } });
    if (!count) throw new NotFoundException('Holiday not found.');
    await this.audit.log(user, 'holiday.delete', 'school', schoolId, { id });
    return { ok: true };
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch()
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: SchoolSettingsDto) {
    return this.setup.updateSchool(user, schoolId, dto);
  }
}

@Roles(...STAFF)
@Controller('grades')
export class GradesController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: GradeDto) {
    const grade = await this.prisma.grade.create({ data: { ...dto, schoolId } }).catch((e) => mapPrismaError(e, 'A grade with this name already exists.'));
    await this.audit.log(user, 'grade.create', 'grade', grade.id, { ...dto });
    return grade;
  }

  /** Adds the Egyptian grades of the chosen stages, skipping any the school already has. */
  @Roles(Role.SCHOOL_ADMIN)
  @Post('egypt')
  async egypt(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: EgyptGradesDto) {
    const have = new Set((await this.prisma.grade.findMany({ where: { schoolId }, select: { name: true } })).map((g) => g.name));
    const add = EGYPT_GRADES.filter((g) => dto.stages.includes(g.stage) && !have.has(g.name));
    for (const g of add) await this.prisma.grade.create({ data: { ...g, schoolId } });
    await this.audit.log(user, 'grade.egypt', 'school', schoolId, { stages: dto.stages, added: add.length });
    return this.prisma.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.grade.deleteMany({ where: { id, schoolId } }).catch((e) => mapPrismaError(e));
    if (!count) throw new NotFoundException('Grade not found.');
    await this.audit.log(user, 'grade.delete', 'grade', id);
    return { ok: true };
  }
}

@Roles(...STAFF)
@Controller('classes')
export class ClassesController {
  constructor(private readonly prisma: PrismaService, private readonly setup: SetupService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.class.findMany({
      where: { schoolId },
      include: { grade: true, homeroomTeacher: { select: { id: true, name: true, honorific: true } }, _count: { select: { students: true } } },
      orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
    });
  }

  /** A class with its students, for the class page. */
  @Roles(...SCHOOL_WIDE)
  @Get(':id')
  async get(@SchoolId() schoolId: string, @Param('id') id: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id, schoolId },
      include: {
        grade: true,
        homeroomTeacher: { select: { id: true, name: true, honorific: true } },
        students: {
          where: { active: true },
          select: { id: true, code: true, firstName: true, lastName: true, nameAr: true, guardians: { select: { relation: true, user: { select: { id: true, name: true } } }, orderBy: { relation: 'asc' } } },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        },
      },
    });
    if (!cls) throw new NotFoundException('Class not found.');
    return cls;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: ClassDto) {
    await this.setup.checkClass(schoolId, dto);
    const cls = await this.prisma.class.create({ data: { ...dto, homeroomTeacherId: dto.homeroomTeacherId || null, section: dto.section?.trim() || null, schoolId } }).catch((e) => mapPrismaError(e, 'A class with this name already exists.'));
    await this.audit.log(user, 'class.create', 'class', cls.id, { ...dto });
    return cls;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateClassDto) {
    const before = await this.prisma.class.findFirst({ where: { id, schoolId } });
    if (!before) throw new NotFoundException('Class not found.');
    const sent = defined(dto);
    await this.setup.checkClass(schoolId, { ...before, ...sent } as ClassDto);
    const data = { ...sent, ...(dto.homeroomTeacherId !== undefined ? { homeroomTeacherId: dto.homeroomTeacherId || null } : {}), ...(dto.section !== undefined ? { section: dto.section.trim() || null } : {}) };
    const cls = await this.prisma.class.update({ where: { id }, data }).catch((e) => mapPrismaError(e, 'A class with this name already exists.'));
    await this.audit.log(user, 'class.update', 'class', id, { ...dto });
    return cls;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.class.deleteMany({ where: { id, schoolId } }).catch((e) => mapPrismaError(e));
    if (!count) throw new NotFoundException('Class not found.');
    await this.audit.log(user, 'class.delete', 'class', id);
    return { ok: true };
  }
}

@Roles(...STAFF)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.room.findMany({ where: { schoolId }, orderBy: { name: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: RoomDto) {
    const room = await this.prisma.room.create({ data: { ...dto, schoolId } }).catch((e) => mapPrismaError(e, 'A room with this name already exists.'));
    await this.audit.log(user, 'room.create', 'room', room.id, { ...dto });
    return room;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.room.deleteMany({ where: { id, schoolId } }).catch((e) => mapPrismaError(e));
    if (!count) throw new NotFoundException('Room not found.');
    await this.audit.log(user, 'room.delete', 'room', id);
    return { ok: true };
  }
}

@Roles(...STAFF)
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: SubjectDto) {
    const subject = await this.prisma.subject
      .create({ data: { name: dto.name.trim(), nameAr: dto.nameAr?.trim() || null, schoolId } })
      .catch((e) => mapPrismaError(e, 'A subject with this name already exists.'));
    await this.audit.log(user, 'subject.create', 'subject', subject.id, { ...dto });
    return subject;
  }

  /** Fixing a name or adding the Arabic one. Lessons and marks keep pointing at the same subject. */
  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateSubjectDto) {
    if (!(await this.prisma.subject.findFirst({ where: { id, schoolId }, select: { id: true } }))) throw new NotFoundException('Subject not found.');
    const subject = await this.prisma.subject
      .update({ where: { id }, data: { ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr.trim() || null } : {}) } })
      .catch((e) => mapPrismaError(e, 'A subject with this name already exists.'));
    await this.audit.log(user, 'subject.edit', 'subject', id, { ...dto });
    return subject;
  }

  /** A subject can go only while nothing uses it: no lessons in the timetable and no marks. */
  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const subject = await this.prisma.subject.findFirst({ where: { id, schoolId }, select: { id: true, name: true } });
    if (!subject) throw new NotFoundException('Subject not found.');
    const [lessons, assessments] = await Promise.all([this.prisma.timetableEntry.count({ where: { subjectId: id } }), this.prisma.assessment.count({ where: { subjectId: id } })]);
    if (lessons || assessments) throw new BadRequestException('This subject is in the timetable or has marks, so it can’t be deleted.');
    await this.prisma.subject.delete({ where: { id } });
    await this.audit.log(user, 'subject.delete', 'subject', id, { name: subject.name });
    return { ok: true };
  }
}

@Roles(...STAFF)
@Controller('periods')
export class PeriodsController {
  constructor(private readonly prisma: PrismaService, private readonly setup: SetupService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string) {
    return this.prisma.period.findMany({ where: { schoolId }, orderBy: { number: 'asc' } });
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: PeriodDto) {
    await this.setup.checkPeriod(schoolId, dto);
    const period = await this.prisma.period.create({ data: { ...dto, schoolId } }).catch((e) => mapPrismaError(e, `Period ${dto.number} already exists.`));
    await this.audit.log(user, 'period.create', 'period', period.id, { ...dto });
    return period;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: PeriodDto) {
    if (!(await this.prisma.period.findFirst({ where: { id, schoolId } }))) throw new NotFoundException('Period not found.');
    await this.setup.checkPeriod(schoolId, dto, id);
    const period = await this.prisma.period.update({ where: { id }, data: dto }).catch((e) => mapPrismaError(e, `Period ${dto.number} already exists.`));
    await this.audit.log(user, 'period.update', 'period', id, { ...dto });
    return period;
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    const { count } = await this.prisma.period.deleteMany({ where: { id, schoolId } });
    if (!count) throw new NotFoundException('Period not found.');
    await this.audit.log(user, 'period.delete', 'period', id);
    return { ok: true };
  }
}

@Module({
  controllers: [SchoolController, GradesController, ClassesController, RoomsController, SubjectsController, PeriodsController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
