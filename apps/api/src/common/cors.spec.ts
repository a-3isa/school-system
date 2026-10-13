import { allowedOrigins } from './cors';

const matches = (rules: (string | RegExp)[], origin: string) => rules.some((r) => (typeof r === 'string' ? r === origin : r.test(origin)));

describe('allowed origins', () => {
  it('allows any local port while developing', () => {
    const rules = allowedOrigins({ NODE_ENV: 'development' });
    expect(matches(rules, 'http://localhost:3001')).toBe(true);
    expect(matches(rules, 'http://127.0.0.1:5173')).toBe(true);
    expect(matches(rules, 'https://evil.example')).toBe(false);
    expect(matches(rules, 'http://localhost.evil.example')).toBe(false);
  });

  it('allows only the listed origins when CORS_ORIGINS is set', () => {
    const rules = allowedOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://school.example, https://app.school.example/' });
    expect(matches(rules, 'https://school.example')).toBe(true);
    expect(matches(rules, 'https://app.school.example')).toBe(true);
    expect(matches(rules, 'http://localhost:3001')).toBe(false);
    expect(matches(rules, 'https://other.example')).toBe(false);
  });

  it('refuses to start in production without a list', () => {
    expect(() => allowedOrigins({ NODE_ENV: 'production' })).toThrow('CORS_ORIGINS');
    expect(() => allowedOrigins({ NODE_ENV: 'production', CORS_ORIGINS: ' , ' })).toThrow('CORS_ORIGINS');
  });
});
