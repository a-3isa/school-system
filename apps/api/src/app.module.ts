import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.service';
import { AuthModule } from './auth/auth';
import { AccessGuard } from './auth/access.guard';
import { AuditModule } from './audit/audit';
import { PlatformModule } from './platform/modules';
import { SetupModule } from './setup/setup';
import { CalendarModule } from './setup/calendar';
import { TimetableModule } from './timetable/timetable';
import { UsersModule } from './users/users';
import { StudentsModule } from './students/students.module';
import { NotificationsModule } from './notifications/notifications';
import { AttendanceModule } from './attendance/attendance';
import { AudienceModule } from './common/audience';
import { MessagingModule } from './messaging/messaging.module';

@Module({
  imports: [PrismaModule, CalendarModule, AudienceModule, AuthModule, AuditModule, PlatformModule, SetupModule, TimetableModule, UsersModule, StudentsModule, NotificationsModule, AttendanceModule, MessagingModule],
  providers: [{ provide: APP_GUARD, useClass: AccessGuard }],
})
export class AppModule {}
