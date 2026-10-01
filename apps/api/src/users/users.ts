import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, Roles, SchoolId } from '../auth/auth.decorators';
import { hashPassword } from '../auth/auth';
import { mapPrismaError } from '../common/validation';

// Staff roles a school admin can create. Parents are created from a student's record.
const STAFF_ROLES = [Role.SCHOOL_ADMIN, Role.TEACHER, Role.TRANSPORT, Role.NURSE, Role.CANTEEN, Role.ACCOUNTANT] as const;

export class CreateStaffDto {
  @IsString() @MinLength(1) name: string;
  @IsIn(STAFF_ROLES) role: (typeof STAFF_ROLES)[number];
  @IsEmail() email: string;
  @IsOptional() @IsString() phone?: string;
  @IsString() @MinLength(8) password: string;
}

export class UpdateStaffDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

const publicUser = { id: true, name: true, email: true, phone: true, role: true, active: true, createdAt: true } as const;

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

  @Post()
  async create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: CreateStaffDto) {
    const created = await this.prisma.user
      .create({
        data: { schoolId, name: dto.name, role: dto.role, email: dto.email.toLowerCase(), phone: dto.phone, passwordHash: await hashPassword(dto.password) },
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
      data: { name: dto.name, active: dto.active, passwordHash: dto.password ? await hashPassword(dto.password) : undefined },
      select: publicUser,
    });
    await this.audit.log(user, 'staff.update', 'user', id, { name: dto.name, active: dto.active, passwordChanged: !!dto.password });
    return updated;
  }
}

@Module({ controllers: [StaffController] })
export class UsersModule {}
