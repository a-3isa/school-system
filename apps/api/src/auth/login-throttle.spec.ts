import { HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginThrottleService, MAX_PER_ACCOUNT, MAX_PER_ADDRESS } from './login-throttle';

type Row = { key: string; at: Date };
type Where = { key?: string; at?: { gt?: Date; lt?: Date } };

/** Just enough of the LoginFailure table to run the throttle without a database. */
function fakePrisma() {
  const rows: Row[] = [];
  const match = (w: Where) => (r: Row) => (w.key === undefined || r.key === w.key) && (!w.at?.gt || r.at > w.at.gt) && (!w.at?.lt || r.at < w.at.lt);
  const loginFailure = {
    count: async ({ where }: { where: Where }) => rows.filter(match(where)).length,
    findFirst: async ({ where }: { where: Where }) => [...rows.filter(match(where))].sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null,
    createMany: async ({ data }: { data: Row[] }) => (rows.push(...data), { count: data.length }),
    deleteMany: async ({ where }: { where: Where }) => {
      const gone = rows.filter(match(where));
      for (const r of gone) rows.splice(rows.indexOf(r), 1);
      return { count: gone.length };
    },
  };
  return { prisma: { loginFailure } as unknown as PrismaService, rows };
}

describe('LoginThrottleService', () => {
  const t0 = new Date('2026-10-01T10:00:00Z').getTime();
  const at = (ms: number) => new Date(t0 + ms);
  const make = () => {
    const f = fakePrisma();
    return { t: new LoginThrottleService(f.prisma), rows: f.rows };
  };

  it('lets a few wrong passwords through, then asks to wait', async () => {
    const { t } = make();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) {
      await t.check('a@x.eg', '1.1.1.1', at(i));
      await t.fail('a@x.eg', '1.1.1.1', at(i));
    }
    await expect(t.check('a@x.eg', '1.1.1.1', at(100))).rejects.toThrow(HttpException);
  });

  it('keeps counting per address, so one guesser cannot lock the parent out from home', async () => {
    const { t } = make();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) await t.fail('a@x.eg', '1.1.1.1', at(i));
    await expect(t.check('a@x.eg', '2.2.2.2', at(100))).resolves.toBeUndefined();
  });

  it('stops guessing spread over many addresses', async () => {
    const { t } = make();
    for (let i = 0; i < MAX_PER_ACCOUNT; i++) await t.fail('a@x.eg', `10.0.0.${i}`, at(i));
    await expect(t.check('a@x.eg', '9.9.9.9', at(100))).rejects.toThrow(/Too many/);
  });

  it('says how long to wait, counted from the oldest wrong password', async () => {
    const { t } = make();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) await t.fail('a@x.eg', '1.1.1.1', at(0));
    await expect(t.check('a@x.eg', '1.1.1.1', at(10 * 60_000))).rejects.toThrow('Try again in 5 minutes.');
    await expect(t.check('a@x.eg', '1.1.1.1', at(14 * 60_000 + 30_000))).rejects.toThrow('Try again in 1 minute.');
  });

  it('forgets after the window, and a right password clears the address', async () => {
    const { t } = make();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) await t.fail('a@x.eg', '1.1.1.1', at(0));
    await expect(t.check('a@x.eg', '1.1.1.1', at(16 * 60_000))).resolves.toBeUndefined();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) await t.fail('b@x.eg', '1.1.1.1', at(0));
    await t.succeed('b@x.eg', '1.1.1.1');
    await expect(t.check('b@x.eg', '1.1.1.1', at(1))).resolves.toBeUndefined();
  });

  it('removes old rows when a new wrong password is recorded', async () => {
    const { t, rows } = make();
    await t.fail('a@x.eg', '1.1.1.1', at(0));
    await t.fail('b@x.eg', '2.2.2.2', at(20 * 60_000));
    expect(rows.map((r) => r.key).sort()).toEqual(['2.2.2.2|b@x.eg', 'b@x.eg']);
  });
});
