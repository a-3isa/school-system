import { Logger } from '@nestjs/common';
import { AttendanceJobs } from './attendance';

/** The six steps of the minute job, recorded in the order they run. */
function make(fail?: string) {
  const ran: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const step = (name: string, wait = false) => async () => {
    ran.push(name);
    if (wait) await gate;
    if (name === fail) throw new Error(`${name} broke`);
  };
  const jobs = new AttendanceJobs(
    { sendAbsenceNotices: step('absence') } as never,
    { flush: step('flush') } as never,
    { tick: step('evaluator', fail === 'wait') } as never,
    { applyApproved: step('approved'), checkAlerts: step('alerts') } as never,
    { remind: step('trips') } as never,
  );
  return { jobs, ran, release };
}

describe('AttendanceJobs', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterAll(() => jest.restoreAllMocks());

  it('runs every step in order', async () => {
    const { jobs, ran } = make();
    await jobs.tick();
    expect(ran).toEqual(['evaluator', 'absence', 'approved', 'alerts', 'trips', 'flush']);
  });

  it('runs the later steps when an earlier one fails', async () => {
    const { jobs, ran } = make('absence');
    await jobs.tick();
    expect(ran).toEqual(['evaluator', 'absence', 'approved', 'alerts', 'trips', 'flush']);
  });

  it('does not start a minute while the previous one is still running', async () => {
    const { jobs, ran, release } = make('wait');
    const first = jobs.tick();
    await jobs.tick(); // the next minute arrives while the evaluator is still busy
    expect(ran).toEqual(['evaluator']);
    release();
    await first;
    expect(ran).toEqual(['evaluator', 'absence', 'approved', 'alerts', 'trips', 'flush']);
    await jobs.tick();
    expect(ran.filter((s) => s === 'evaluator')).toHaveLength(2);
  });
});
