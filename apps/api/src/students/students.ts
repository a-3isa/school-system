import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { GuardianRelation, Prisma, Role } from '@prisma/client';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { hashPassword } from '../auth/auth';
import { mapPrismaError } from '../common/validation';

export class StudentDto {
  @IsString() @MinLength(1) code: string;
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() medicalNotes?: string;
}

export class UpdateStudentDto {
  @IsOptional() @IsString() @MinLength(1) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) lastName?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() medicalNotes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class GuardianDto {
  @IsEnum(GuardianRelation) relation: GuardianRelation;
  @IsString() @MinLength(1) name: string;
  @IsString() @MinLength(6) phone: string;
  @IsOptional() @IsEmail() email?: string;
  // Temporary password; parents will sign in with a WhatsApp code later.
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

export class GuardianAccessDto {
  @IsBoolean() restricted: boolean;
}

const MAX_GUARDIANS = 2;

const studentInclude = {
  class: { select: { id: true, name: true } },
  guardians: { include: { user: { select: { id: true, name: true, phone: true, email: true } } } },
} satisfies Prisma.StudentInclude;

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  async create(user: AuthUser, schoolId: string, dto: StudentDto) {
    await this.checkClass(schoolId, dto.classId);
    const student = await this.prisma.student
      .create({ data: { ...dto, dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined, schoolId }, include: studentInclude })
      .catch((e) => mapPrismaError(e, `Student code ${dto.code} is already used.`));
    await this.audit.log(user, 'student.create', 'student', student.id, { code: dto.code, classId: dto.classId });
    return student;
  }

  async update(user: AuthUser, schoolId: string, id: string, dto: UpdateStudentDto) {
    await this.get(schoolId, id);
    await this.checkClass(schoolId, dto.classId);
    const student = await this.prisma.student.update({
      where: { id },
      data: { ...dto, dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined },
      include: studentInclude,
    });
    await this.audit.log(user, 'student.update', 'student', id, { ...dto });
    return student;
  }

  /**
   * Links a parent to a student. A parent who already has an account (a
   * sibling at the same school) is reused by phone number.
   */
  async addGuardian(user: AuthUser, schoolId: string, studentId: string, dto: GuardianDto) {
    const student = await this.get(schoolId, studentId);
    if (student.guardians.length >= MAX_GUARDIANS) throw new BadRequestException('A student can have at most two parents.');
    if (student.guardians.some((g) => g.relation === dto.relation)) {
      throw new BadRequestException(`This student already has a ${dto.relation.toLowerCase()}.`);
    }

    let parent = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (parent && (parent.role !== Role.PARENT || parent.schoolId !== schoolId)) {
      throw new BadRequestException('This phone number belongs to another account.');
    }
    if (!parent) {
      parent = await this.prisma.user
        .create({
          data: {
            schoolId,
            role: Role.PARENT,
            name: dto.name,
            phone: dto.phone,
            email: dto.email?.toLowerCase(),
            passwordHash: dto.password ? await hashPassword(dto.password) : null,
          },
        })
        .catch((e) => mapPrismaError(e, 'This email belongs to another account.'));
    }
    await this.prisma.studentGuardian.create({ data: { studentId, userId: parent.id, relation: dto.relation } });
    await this.audit.log(user, 'guardian.add', 'student', studentId, { parentId: parent.id, relation: dto.relation });
    return this.get(schoolId, studentId);
  }

  async setGuardianAccess(user: AuthUser, schoolId: string, studentId: string, parentId: string, restricted: boolean) {
    await this.get(schoolId, studentId);
    const link = await this.prisma.studentGuardian.findUnique({ where: { studentId_userId: { studentId, userId: parentId } } });
    if (!link) throw new NotFoundException('This parent isn’t linked to the student.');
    await this.prisma.studentGuardian.update({ where: { studentId_userId: { studentId, userId: parentId } }, data: { restricted } });
    await this.audit.log(user, restricted ? 'guardian.restrict' : 'guardian.unrestrict', 'student', studentId, { parentId });
    return this.get(schoolId, studentId);
  }

  async removeGuardian(user: AuthUser, schoolId: string, studentId: string, parentId: string) {
    await this.get(schoolId, studentId);
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

  @Roles(...STAFF)
  @Get()
  list(@SchoolId() schoolId: string, @Query('classId') classId?: string, @Query('q') q?: string, @Query('active') active?: string) {
    return this.students.list(schoolId, { classId, q, active: active === undefined ? undefined : active === 'true' });
  }

  @Roles(...STAFF)
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
    return this.students.setGuardianAccess(user, schoolId, id, parentId, dto.restricted);
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

@Module({ controllers: [StudentsController, ParentController], providers: [StudentsService], exports: [StudentsService] })
export class StudentsModule {}
