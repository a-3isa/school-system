import { Module } from '@nestjs/common';
import { AnnouncementsController, AnnouncementsService, ParentAnnouncementsController } from './announcements';
import { ChatService, ParentChatController, ThreadsController } from './chat';
import { ChatGatewayModule } from './chat-gateway.module';
import { MeetingsController, MeetingsService, ParentMeetingsController } from './meetings';
import { ParentPollsController, PollsController, PollsService } from './polls';

/** Announcements, the emergency message, polls, parent–teacher chat and meetings. */
@Module({
  imports: [ChatGatewayModule],
  controllers: [
    AnnouncementsController, ParentAnnouncementsController,
    PollsController, ParentPollsController,
    ParentChatController, ThreadsController,
    MeetingsController, ParentMeetingsController,
  ],
  providers: [AnnouncementsService, PollsService, ChatService, MeetingsService],
})
export class MessagingModule {}
