import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Post } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit';
import { AuthUser, CurrentUser, RequiresFeature, RequiresModule, Roles, SchoolId } from '../auth/auth.decorators';
import { AudienceDto, AudienceService } from '../common/audience';
import { NotificationsService } from '../notifications/notifications';
import { assertMayTarget } from './shared';

export class CreatePollDto {
  @IsString() @MinLength(1) @MaxLength(200) question: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(10) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(80, { each: true }) options: string[];
  @IsOptional() @IsBoolean() multiple?: boolean;
  @IsOptional() @IsBoolean() anonymous?: boolean;
  @IsOptional() @IsBoolean() showResults?: boolean;
  @IsISO8601() closesAt: string;
  @ValidateNested() @Type(() => AudienceDto) audience: AudienceDto;
}

export class VoteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) optionIds: string[];
}

const pollSelect = {
  id: true, question: true, audience: true, multiple: true, anonymous: true, showResults: true, closesAt: true, closedAt: true,
  createdAt: true, authorId: true,
  author: { select: { name: true, honorific: true } },
  options: { select: { id: true, label: true, order: true }, orderBy: { order: 'asc' } },
  _count: { select: { targets: true } },
} satisfies Prisma.PollSelect;
type PollRow = Prisma.PollGetPayload<{ select: typeof pollSelect }>;

const isOpen = (p: { closedAt: Date | null; closesAt: Date }, now: Date) => !p.closedAt && p.closesAt.getTime() > now.getTime();

@Injectable()
export class PollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly audiences: AudienceService,
  ) {}

  /** Votes per option and how many parents voted. */
  private async tally(pollIds: string[]) {
    const votes = await this.prisma.pollVote.findMany({ where: { pollId: { in: pollIds } }, select: { pollId: true, optionId: true, userId: true } });
    return (pollId: string) => {
      const mine = votes.filter((v) => v.pollId === pollId);
      const perOption = new Map<string, number>();
      for (const v of mine) perOption.set(v.optionId, (perOption.get(v.optionId) ?? 0) + 1);
      return { perOption, voters: new Set(mine.map((v) => v.userId)).size };
    };
  }

  private async find(schoolId: string, id: string) {
    const p = await this.prisma.poll.findFirst({ where: { id, schoolId }, select: pollSelect });
    if (!p) throw new NotFoundException('Poll not found.');
    return p;
  }

  /** A teacher sees only their own polls. */
  private mustSee(user: AuthUser, p: PollRow) {
    if (user.role === Role.TEACHER && p.authorId !== user.id) throw new NotFoundException('Poll not found.');
  }

  // ---- staff ---------------------------------------------------------------

  async create(user: AuthUser, schoolId: string, dto: CreatePollDto, now = new Date()) {
    const labels = dto.options.map((o) => o.trim());
    if (labels.some((l) => !l)) throw new BadRequestException('Every answer needs some text.');
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw new BadRequestException('Each answer must be different.');
    const closesAt = new Date(dto.closesAt);
    if (closesAt.getTime() <= now.getTime()) throw new BadRequestException('The closing time must be in the future.');
    await assertMayTarget(this.prisma, user, schoolId, dto.audience);
    await this.audiences.validate(schoolId, dto.audience);
    const reach = await this.audiences.reach(schoolId, dto.audience);
    if (!reach.parentIds.length) throw new BadRequestException('There are no parents to send this to yet.');

    const poll = await this.prisma.poll.create({
      data: {
        schoolId, question: dto.question.trim(), audience: { kind: dto.audience.kind, ids: dto.audience.ids ?? [] }, closesAt, authorId: user.id,
        multiple: dto.multiple ?? false, anonymous: dto.anonymous ?? true, showResults: dto.showResults ?? true,
        options: { create: labels.map((label, order) => ({ label, order })) },
        targets: { create: reach.parentIds.map((userId) => ({ userId })) },
      },
      select: pollSelect,
    });
    await this.notifications.notify(
      reach.parentIds.map((userId) => ({
        schoolId, userId, type: 'poll.new', title: `The school asks your opinion: ${poll.question}`, body: 'Open the app to answer.',
        data: { pollId: poll.id, question: poll.question },
      })),
    );
    await this.audit.log(user, 'poll.create', 'poll', poll.id, { parents: reach.parentIds.length });
    return this.presentForStaff(user, poll, now);
  }

  private async presentForStaff(user: AuthUser, p: PollRow, now: Date, tally?: Awaited<ReturnType<PollsService['tally']>>) {
    const t = (tally ?? (await this.tally([p.id])))(p.id);
    const { _count, options, ...rest } = p;
    return {
      ...rest, open: isOpen(p, now), targets: _count.targets, voters: t.voters,
      options: options.map((o) => ({ id: o.id, label: o.label, votes: t.perOption.get(o.id) ?? 0 })),
    };
  }

  async list(user: AuthUser, schoolId: string, now = new Date()) {
    const polls = await this.prisma.poll.findMany({
      where: { schoolId, ...(user.role === Role.TEACHER ? { authorId: user.id } : {}) },
      select: pollSelect, orderBy: { createdAt: 'desc' }, take: 100,
    });
    const tally = await this.tally(polls.map((p) => p.id));
    return Promise.all(polls.map((p) => this.presentForStaff(user, p, now, tally)));
  }

  async detail(user: AuthUser, schoolId: string, id: string, now = new Date()) {
    const p = await this.find(schoolId, id);
    this.mustSee(user, p);
    const result = await this.presentForStaff(user, p, now);
    // Who voted for what is shown to Student Affairs only, and only when the poll wasn't anonymous.
    if (!p.anonymous && user.role === Role.SCHOOL_ADMIN) {
      const votes = await this.prisma.pollVote.findMany({ where: { pollId: id }, include: { user: { select: { name: true } } } });
      const byOption: Record<string, string[]> = {};
      for (const v of votes) (byOption[v.optionId] ??= []).push(v.user.name);
      return { ...result, byOption };
    }
    return result;
  }

  async close(user: AuthUser, schoolId: string, id: string, now = new Date()) {
    const p = await this.find(schoolId, id);
    if (user.role !== Role.SCHOOL_ADMIN && p.authorId !== user.id) throw new NotFoundException('Poll not found.');
    await this.prisma.poll.updateMany({ where: { id, schoolId, closedAt: null }, data: { closedAt: now } });
    await this.audit.log(user, 'poll.close', 'poll', id);
    return this.detail(user, schoolId, id, now);
  }

  // ---- parent --------------------------------------------------------------

  async listForParent(parentId: string, now = new Date()) {
    const polls = await this.prisma.poll.findMany({
      where: { targets: { some: { userId: parentId } } }, select: pollSelect, orderBy: { createdAt: 'desc' }, take: 50,
    });
    const tally = await this.tally(polls.map((p) => p.id));
    const mine = await this.prisma.pollVote.findMany({ where: { userId: parentId, pollId: { in: polls.map((p) => p.id) } }, select: { pollId: true, optionId: true } });
    return polls.map((p) => {
      const t = tally(p.id);
      const myVotes = mine.filter((v) => v.pollId === p.id).map((v) => v.optionId);
      const open = isOpen(p, now);
      const showResults = (p.showResults && myVotes.length > 0) || !open;
      return {
        id: p.id, question: p.question, multiple: p.multiple, closesAt: p.closesAt, createdAt: p.createdAt, open, myVotes,
        author: p.author,
        options: p.options.map((o) => ({ id: o.id, label: o.label, ...(showResults ? { votes: t.perOption.get(o.id) ?? 0 } : {}) })),
        ...(showResults ? { voters: t.voters } : {}),
      };
    });
  }

  async vote(parentId: string, id: string, dto: VoteDto, now = new Date()) {
    const poll = await this.prisma.poll.findFirst({
      where: { id, targets: { some: { userId: parentId } } },
      select: { id: true, multiple: true, closesAt: true, closedAt: true, options: { select: { id: true } } },
    });
    if (!poll) throw new NotFoundException('Poll not found.');
    if (!isOpen(poll, now)) throw new BadRequestException('This poll has closed.');
    const chosen = [...new Set(dto.optionIds)];
    if (!chosen.every((o) => poll.options.some((x) => x.id === o))) throw new BadRequestException('Choose one of the answers listed.');
    if (!poll.multiple && chosen.length !== 1) throw new BadRequestException('Choose one answer.');
    await this.prisma.$transaction([
      this.prisma.pollVote.deleteMany({ where: { pollId: id, userId: parentId } }),
      this.prisma.pollVote.createMany({ data: chosen.map((optionId) => ({ pollId: id, optionId, userId: parentId })) }),
    ]);
    return { ok: true };
  }
}

@RequiresModule('messaging')
@RequiresFeature('messaging', 'polls')
@Roles(Role.SCHOOL_ADMIN, Role.SOCIAL_WORKER, Role.TEACHER)
@Controller('polls')
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string) {
    return this.polls.list(user, schoolId);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post()
  create(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Body() dto: CreatePollDto) {
    return this.polls.create(user, schoolId, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.polls.detail(user, schoolId, id);
  }

  @Roles(Role.SCHOOL_ADMIN, Role.TEACHER)
  @Post(':id/close')
  close(@CurrentUser() user: AuthUser, @SchoolId() schoolId: string, @Param('id') id: string) {
    return this.polls.close(user, schoolId, id);
  }
}

@RequiresModule('messaging')
@RequiresFeature('messaging', 'polls')
@Roles(Role.PARENT)
@Controller('parent/polls')
export class ParentPollsController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.polls.listForParent(user.id);
  }

  @Post(':id/vote')
  vote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VoteDto) {
    return this.polls.vote(user.id, id, dto);
  }
}
