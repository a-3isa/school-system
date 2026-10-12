import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.decorators';

export const CANT_MARK = 'You can only mark subjects you teach.';

/**
 * Who may read and write marks (decision T5 and the Academics spec):
 * - Student Affairs does everything; the social worker reads everything.
 * - A teacher writes the subjects they teach in a class (from the timetable).
 * - The class teacher (homeroom) reads every subject of their class.
 */
@Injectable()
export class AcademicsAccess {
  constructor(private readonly prisma: PrismaService) {}

  /** The class and subject pairs a teacher teaches: the subjects the school has assigned to them. */
  async pairs(schoolId: string, teacherId: string) {
    return this.prisma.classSubject.findMany({ where: { teacherId, class: { schoolId } }, select: { classId: true, subjectId: true } });
  }

  async homeroomIds(schoolId: string, teacherId: string): Promise<string[]> {
    const classes = await this.prisma.class.findMany({ where: { schoolId, homeroomTeacherId: teacherId }, select: { id: true } });
    return classes.map((c) => c.id);
  }

  async teaches(user: AuthUser, schoolId: string, classId: string, subjectId: string): Promise<boolean> {
    if (user.role === Role.SCHOOL_ADMIN) return true;
    if (user.role !== Role.TEACHER) return false;
    return !!(await this.prisma.classSubject.findFirst({ where: { classId, subjectId, teacherId: user.id, class: { schoolId } }, select: { classId: true } }));
  }

  async isHomeroom(user: AuthUser, schoolId: string, classId: string): Promise<boolean> {
    if (user.role === Role.SCHOOL_ADMIN) return true;
    if (user.role !== Role.TEACHER) return false;
    return !!(await this.prisma.class.findFirst({ where: { id: classId, schoolId, homeroomTeacherId: user.id }, select: { id: true } }));
  }

  /** Reading a subject's marks: Student Affairs, the social worker, the class teacher, or a teacher of that subject in the class. */
  async mayRead(user: AuthUser, schoolId: string, classId: string, subjectId?: string): Promise<boolean> {
    if (user.role === Role.SCHOOL_ADMIN || user.role === Role.SOCIAL_WORKER) return true;
    if (user.role !== Role.TEACHER) return false;
    if (await this.isHomeroom(user, schoolId, classId)) return true;
    if (subjectId) return this.teaches(user, schoolId, classId, subjectId);
    return !!(await this.prisma.classSubject.findFirst({ where: { classId, teacherId: user.id, class: { schoolId } }, select: { classId: true } }));
  }

  async assertMayWrite(user: AuthUser, schoolId: string, classId: string, subjectId: string) {
    if (!(await this.teaches(user, schoolId, classId, subjectId))) throw new ForbiddenException(CANT_MARK);
  }

  /** Which assessments a person may list: all for Student Affairs and the social worker; for a teacher, their subjects and their class's. */
  async readableAssessments(user: AuthUser, schoolId: string): Promise<Prisma.AssessmentWhereInput> {
    if (user.role === Role.SCHOOL_ADMIN || user.role === Role.SOCIAL_WORKER) return { schoolId };
    const [pairs, homerooms] = await Promise.all([this.pairs(schoolId, user.id), this.homeroomIds(schoolId, user.id)]);
    return { schoolId, OR: [...(homerooms.length ? [{ classId: { in: homerooms } }] : []), ...pairs.map((p) => ({ classId: p.classId, subjectId: p.subjectId }))] };
  }
}
