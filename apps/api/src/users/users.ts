import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId } from '../auth/auth.decorators';
import { hashPassword } from '../auth/auth';
import { mapPrismaError } from '../common/validation';

/** Titles staff are addressed by. */
export const HONORIFICS = ['MR', 'MS', 'MRS', 'DR'] as const;

// Staff roles a school admin can create. Parents are created from a student's record.
const STAFF_ROLES = [Role.SCHOOL_ADMIN, Role.TEACHER, Role.TRANSPORT, Role.NURSE, Role.CANTEEN, Role.ACCOUNTANT, Role.SOCIAL_WORKER] as const;

export class CreateStaffDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsIn(HONORIFICS) honorific?: (typeof HONORIFICS)[number];
  @IsIn(STAFF_ROLES) role: (typeof STAFF_ROLES)[number];
  @IsEmail() email: string;
  @IsOptional() @IsString() phone?: string;
  @IsString() @MinLength(8) password: string;
}

export class UpdateStaffDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  /** null clears it. */
  @IsOptional() @IsIn([...HONORIFICS, null]) honorific?: (typeof HONORIFICS)[number] | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

const publicUser = { id: true, name: true, honorific: true, email: true, phone: true, role: true, active: true, createdAt: true } as const;

@Roles(Role.SCHOOL_ADMIN)
@Controller('staff')
export class StaffController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@SchoolId() schoolId: string, @Query('role') role?: Role) {
    if (role && !(STAFF_ROLES as readonly Role[]).includes(role)) throw new BadRequestException('Unknown staff role.');
    return this.prisma.user.findMany({
      where: { schoolId, role: role ?? { in: [...STAFF_ROLES] } },
      select: publicUser,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * A member of staff's profile. For a teacher it adds what they teach, from the timetable: each class
   * and subject with its lessons a week, and the classes they lead. Student Affairs sees anyone's; a
   * teacher sees their own.
   */
  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Get(':id')
  async one(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    if (user.role !== Role.SCHOOL_ADMIN && user.id !== id) throw new ForbiddenException('You can see only your own profile.');
    const person = await this.prisma.user.findFirst({ where: { id, schoolId, role: { in: [...STAFF_ROLES] } }, select: publicUser });
    if (!person) throw new NotFoundException('Staff member not found.');
    if (person.role !== Role.TEACHER) return { ...person, teaching: null };

    const grade = { select: { name: true, nameAr: true } };
    const [homerooms, taught, placed] = await Promise.all([
      this.prisma.class.findMany({ where: { schoolId, homeroomTeacherId: id }, select: { id: true, name: true, grade }, orderBy: { name: 'asc' } }),
      // What the school assigned to them: each subject in each class.
      this.prisma.classSubject.findMany({
        where: { teacherId: id, class: { schoolId } },
        select: { classId: true, subjectId: true, class: { select: { name: true, grade } }, subject: { select: { name: true, nameAr: true } } },
      }),
      // How many lessons of them are in the timetable so far.
      this.prisma.timetableEntry.groupBy({ by: ['classId', 'subjectId'], where: { schoolId, teacherId: id }, _count: true }),
    ]);
    const lessonCount = new Map(placed.map((p) => [`${p.classId}:${p.subjectId}`, p._count]));
    const byPair = new Map<string, { classId: string; className: string; gradeName: string; gradeNameAr: string | null; subjectId: string; subjectName: string; subjectNameAr: string | null; lessons: number }>();
    for (const l of taught) {
      const key = `${l.classId}:${l.subjectId}`;
      const row = byPair.get(key) ?? { classId: l.classId, className: l.class.name, gradeName: l.class.grade.name, gradeNameAr: l.class.grade.nameAr, subjectId: l.subjectId, subjectName: l.subject.name, subjectNameAr: l.subject.nameAr, lessons: 0 };
      row.lessons = lessonCount.get(key) ?? 0;
      byPair.set(key, row);
    }
    const assignments = [...byPair.values()].sort((a, b) => a.className.localeCompare(b.className, 'en', { numeric: true }) || a.subjectName.localeCompare(b.subjectName));
    return { ...person, teaching: { lessonsPerWeek: [...lessonCount.values()].reduce((a, b) => a + b, 0), homerooms, assignments } };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: CreateStaffDto) {
    const created = await this.prisma.user
      .create({
        data: { schoolId, name: dto.name, honorific: dto.honorific, role: dto.role, email: dto.email.toLowerCase(), phone: dto.phone, passwordHash: await hashPassword(dto.password) },
        select: publicUser,
      })
      .catch((e) => mapPrismaError(e, 'Someone already uses this email or phone number.'));
    await this.audit.log(user, 'staff.create', 'user', created.id, { role: dto.role });
    return created;
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Body() dto: UpdateStaffDto) {
    const target = await this.prisma.user.findFirst({ where: { id, schoolId, role: { in: [...STAFF_ROLES] } } });
    if (!target) throw new NotFoundException('Staff member not found.');
    if (target.id === user.id && dto.active === false) throw new BadRequestException('You can’t deactivate your own account.');
    const updated = await this.prisma.user.update({
      where: { id },
      data: { name: dto.name, honorific: dto.honorific, active: dto.active, passwordHash: dto.password ? await hashPassword(dto.password) : undefined },
      select: publicUser,
    });
    await this.audit.log(user, 'staff.update', 'user', id, { name: dto.name, honorific: dto.honorific, active: dto.active, passwordChanged: !!dto.password });
    return updated;
  }
}

@Module({ controllers: [StaffController] })
export class UsersModule {}
