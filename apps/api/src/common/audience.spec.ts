import { PrismaService } from '../prisma/prisma.service';
import { AudienceService } from './audience';

function service(over: Record<string, unknown> = {}) {
  const prisma = {
    grade: { count: jest.fn().mockResolvedValue(1) },
    class: { count: jest.fn().mockResolvedValue(1) },
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

  it('keeps clubs out until the Activities module exists', async () => {
    await expect(service().svc.validate('s1', { kind: 'ACTIVITY', ids: ['x'] })).rejects.toThrow('Clubs aren’t available yet.');
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
});
