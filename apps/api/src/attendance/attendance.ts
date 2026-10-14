import { Body, Controller, Get, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Param, Post, Put, Query } from '@nestjs/common';
import { AttendanceStatus, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Min, MinLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, RequiresModule, Roles, SchoolId, SCHOOL_WIDE, STAFF } from '../auth/auth.decorators';
import { DATE_RE } from '../common/dates';
import { NotificationsService } from '../notifications/notifications';
import { AttendanceService } from './attendance.service';
import { AttendanceEvaluator } from '../devices/evaluator';
import { DevicesModule } from '../devices/exceptions';
import { ExcusesModule, ExcusesService } from '../excuses/excuses';
import { ActivitiesModule } from '../activities/activities.module';
import { TripsService } from '../activities/trips';

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

  @Roles(...SCHOOL_WIDE)
  @Get('summary')
  async summary(@SchoolId() schoolId: string, @Query('date') date?: string) {
    return this.attendance.summary(schoolId, date ?? (await this.attendance.today(schoolId)));
  }

  @Roles(...SCHOOL_WIDE)
  @Get('students/:id')
  history(@SchoolId() schoolId: string, @Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    return this.attendance.studentHistory(schoolId, id, from, to);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post('aways')
  away(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: AwayDto) {
    return this.attendance.markAway(user, schoolId, dto);
  }

  @Roles(...SCHOOL_WIDE)
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

  /** The child's whole day: arrival, where they are now, and every lesson (taken or still to come). */
  @Get(':id/today')
  async today(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string, @Query('date') date?: string) {
    return this.attendance.childToday(user.id, id, date ?? (await this.attendance.today(schoolId)));
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
    private readonly excuses: ExcusesService,
    private readonly trips: TripsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_JOBS === '1') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private running = false;

  /**
   * One run at a time: a minute that runs long is not joined by the next one, which would send the
   * same messages twice. Each step runs even if an earlier one failed.
   */
  async tick(now = new Date()) {
    if (this.running) {
      this.logger.warn('The previous minute is still running; skipping this one.');
      return;
    }
    this.running = true;
    const steps: [string, () => Promise<unknown>][] = [
      ['evaluator', () => this.evaluator.tick(now)],
      ['absence notices', () => this.attendance.sendAbsenceNotices(now)],
      ['approved excuses', () => this.excuses.applyApproved()],
      ['follow-up alerts', () => this.excuses.checkAlerts(now)],
      ['trip reminders', () => this.trips.remind(now)],
      ['push messages', () => this.notifications.flush()],
    ];
    try {
      for (const [name, run] of steps) {
        try {
          await run();
        } catch (e) {
          this.logger.error(`${name} failed`, e instanceof Error ? e.stack : String(e));
        }
      }
    } finally {
      this.running = false;
    }
  }
}

@Module({
  imports: [DevicesModule, ExcusesModule, ActivitiesModule],
  controllers: [AttendanceController, ParentAttendanceController],
  providers: [AttendanceService, AttendanceJobs],
  exports: [AttendanceService],
})
export class AttendanceModule {}
