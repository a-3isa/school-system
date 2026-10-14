import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // The crest is a file of bytes. It stays out of every read of the school unless
    // the query asks for it by name (see GET /school/logo).
    // PRISMA_QUERY_EVENTS=1 lets the performance scripts (scripts/perf) count every SQL statement.
    super({ omit: { school: { logo: true } }, ...(process.env.PRISMA_QUERY_EVENTS === '1' ? { log: [{ emit: 'event' as const, level: 'query' as const }] } : {}) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
