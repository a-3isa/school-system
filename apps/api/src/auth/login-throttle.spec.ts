import { HttpException } from '@nestjs/common';
import { LoginThrottle, MAX_PER_ACCOUNT, MAX_PER_ADDRESS } from './login-throttle';

describe('LoginThrottle', () => {
  const t0 = 1_000_000;

  it('lets a few wrong passwords through, then asks to wait', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) {
      t.check('a@x.eg', '1.1.1.1', t0 + i);
      t.fail('a@x.eg', '1.1.1.1', t0 + i);
    }
    expect(() => t.check('a@x.eg', '1.1.1.1', t0 + 100)).toThrow(HttpException);
  });

  it('keeps counting per address, so one guesser cannot lock the parent out from home', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) t.fail('a@x.eg', '1.1.1.1', t0 + i);
    expect(() => t.check('a@x.eg', '2.2.2.2', t0 + 100)).not.toThrow();
  });

  it('stops guessing spread over many addresses', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < MAX_PER_ACCOUNT; i++) t.fail('a@x.eg', `10.0.0.${i}`, t0 + i);
    expect(() => t.check('a@x.eg', '9.9.9.9', t0 + 100)).toThrow(/Too many/);
  });

  it('forgets after the window, and a right password clears the address', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) t.fail('a@x.eg', '1.1.1.1', t0);
    expect(() => t.check('a@x.eg', '1.1.1.1', t0 + 16 * 60_000)).not.toThrow();
    for (let i = 0; i < MAX_PER_ADDRESS; i++) t.fail('b@x.eg', '1.1.1.1', t0);
    t.succeed('b@x.eg', '1.1.1.1');
    expect(() => t.check('b@x.eg', '1.1.1.1', t0 + 1)).not.toThrow();
  });
});
