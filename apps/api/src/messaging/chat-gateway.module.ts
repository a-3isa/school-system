import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';

/** The live-chat socket server on its own, so sign-in and staff code can close a person's connections. */
@Module({ providers: [ChatGateway], exports: [ChatGateway] })
export class ChatGatewayModule {}
