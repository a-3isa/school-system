import { INestApplication } from '@nestjs/common';
import { ChatGateway } from '../src/messaging/chat.gateway';
import { startApp } from './helpers';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How many ms until `app` knows of another server, or null if it takes longer than `limit`. */
async function msToHearOfAnother(app: INestApplication, limit: number): Promise<number | null> {
  const adapter = app.get(ChatGateway).server.of('/').adapter as unknown as { serverCount(): Promise<number> };
  const started = Date.now();
  while (Date.now() - started < limit) {
    if ((await adapter.serverCount()) >= 2) return Date.now() - started;
    await wait(25);
  }
  return null;
}

// Servers share live chat through the database. A server that has just started has to learn quickly which others
// are running, or for a few seconds it answers "is this person online?" from its own sockets only.
describe('Chat servers finding each other (e2e)', () => {
  let first: INestApplication;

  beforeAll(async () => {
    process.env.CHAT_ADAPTER = 'postgres';
    first = await startApp();
    await first.listen(0);
  });

  afterAll(async () => {
    delete process.env.CHAT_ADAPTER;
    await first.close();
  });

  // Whether a new server hears the others' replies depends on a race at start-up, so one start proves little:
  // start several, one after another, and every one of them has to know within a second and a half.
  it('lets every newly started server hear of the running one within moments', async () => {
    const slow: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const next = await startApp();
      await next.listen(0);
      const took = await msToHearOfAnother(next, 1500);
      if (took === null) slow.push(`start ${i}: more than 1500 ms`);
      await next.close();
      await wait(100);
    }
    expect(slow).toEqual([]);
  }, 60000);
});
