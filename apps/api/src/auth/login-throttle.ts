import { HttpException, HttpStatus } from '@nestjs/common';

const WINDOW_MS = 15 * 60_000;
/** Wrong passwords allowed per account from one address in a window. */
export const MAX_PER_ADDRESS = 10;
/** Wrong passwords allowed per account from anywhere in a window (many addresses guessing together). */
export const MAX_PER_ACCOUNT = 50;

/**
 * Slows password guessing. Counts wrong passwords per account+address and per
 * account, in memory (a restart clears it, and each server counts for itself).
 * Locking an account on a few failures would let anyone lock a parent out, so
 * the per-account limit is much higher than the per-address one.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  private recent(key: string, now: number) {
    const live = (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (live.length) this.failures.set(key, live);
    else this.failures.delete(key);
    return live;
  }

  /** Throws 429 when this account (from this address) has had too many wrong passwords lately. */
  check(account: string, address: string, now = Date.now()) {
    const byAddress = this.recent(`${address}|${account}`, now);
    const byAccount = this.recent(account, now);
    if (byAddress.length >= MAX_PER_ADDRESS || byAccount.length >= MAX_PER_ACCOUNT) {
      const oldest = Math.min(byAddress.length >= MAX_PER_ADDRESS ? byAddress[0] : Infinity, byAccount.length >= MAX_PER_ACCOUNT ? byAccount[0] : Infinity);
      const minutes = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 60_000));
      throw new HttpException(`Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  fail(account: string, address: string, now = Date.now()) {
    for (const key of [`${address}|${account}`, account]) this.failures.set(key, [...this.recent(key, now), now]);
  }

  /** A right password clears this address's count, not the account's. */
  succeed(account: string, address: string) {
    this.failures.delete(`${address}|${account}`);
  }
}
