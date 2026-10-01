import { Body, Controller, Get, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Param, Post, Put, Query } from '@nestjs/common';
import { AttendanceStatus, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Min, MinLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId, STAFF } from '../auth/auth.decorators';
import { DATE_RE } from '../common/dates';
import { NotificationsService } from '../notifications/notifications';
import { AttendanceService } from './attendance.service';
import { AttendanceEvaluator } from '../devices/evaluator';
import { DevicesModule } from '../devices/exceptions';

class MarkDto {
  @IsString() studentId: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @IsOptional() @IsString() reason?: string;
}

export class MarkLessonDto {
  @Matches(DATE_RE, { message: 'date must look like 2026-09-30' }) date: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => MarkDto) marks: MarkDto[];
}

export class AwayDto {
  @IsString() classId: string;
  @Matches(DATE_RE, { message: 'date must look like 2026-09-30' }) date: string;
  @IsOptional() @IsInt() @Min(1) fromPeriod?: number;
  @IsOptional() @IsInt() @Min(1) toPeriod?: number;
  @IsString() @MinLength(2) reason: string;
}

@RequiresModule('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** The caller's lesson right now and their next one: where a teacher starts. */
  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Get('now')
  current(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string) {
    return this.attendance.current(user, schoolId);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Get('my-lessons')
  async myLessons(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Query('date') date?: string) {
    return this.attendance.myLessons(user, schoolId, date ?? (await this.attendance.today(schoolId)));
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Get('classes/:classId/periods/:periodId')
  async roster(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('classId') classId: string, @Param('periodId') periodId: string, @Query('date') date?: string) {
    return this.attendance.roster(user, schoolId, classId, periodId, date ?? (await this.attendance.today(schoolId)));
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Put('classes/:classId/periods/:periodId')
  mark(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('classId') classId: string, @Param('periodId') periodId: string, @Body() dto: MarkLessonDto) {
    return this.attendance.mark(user, schoolId, classId, periodId, dto.date, dto.marks);
  }

  @Roles(...STAFF)
  @Get('summary')
  async summary(@SchoolId() schoolId: string, @Query('date') date?: string) {
    return this.attendance.summary(schoolId, date ?? (await this.attendance.today(schoolId)));
  }

  @Roles(...STAFF)
  @Get('students/:id')
  history(@SchoolId() schoolId: string, @Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    return this.attendance.studentHistory(schoolId, id, from, to);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post('aways')
  away(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: AwayDto) {
    return this.attendance.markAway(user, schoolId, dto);
  }

  @Roles(...STAFF)
  @Get('aways')
  async aways(@SchoolId() schoolId: string, @Query('date') date?: string) {
    return this.attendance.aways(schoolId, date ?? (await this.attendance.today(schoolId)));
  }
}

@RequiresModule('attendance')
@Roles(Role.PARENT)
@Controller('parent/children')
export class ParentAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get(':id/attendance')
  async day(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Query('date') date?: string) {
    return this.attendance.childDay(user.id, id, date ?? (await this.attendance.today(schoolId)));
  }
}

/** Runs the timed work every minute: automatic attendance, absence notices, then pushing notifications. */
@Injectable()
export class AttendanceJobs implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('Jobs');

  constructor(
    private readonly attendance: AttendanceService,
    private readonly notifications: NotificationsService,
    private readonly evaluator: AttendanceEvaluator,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_JOBS === '1') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    try {
      await this.evaluator.tick(now);
      await this.attendance.sendAbsenceNotices(now);
      await this.notifications.flush();
    } catch (e) {
      this.logger.error(e);
    }
  }
}

@Module({
  imports: [DevicesModule],
  controllers: [AttendanceController, ParentAttendanceController],
  providers: [AttendanceService, AttendanceJobs],
  exports: [AttendanceService],
})
export class AttendanceModule {}
