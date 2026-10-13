import { describe, expect, it } from 'vitest';
import { isolateLatin, serverTextAr } from './i18n';

const LRI = '⁦';
const PDI = '⁩';

describe('isolateLatin', () => {
  it('keeps a class code from running backwards inside Arabic text', () => {
    expect(isolateLatin('الفصل 4-A')).toBe(`الفصل ${LRI}4-A${PDI}`);
  });

  it('keeps a time range in one piece', () => {
    expect(isolateLatin('من 09:50–10:35 يوميًا')).toBe(`من ${LRI}09:50–10:35${PDI} يوميًا`);
  });

  it('keeps an email or a phone number in one piece', () => {
    expect(isolateLatin('البريد dina@example.com')).toBe(`البريد ${LRI}dina@example.com${PDI}`);
    expect(isolateLatin('الهاتف +201005550192')).toBe(`الهاتف ${LRI}+201005550192${PDI}`);
  });

  it('puts text with no Arabic in it in a single island, and leaves text with no Latin alone', () => {
    expect(isolateLatin('4-A · Math · Room 204')).toBe(`${LRI}4-A · Math · Room 204${PDI}`);
    expect(isolateLatin('الحضور')).toBe('الحضور');
    expect(isolateLatin('')).toBe('');
  });
});

describe('serverTextAr', () => {
  it('says a sentence from the server again in Arabic', () => {
    expect(serverTextAr('Salma came in at 07:42 but hasn’t been in 4-A Math in Room 204 (period 2).')).toBe('Salma: وصول إلى المدرسة الساعة 07:42، دون حضور حصة Math لفصل 4-A في Room 204 (الحصة 2).');
  });

  it('shows anything it does not know as it came', () => {
    expect(serverTextAr('A sentence nobody translated.')).toBe('A sentence nobody translated.');
  });
});
