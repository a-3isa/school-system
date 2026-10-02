import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Gender, GuardianRelation, Prisma, Religion, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsDefined, IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, SCHOOL_WIDE, STAFF } from '../auth/auth.decorators';
import { hashPassword } from '../auth/auth';
import { mapPrismaError } from '../common/validation';
import { parseNationalId } from './national-id';
import { localParts } from '../common/time';
import { fileSelect, StudentFilesService } from './files';

export class GuardianDto {
  @IsEnum(GuardianRelation) relation: GuardianRelation;
  @IsString() @MinLength(1) name: string;
  // The parent signs up in the app with this email, and gets the school's emails at it.
  @IsEmail({}, { message: 'Enter the parent’s email: they sign up in the app with it.' }) email: string;
  // Optional: the parent proves their mobile with a WhatsApp code when signing up, which replaces this.
  @IsOptional() @Matches(/^\+\d{8,15}$/, { message: 'Enter the mobile number with its country code, like +201001234567.' }) phone?: string;
  // Only for demos and tests; parents choose their own password in the app.
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const PHONE = /^\+\d{8,15}$/;
const PHONE_MESSAGE = 'Enter the mobile number with its country code, like +201001234567.';

/** What can be recorded about a student, all of it optional. */
class StudentDetailsDto {
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() nationalId?: string;
  @IsOptional() @IsString() passportNo?: string;
  @IsOptional() @IsEnum(Religion) religion?: Religion | null;
  @IsOptional() @IsString() placeOfBirth?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() previousSchool?: string;
  @IsOptional() @IsDateString() enrolledOn?: string;
  @IsOptional() @IsIn([...BLOOD_TYPES, '']) bloodType?: string;
  @IsOptional() @IsString() allergies?: string;
  @IsOptional() @IsString() medicalNotes?: string;
  @IsOptional() @IsString() emergencyName?: string;
  @IsOptional() @IsString() emergencyRelation?: string;
  @IsOptional() @ValidateIf((d) => !!d.emergencyPhone) @Matches(PHONE, { message: PHONE_MESSAGE }) emergencyPhone?: string;
}

export class StudentDto extends StudentDetailsDto {
  @IsString() @MinLength(1) code: string;
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsEnum(Gender, { message: 'Choose boy or girl.' }) gender: Gender;
  @IsDateString({}, { message: 'Enter the date of birth.' }) dateOfBirth: string;
  @Matches(/^[A-Z]{2}$/, { message: 'Choose the nationality.' }) nationality: string;
  // Every student has at least one parent or guardian from the start.
  @IsDefined({ message: 'Add the student’s mother, father or guardian.' }) @ValidateNested() @Type(() => GuardianDto) parent: GuardianDto;
  // The other parents, if the school has them too.
  @IsOptional() @IsArray() @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => GuardianDto) moreParents?: GuardianDto[];
  // Photos and scans uploaded first (POST /students/files); the photo and birth certificate are required.
  @IsArray({ message: 'Add the student’s photo and birth certificate.' }) @ArrayMaxSize(20) @IsString({ each: true }) files: string[];
}

export class UpdateStudentDto extends StudentDetailsDto {
  @IsOptional() @IsString() @MinLength(1) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) lastName?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) nationality?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Turns the form's values into database values: blank text is cleared, dates become dates. */
function toData(dto: StudentDetailsDto & { dateOfBirth?: string; nationality?: string }) {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dto)) if (v !== undefined) data[k] = typeof v === 'string' ? v.trim() || null : v;
  if (dto.dateOfBirth) data.dateOfBirth = new Date(dto.dateOfBirth);
  if (dto.enrolledOn) data.enrolledOn = new Date(dto.enrolledOn);
  return data;
}

const YEAR = 365.25 * 86400_000;

export class GuardianAccessDto {
  @IsBoolean() restricted: boolean;
}

const RELATION_NAME: Record<GuardianRelation, string> = { MOTHER: 'mother', FATHER: 'father', GUARDIAN: 'guardian' };

const studentInclude = {
  class: { select: { id: true, name: true } },
  guardians: { include: { user: { select: { id: true, name: true, phone: true, email: true, phoneVerifiedAt: true, emailVerifiedAt: true } } }, orderBy: { relation: 'asc' } },
  files: { select: fileSelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.StudentInclude;

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: StudentFilesService,
  ) {}

  private async checkClass(schoolId: string, classId?: string) {
    if (classId && !(await this.prisma.class.findFirst({ where: { id: classId, schoolId } }))) {
      throw new BadRequestException('Class not found in this school.');
    }
  }

  async get(schoolId: string, id: string) {
    const student = await this.prisma.student.findFirst({ where: { id, schoolId }, include: studentInclude });
    if (!student) throw new NotFoundException('Student not found.');
    return student;
  }

  list(schoolId: string, filter: { classId?: string; q?: string; active?: boolean }) {
    const q = filter.q?.trim();
    return this.prisma.student.findMany({
      where: {
        schoolId,
        classId: filter.classId,
        active: filter.active,
        ...(q
          ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { code: q }, { nameAr: { contains: q } }] }
          : {}),
      },
      include: studentInclude,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  /**
   * Checks who the student is, against what is already saved:
   * - an Egyptian student has a national number, and it agrees with the date of birth and gender;
   * - no two students of the school share a national number;
   * - the date of birth is a school-age child's (2 to 25 years old).
   */
  private async checkIdentity(schoolId: string, next: { id?: string; nationality?: string | null; nationalId?: string | null; dateOfBirth?: Date | null; gender?: Gender | null }) {
    if (next.dateOfBirth) {
      const age = (Date.now() - next.dateOfBirth.getTime()) / YEAR;
      if (age < 2 || age > 25) throw new BadRequestException('Check the date of birth: the student would be ' + Math.floor(age) + ' years old.');
    }
    if (next.nationality === 'EG' && !next.nationalId) {
      throw new BadRequestException('Enter the student’s national number (14 digits, on the birth certificate).');
    }
    if (!next.nationalId) return;
    const id = parseNationalId(next.nationalId);
    if (!id) throw new BadRequestException('The national number should be 14 digits, as on the birth certificate.');
    if (next.dateOfBirth && id.dateOfBirth !== next.dateOfBirth.toISOString().slice(0, 10)) {
      throw new BadRequestException(`The national number says the student was born on ${id.dateOfBirth}. Check the date of birth or the number.`);
    }
    if (next.gender && id.gender !== next.gender) {
      throw new BadRequestException(`The national number is a ${id.gender === 'MALE' ? 'boy' : 'girl'}’s. Check the gender or the number.`);
    }
    const other = await this.prisma.student.findFirst({ where: { schoolId, nationalId: next.nationalId, NOT: next.id ? { id: next.id } : undefined }, select: { code: true } });
    if (other) throw new ConflictException(`Student ${other.code} already has this national number.`);
  }

  async create(user: AuthUser, schoolId: string, dto: StudentDto) {
    await this.checkClass(schoolId, dto.classId);
    const { parent, moreParents = [], files, ...rest } = dto;
    const data = toData(rest);
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
    data.enrolledOn ??= new Date(localParts(new Date(), school.timezone).date);
    await this.checkIdentity(schoolId, data as any);
    await this.files.pending(schoolId, files);
    const { id, parentIds } = await this.prisma.$transaction(async (tx) => {
      const student = await tx.student
        .create({ data: { ...(data as any), schoolId } })
        .catch((e) => mapPrismaError(e, e?.meta?.target?.includes?.('nationalId') ? 'Another student already has this national number.' : `Student code ${dto.code} is already used.`));
      const attached = await tx.studentFile.updateMany({ where: { id: { in: files }, schoolId, studentId: null }, data: { studentId: student.id } });
      if (attached.count !== new Set(files).size) throw new BadRequestException('Some photos weren’t uploaded. Add them again.');
      const has: GuardianRelation[] = [];
      const parentIds: string[] = [];
      for (const p of [parent, ...moreParents]) {
        parentIds.push(await this.link(tx, schoolId, student.id, has, p));
        has.push(p.relation);
      }
      return { id: student.id, parentIds };
    });
    await this.audit.log(user, 'student.create', 'student', id, { code: dto.code, classId: dto.classId, parentIds });
    return this.get(schoolId, id);
  }

  async update(user: AuthUser, schoolId: string, id: string, dto: UpdateStudentDto) {
    const before = await this.get(schoolId, id);
    await this.checkClass(schoolId, dto.classId || undefined);
    const data = toData(dto);
    await this.checkIdentity(schoolId, { ...before, ...(data as any), id });
    const student = await this.prisma.student
      .update({ where: { id }, data: data as any, include: studentInclude })
      .catch((e) => mapPrismaError(e, 'Another student already has this national number.'));
    await this.audit.log(user, 'student.update', 'student', id, { ...dto });
    return student;
  }

  /**
   * Links a parent to a student. A parent who already has an account (a
   * sibling at the same school) is found by email.
   */
  async addGuardian(user: AuthUser, schoolId: string, studentId: string, dto: GuardianDto) {
    const student = await this.get(schoolId, studentId);
    const parentId = await this.prisma.$transaction((tx) => this.link(tx, schoolId, studentId, student.guardians.map((g) => g.relation), dto));
    await this.audit.log(user, 'guardian.add', 'student', studentId, { parentId, relation: dto.relation });
    return this.get(schoolId, studentId);
  }

  /** A student has at most one mother, one father and one guardian. */
  private async link(tx: Prisma.TransactionClient, schoolId: string, studentId: string, has: GuardianRelation[], dto: GuardianDto) {
    if (has.includes(dto.relation)) throw new BadRequestException(`This student already has a ${RELATION_NAME[dto.relation]}.`);
    const email = dto.email.trim().toLowerCase();
    let parent = await tx.user.findUnique({ where: { email } });
    if (parent && (parent.role !== Role.PARENT || parent.schoolId !== schoolId)) {
      throw new BadRequestException('This email belongs to another account.');
    }
    if (parent?.id && (await tx.studentGuardian.findUnique({ where: { studentId_userId: { studentId, userId: parent.id } } }))) {
      throw new BadRequestException('This parent is already linked to the student.');
    }
    if (!parent) {
      parent = await tx.user
        .create({
          data: {
            schoolId,
            role: Role.PARENT,
            name: dto.name,
            email,
            phone: dto.phone,
            passwordHash: dto.password ? await hashPassword(dto.password) : null,
          },
        })
        .catch((e) => mapPrismaError(e, 'This mobile number belongs to another account.'));
    }
    await tx.studentGuardian.create({ data: { studentId, userId: parent.id, relation: dto.relation } });
    return parent.id;
  }

  async setGuardianAccess(user: AuthUser, schoolId: string, studentId: string, parentId: string, dto: GuardianAccessDto) {
    await this.get(schoolId, studentId);
    const link = await this.prisma.studentGuardian.findUnique({ where: { studentId_userId: { studentId, userId: parentId } } });
    if (!link) throw new NotFoundException('This parent isn’t linked to the student.');
    await this.prisma.studentGuardian.update({ where: { studentId_userId: { studentId, userId: parentId } }, data: { restricted: dto.restricted } });
    await this.audit.log(user, dto.restricted ? 'guardian.restrict' : 'guardian.unrestrict', 'student', studentId, { parentId });
    return this.get(schoolId, studentId);
  }

  async removeGuardian(user: AuthUser, schoolId: string, studentId: string, parentId: string) {
    const student = await this.get(schoolId, studentId);
    if (student.guardians.some((g) => g.userId === parentId) && student.guardians.length <= 1) {
      throw new BadRequestException('A student needs at least one parent or guardian. Add another before removing this one.');
    }
    const { count } = await this.prisma.studentGuardian.deleteMany({ where: { studentId, userId: parentId } });
    if (!count) throw new NotFoundException('This parent isn’t linked to the student.');
    await this.audit.log(user, 'guardian.remove', 'student', studentId, { parentId });
    return this.get(schoolId, studentId);
  }

  /** A parent's own children, leaving out any child the school restricted for them. */
  children(parentId: string) {
    return this.prisma.student.findMany({
      where: { active: true, guardians: { some: { userId: parentId, restricted: false } } },
      select: { id: true, firstName: true, lastName: true, nameAr: true, photoUrl: true, class: { select: { id: true, name: true } } },
    });
  }
}

@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Roles(...SCHOOL_WIDE)
  @Get()
  list(@SchoolId() schoolId: string, @Query('classId') classId?: string, @Query('q') q?: string, @Query('active') active?: string) {
    return this.students.list(schoolId, { classId, q, active: active === undefined ? undefined : active === 'true' });
  }

  @Roles(...SCHOOL_WIDE)
  @Get(':id')
  get(@SchoolId() schoolId: string, @Param('id') id: string) {
    return this.students.get(schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: StudentDto) {
    return this.students.create(user, schoolId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(user, schoolId, id, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Post(':id/guardians')
  addGuardian(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: GuardianDto) {
    return this.students.addGuardian(user, schoolId, id, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Patch(':id/guardians/:parentId')
  access(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('parentId') parentId: string, @Body() dto: GuardianAccessDto) {
    return this.students.setGuardianAccess(user, schoolId, id, parentId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete(':id/guardians/:parentId')
  removeGuardian(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Param('parentId') parentId: string) {
    return this.students.removeGuardian(user, schoolId, id, parentId);
  }
}

@Controller('parent')
export class ParentController {
  constructor(
    private readonly students: StudentsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The parent agrees to tracking; the app asks once, before showing anything. */
  @Roles(Role.PARENT)
  @Post('consent')
  async consent(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.update({ where: { id: user.id }, data: { consentAt: new Date() }, select: { consentAt: true } });
    await this.audit.log(user, 'parent.consent', 'user', user.id);
    return u;
  }

  @Roles(Role.PARENT)
  @Get('children')
  children(@CurrentUser() user: AuthUser) {
    if (!user.schoolId) throw new ForbiddenException();
    return this.students.children(user.id);
  }
}

