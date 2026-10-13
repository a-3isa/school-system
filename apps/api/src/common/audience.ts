import { BadRequestException, Global, Injectable, Module } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

/** Who a message, poll or event is for: everyone, some year groups, some classes, or a club. */
export const AUDIENCE_KINDS = ['SCHOOL', 'GRADES', 'CLASSES', 'ACTIVITY'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

export class AudienceDto {
  @IsIn(AUDIENCE_KINDS) kind: AudienceKind;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids?: string[];
}

export interface Reach {
  students: { id: string; firstName: string; gender: Gender | null; classId: string | null }[];
  /** Parents to write to: unrestricted guardians only (decision G36), each once. */
  parentIds: string[];
  /** Which parent is reached through which child. */
  pairs: { parentId: string; studentId: string }[];
}

const unique = (ids: string[] | undefined) => [...new Set(ids ?? [])];

/** What decides whether one parent is in an audience: where their unrestricted children are. */
export interface ParentContext {
  hasChildren: boolean;
  classIds: Set<string>;
  gradeIds: Set<string>;
  activityIds: Set<string>;
}

/** Is a parent with these children in the audience? The same answer as the database gives, with no query. */
export function matchesAudience(a: AudienceDto, ctx: ParentContext): boolean {
  const ids = unique(a.ids);
  switch (a.kind) {
    case 'SCHOOL':
      return ctx.hasChildren;
    case 'GRADES':
      return ids.some((id) => ctx.gradeIds.has(id));
    case 'CLASSES':
      return ids.some((id) => ctx.classIds.has(id));
    case 'ACTIVITY':
      return ids.some((id) => ctx.activityIds.has(id));
  }
}

@Injectable()
export class AudienceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws when the audience is incomplete or names something that isn't this school's. */
  async validate(schoolId: string, a: AudienceDto): Promise<void> {
    const ids = unique(a.ids);
    switch (a.kind) {
      case 'SCHOOL':
        return;
      case 'GRADES': {
        if (!ids.length) throw new BadRequestException('Choose at least one year group or class.');
        const found = await this.prisma.grade.count({ where: { schoolId, id: { in: ids } } });
        if (found !== ids.length) throw new BadRequestException('Year group or class not found.');
        return;
      }
      case 'CLASSES': {
        if (!ids.length) throw new BadRequestException('Choose at least one year group or class.');
        const found = await this.prisma.class.count({ where: { schoolId, id: { in: ids } } });
        if (found !== ids.length) throw new BadRequestException('Year group or class not found.');
        return;
      }
      case 'ACTIVITY': {
        if (!ids.length) throw new BadRequestException('Choose at least one club.');
        const found = await this.prisma.activity.count({ where: { schoolId, id: { in: ids }, archivedAt: null } });
        if (found !== ids.length) throw new BadRequestException('Club not found.');
        return;
      }
    }
  }

  /** The active students in the audience. */
  private studentWhere(schoolId: string, a: AudienceDto): Prisma.StudentWhereInput {
    const ids = unique(a.ids);
    const base: Prisma.StudentWhereInput = { schoolId, active: true };
    switch (a.kind) {
      case 'SCHOOL':
        return base;
      case 'GRADES':
        return { ...base, class: { gradeId: { in: ids } } };
      case 'CLASSES':
        return { ...base, classId: { in: ids } };
      case 'ACTIVITY':
        return { ...base, activityEnrolments: { some: { activityId: { in: ids }, status: 'ENROLLED' } } };
    }
  }

  /** Students in the audience and the parents who should hear about them. */
  async reach(schoolId: string, a: AudienceDto): Promise<Reach> {
    const students = await this.prisma.student.findMany({
      where: this.studentWhere(schoolId, a),
      select: {
        id: true, firstName: true, gender: true, classId: true,
        guardians: { where: { restricted: false }, select: { userId: true, user: { select: { active: true } } } },
      },
    });
    const pairs: Reach['pairs'] = [];
    for (const s of students) {
      for (const g of s.guardians) if (g.user.active) pairs.push({ parentId: g.userId, studentId: s.id });
    }
    return {
      students: students.map(({ guardians: _, ...s }) => s),
      parentIds: [...new Set(pairs.map((p) => p.parentId))],
      pairs,
    };
  }

  /** A parent's active, unrestricted children: their classes, year groups and clubs, in one query. */
  async parentContext(schoolId: string, parentId: string): Promise<ParentContext> {
    const children = await this.prisma.student.findMany({
      where: { schoolId, active: true, guardians: { some: { userId: parentId, restricted: false } } },
      select: { classId: true, class: { select: { gradeId: true } }, activityEnrolments: { where: { status: 'ENROLLED' }, select: { activityId: true } } },
    });
    const ctx: ParentContext = { hasChildren: children.length > 0, classIds: new Set(), gradeIds: new Set(), activityIds: new Set() };
    for (const c of children) {
      if (c.classId) ctx.classIds.add(c.classId);
      if (c.class) ctx.gradeIds.add(c.class.gradeId);
      for (const e of c.activityEnrolments) ctx.activityIds.add(e.activityId);
    }
    return ctx;
  }

  /** Is one of this parent's children (not restricted) in the audience? */
  async includesParent(schoolId: string, a: AudienceDto, parentId: string): Promise<boolean> {
    const count = await this.prisma.student.count({
      where: { ...this.studentWhere(schoolId, a), guardians: { some: { userId: parentId, restricted: false } } },
    });
    return count > 0;
  }
}

@Global()
@Module({ providers: [AudienceService], exports: [AudienceService] })
export class AudienceModule {}
