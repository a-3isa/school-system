import { PrismaService } from '../prisma/prisma.service';
import { AudienceService, matchesAudience, ParentContext } from './audience';

function service(over: Record<string, unknown> = {}) {
  const prisma = {
    grade: { count: jest.fn().mockResolvedValue(1) },
    class: { count: jest.fn().mockResolvedValue(1) },
    activity: { count: jest.fn().mockResolvedValue(1) },
    student: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    ...over,
  };
  return { svc: new AudienceService(prisma as unknown as PrismaService), prisma };
}

describe('AudienceService', () => {
  it('accepts the whole school without ids', async () => {
    await expect(service().svc.validate('s1', { kind: 'SCHOOL' })).resolves.toBeUndefined();
  });

  it('asks for at least one year group or class', async () => {
    await expect(service().svc.validate('s1', { kind: 'GRADES', ids: [] })).rejects.toThrow('Choose at least one year group or class.');
    await expect(service().svc.validate('s1', { kind: 'CLASSES' })).rejects.toThrow('Choose at least one year group or class.');
  });

  it('refuses ids that are not this school’s', async () => {
    const { svc } = service({ class: { count: jest.fn().mockResolvedValue(1) } });
    await expect(svc.validate('s1', { kind: 'CLASSES', ids: ['a', 'b'] })).rejects.toThrow('Year group or class not found.');
  });

  it('counts a repeated id once', async () => {
    const { svc } = service();
    await expect(svc.validate('s1', { kind: 'GRADES', ids: ['g1', 'g1'] })).resolves.toBeUndefined();
  });

  it('takes a club as an audience: it asks for one, and only this school’s own', async () => {
    await expect(service().svc.validate('s1', { kind: 'ACTIVITY', ids: ['x'] })).resolves.toBeUndefined();
    await expect(service().svc.validate('s1', { kind: 'ACTIVITY', ids: [] })).rejects.toThrow('Choose at least one club.');
    const { svc } = service({ activity: { count: jest.fn().mockResolvedValue(0) } });
    await expect(svc.validate('s1', { kind: 'ACTIVITY', ids: ['x'] })).rejects.toThrow('Club not found.');
  });

  it('reaches the enrolled members of a club, not those waiting or withdrawn', async () => {
    const { svc, prisma } = service();
    await svc.reach('s1', { kind: 'ACTIVITY', ids: ['a1'] });
    expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({ schoolId: 's1', active: true, activityEnrolments: { some: { activityId: { in: ['a1'] }, status: 'ENROLLED' } } });
  });

  it('reaches unrestricted parents once each, even with two children', async () => {
    const guardian = (userId: string, active = true) => ({ userId, user: { active } });
    const { svc, prisma } = service();
    prisma.student.findMany.mockResolvedValue([
      { id: 'k1', firstName: 'Salma', gender: 'FEMALE', classId: 'c1', guardians: [guardian('p1'), guardian('p2')] },
      { id: 'k2', firstName: 'Omar', gender: 'MALE', classId: 'c1', guardians: [guardian('p1'), guardian('p3', false)] },
    ]);
    const reach = await svc.reach('s1', { kind: 'CLASSES', ids: ['c1'] });
    expect(reach.parentIds.sort()).toEqual(['p1', 'p2']);
    expect(reach.pairs).toHaveLength(3);
    expect(reach.students.map((s) => s.id)).toEqual(['k1', 'k2']);
    // Restricted guardians are filtered in the query itself (decision G36).
    const where = prisma.student.findMany.mock.calls[0][0];
    expect(where.select.guardians.where).toEqual({ restricted: false });
    expect(where.where).toEqual({ schoolId: 's1', active: true, classId: { in: ['c1'] } });
  });

  it('filters year groups through the class', async () => {
    const { svc, prisma } = service();
    await svc.reach('s1', { kind: 'GRADES', ids: ['g1'] });
    expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({ schoolId: 's1', active: true, class: { gradeId: { in: ['g1'] } } });
  });

  it('tells whether a parent has an unrestricted child in the audience', async () => {
    const { svc, prisma } = service();
    prisma.student.count.mockResolvedValue(1);
    await expect(svc.includesParent('s1', { kind: 'SCHOOL' }, 'p1')).resolves.toBe(true);
    expect(prisma.student.count.mock.calls[0][0].where.guardians).toEqual({ some: { userId: 'p1', restricted: false } });
    prisma.student.count.mockResolvedValue(0);
    await expect(svc.includesParent('s1', { kind: 'SCHOOL' }, 'p1')).resolves.toBe(false);
  });

  it('reads a parent’s unrestricted children, their classes, year groups and clubs, in one query', async () => {
    const { svc, prisma } = service();
    prisma.student.findMany.mockResolvedValue([
      { classId: 'c1', class: { gradeId: 'g1' }, activityEnrolments: [{ activityId: 'a1' }] },
      { classId: 'c2', class: { gradeId: 'g1' }, activityEnrolments: [] },
      { classId: null, class: null, activityEnrolments: [] },
    ]);
    const ctx = await svc.parentContext('s1', 'p1');
    expect(prisma.student.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({ schoolId: 's1', active: true, guardians: { some: { userId: 'p1', restricted: false } } });
    expect(ctx).toEqual({ hasChildren: true, classIds: new Set(['c1', 'c2']), gradeIds: new Set(['g1']), activityIds: new Set(['a1']) });
  });
});

describe('audience matching', () => {
  const ctx = (over: Partial<ParentContext> = {}): ParentContext => ({ hasChildren: true, classIds: new Set(['c1']), gradeIds: new Set(['g1']), activityIds: new Set(['a1']), ...over });
  const none: ParentContext = { hasChildren: false, classIds: new Set(), gradeIds: new Set(), activityIds: new Set() };

  it('reaches every parent who has a child at the school when it is for the whole school', () => {
    expect(matchesAudience({ kind: 'SCHOOL' }, ctx())).toBe(true);
    expect(matchesAudience({ kind: 'SCHOOL' }, ctx({ classIds: new Set(), gradeIds: new Set() }))).toBe(true); // a child not yet in a class
    expect(matchesAudience({ kind: 'SCHOOL' }, none)).toBe(false);
  });

  it('reaches a parent through a child’s class, year group or club', () => {
    expect(matchesAudience({ kind: 'CLASSES', ids: ['c9', 'c1'] }, ctx())).toBe(true);
    expect(matchesAudience({ kind: 'CLASSES', ids: ['c9'] }, ctx())).toBe(false);
    expect(matchesAudience({ kind: 'GRADES', ids: ['g1'] }, ctx())).toBe(true);
    expect(matchesAudience({ kind: 'GRADES', ids: ['g2'] }, ctx())).toBe(false);
    expect(matchesAudience({ kind: 'ACTIVITY', ids: ['a1'] }, ctx())).toBe(true);
    expect(matchesAudience({ kind: 'ACTIVITY', ids: ['a2'] }, ctx())).toBe(false);
  });

  it('reaches nobody when a list audience names nothing', () => {
    for (const kind of ['CLASSES', 'GRADES', 'ACTIVITY'] as const) {
      expect(matchesAudience({ kind }, ctx())).toBe(false);
      expect(matchesAudience({ kind, ids: [] }, ctx())).toBe(false);
    }
  });
});
