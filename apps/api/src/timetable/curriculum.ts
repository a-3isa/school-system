import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Put } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId, STAFF } from '../auth/auth.decorators';

type Db = PrismaService | Prisma.TransactionClient;

/** Gives a class every subject of its year group (nobody teaches them yet). Safe to run again. */
export async function syncClassSubjects(db: Db, classId: string) {
  const cls = await db.class.findUnique({ where: { id: classId }, select: { gradeId: true } });
  if (!cls) return;
  const subjects = await db.gradeSubject.findMany({ where: { gradeId: cls.gradeId }, select: { subjectId: true } });
  if (subjects.length) await db.classSubject.createMany({ data: subjects.map((s) => ({ classId, subjectId: s.subjectId })), skipDuplicates: true });
}

export class GradeSubjectDto {
  /** Lessons a week; leave it out (or null) when the school doesn't count them. */
  @IsOptional() @ValidateIf((d) => d.lessonsPerWeek !== null) @IsInt() @Min(1) @Max(20) lessonsPerWeek?: number | null;
}

/**
 * What each year group studies, and each class's subjects with their teachers. Periods are the
 * school's, the same for every class; a year group has its subjects; a class has them too, each with
 * one teacher chosen by the school. What a class decides for itself is where its subjects sit in the week.
 */
@Injectable()
export class CurriculumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every year group's subjects, as { gradeId, subjectId, lessonsPerWeek }. */
  overview(schoolId: string) {
    return this.prisma.gradeSubject.findMany({ where: { grade: { schoolId } }, select: { gradeId: true, subjectId: true, lessonsPerWeek: true } });
  }

  /** Who the school gave each subject to, class by class: { classId, subjectId, teacherId } for every subject with a teacher. */
  assignments(schoolId: string) {
    return this.prisma.classSubject.findMany({ where: { class: { schoolId }, teacherId: { not: null } }, select: { classId: true, subjectId: true, teacherId: true } });
  }

  private async owned(schoolId: string, gradeId: string, subjectId: string) {
    const [grade, subject] = await Promise.all([
      this.prisma.grade.findFirst({ where: { id: gradeId, schoolId }, select: { id: true, name: true } }),
      this.prisma.subject.findFirst({ where: { id: subjectId, schoolId }, select: { id: true, name: true } }),
    ]);
    if (!grade) throw new NotFoundException('Grade not found.');
    if (!subject) throw new NotFoundException('Subject not found.');
    return { grade, subject };
  }

  /** The year group studies this subject: every class of it gets the subject, with nobody teaching it yet. */
  async setGradeSubject(user: AuthUser, schoolId: string, gradeId: string, subjectId: string, dto: GradeSubjectDto) {
    await this.owned(schoolId, gradeId, subjectId);
    const lessonsPerWeek = dto.lessonsPerWeek ?? null;
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.gradeSubject.upsert({
        where: { gradeId_subjectId: { gradeId, subjectId } },
        create: { gradeId, subjectId, lessonsPerWeek },
        update: dto.lessonsPerWeek === undefined ? {} : { lessonsPerWeek },
        select: { gradeId: true, subjectId: true, lessonsPerWeek: true },
      });
      const classes = await tx.class.findMany({ where: { schoolId, gradeId }, select: { id: true } });
      if (classes.length) await tx.classSubject.createMany({ data: classes.map((c) => ({ classId: c.id, subjectId })), skipDuplicates: true });
      return saved;
    });
    await this.audit.log(user, 'curriculum.set', 'grade', gradeId, { subjectId, lessonsPerWeek });
    return row;
  }

  /** The year group stops studying it, as long as none of its classes has lessons or marks in it. */
  async removeGradeSubject(user: AuthUser, schoolId: string, gradeId: string, subjectId: string) {
    await this.owned(schoolId, gradeId, subjectId);
    const inClasses = { class: { gradeId }, subjectId };
    const [lessons, marks] = await Promise.all([
      this.prisma.timetableEntry.count({ where: { schoolId, subjectId, class: { gradeId } } }),
      this.prisma.assessment.count({ where: { schoolId, subjectId, class: { gradeId } } }),
    ]);
    if (lessons || marks) throw new BadRequestException('This year group’s classes already have lessons or marks in this subject, so it can’t be removed.');
    await this.prisma.$transaction([
      this.prisma.classSubject.deleteMany({ where: inClasses }),
      this.prisma.gradeSubject.delete({ where: { gradeId_subjectId: { gradeId, subjectId } } }),
    ]);
    await this.audit.log(user, 'curriculum.remove', 'grade', gradeId, { subjectId });
    return { ok: true };
  }

  /** A class's subjects: the lessons placed so far, the year group's lessons a week, and who teaches each. */
  async classSubjects(schoolId: string, classId: string) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId }, select: { id: true, gradeId: true } });
    if (!cls) throw new NotFoundException('Class not found.');
    const [rows, perWeek, placed] = await Promise.all([
      this.prisma.classSubject.findMany({
        where: { classId },
        include: { subject: { select: { id: true, name: true, nameAr: true } }, teacher: { select: { id: true, name: true, honorific: true } } },
      }),
      this.prisma.gradeSubject.findMany({ where: { gradeId: cls.gradeId }, select: { subjectId: true, lessonsPerWeek: true } }),
      this.prisma.timetableEntry.groupBy({ by: ['subjectId'], where: { classId }, _count: true }),
    ]);
    const want = new Map(perWeek.map((p) => [p.subjectId, p.lessonsPerWeek]));
    const have = new Map(placed.map((p) => [p.subjectId, p._count]));
    return rows
      .map((r) => ({ subjectId: r.subjectId, name: r.subject.name, nameAr: r.subject.nameAr, lessonsPerWeek: want.get(r.subjectId) ?? null, lessons: have.get(r.subjectId) ?? 0, teacher: r.teacher }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

@Roles(...STAFF)
@Controller()
export class CurriculumController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Get('curriculum')
  overview(@SchoolId() schoolId: string) {
    return this.curriculum.overview(schoolId);
  }

  @Get('curriculum/teachers')
  assignments(@SchoolId() schoolId: string) {
    return this.curriculum.assignments(schoolId);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Put('grades/:gradeId/subjects/:subjectId')
  set(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('gradeId') gradeId: string, @Param('subjectId') subjectId: string, @Body() dto: GradeSubjectDto) {
    return this.curriculum.setGradeSubject(user, schoolId, gradeId, subjectId, dto);
  }

  @Roles(Role.SCHOOL_ADMIN)
  @Delete('grades/:gradeId/subjects/:subjectId')
  remove(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('gradeId') gradeId: string, @Param('subjectId') subjectId: string) {
    return this.curriculum.removeGradeSubject(user, schoolId, gradeId, subjectId);
  }

  @Get('classes/:classId/subjects')
  classSubjects(@SchoolId() schoolId: string, @Param('classId') classId: string) {
    return this.curriculum.classSubjects(schoolId, classId);
  }
}
