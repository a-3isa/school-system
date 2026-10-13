import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const WINDOW_MS = 15 * 60_000;
/** Wrong passwords allowed per account from one address in a window. */
export const MAX_PER_ADDRESS = 10;
/** Wrong passwords allowed per account from anywhere in a window (many addresses guessing together). */
export const MAX_PER_ACCOUNT = 50;

/**
 * Slows password guessing. Counts wrong passwords per account+address and per
 * account, in the database so that every server counts the same tries.
 * Locking an account on a few failures would let anyone lock a parent out, so
 * the per-account limit is much higher than the per-address one.
 */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  private recent(key: string, now: number) {
    return { key, at: { gt: new Date(now - WINDOW_MS) } };
  }

  /** Throws 429 when this account (from this address) has had too many wrong passwords lately. */
  async check(account: string, address: string, now = new Date()) {
    const t = now.getTime();
    const limits = [
      { key: `${address}|${account}`, max: MAX_PER_ADDRESS },
      { key: account, max: MAX_PER_ACCOUNT },
    ];
    let oldest = Infinity;
    for (const { key, max } of limits) {
      const where = this.recent(key, t);
      if ((await this.prisma.loginFailure.count({ where })) >= max) {
        const first = await this.prisma.loginFailure.findFirst({ where, orderBy: { at: 'asc' } });
        oldest = Math.min(oldest, first?.at.getTime() ?? t);
      }
    }
    if (oldest !== Infinity) {
      const minutes = Math.max(1, Math.ceil((oldest + WINDOW_MS - t) / 60_000));
      throw new HttpException(`Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async fail(account: string, address: string, now = new Date()) {
    await this.prisma.loginFailure.createMany({ data: [{ key: `${address}|${account}`, at: now }, { key: account, at: now }] });
    await this.prisma.loginFailure.deleteMany({ where: { at: { lt: new Date(now.getTime() - WINDOW_MS) } } });
  }

  /** A right password clears this address's count, not the account's. */
  async succeed(account: string, address: string) {
    await this.prisma.loginFailure.deleteMany({ where: { key: `${address}|${account}` } });
  }
}
