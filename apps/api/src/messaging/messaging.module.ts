import { Module } from '@nestjs/common';
import { AnnouncementsController, AnnouncementsService, ParentAnnouncementsController } from './announcements';
import { ChatService, ParentChatController, ThreadsController } from './chat';
import { ChatGateway } from './chat.gateway';
import { MeetingsController, MeetingsService, ParentMeetingsController } from './meetings';
import { ParentPollsController, PollsController, PollsService } from './polls';

/** Announcements, the emergency message, polls, parent–teacher chat and meetings. */
@Module({
  controllers: [
    AnnouncementsController, ParentAnnouncementsController,
    PollsController, ParentPollsController,
    ParentChatController, ThreadsController,
    MeetingsController, ParentMeetingsController,
  ],
  providers: [AnnouncementsService, PollsService, ChatService, ChatGateway, MeetingsService],
})
export class MessagingModule {}
