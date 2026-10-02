import { Controller, Get, Injectable, NotFoundException, Param, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Roles, SchoolId, SCHOOL_WIDE } from '../auth/auth.decorators';

const parentSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  active: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  consentAt: true,
  createdAt: true,
  children: {
    select: {
      relation: true,
      restricted: true,
      student: { select: { id: true, code: true, firstName: true, lastName: true, nameAr: true, active: true, class: { select: { id: true, name: true } } } },
    },
    orderBy: { student: { firstName: 'asc' } },
  },
} satisfies Prisma.UserSelect;

/** Parents and guardians of a school, each with their children. */
@Injectable()
export class ParentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(schoolId: string, q?: string) {
    const term = q?.trim();
    return this.prisma.user.findMany({
      where: {
        schoolId,
        role: Role.PARENT,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } },
                { children: { some: { student: { OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { code: term }] } } } },
              ],
            }
          : {}),
      },
      select: parentSelect,
      orderBy: { name: 'asc' },
    });
  }

  async get(schoolId: string, id: string) {
    const parent = await this.prisma.user.findFirst({ where: { id, schoolId, role: Role.PARENT }, select: parentSelect });
    if (!parent) throw new NotFoundException('Parent not found.');
    return parent;
  }
}

@Roles(...SCHOOL_WIDE)
@Controller('parents')
export class ParentsController {
  constructor(private readonly parents: ParentsService) {}

  @Get()
  list(@SchoolId() schoolId: string, @Query('q') q?: string) {
    return this.parents.list(schoolId, q);
  }

  @Get(':id')
  get(@SchoolId() schoolId: string, @Param('id') id: string) {
    return this.parents.get(schoolId, id);
  }
}
