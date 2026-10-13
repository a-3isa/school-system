import { describe, expect, it } from 'vitest';
import { formatTime } from './TimeInput';

describe('formatTime', () => {
  it('turns every way of typing a time into HH:mm', () => {
    expect(formatTime('0830')).toBe('08:30');
    expect(formatTime('830')).toBe('08:30');
    expect(formatTime('8:30')).toBe('08:30');
    expect(formatTime('08:30')).toBe('08:30');
    expect(formatTime('1234')).toBe('12:34');
    expect(formatTime('2359')).toBe('23:59');
  });

  it('is kind while the time is half typed', () => {
    expect(formatTime('')).toBe('');
    expect(formatTime('1')).toBe('1');
    expect(formatTime('12')).toBe('12');
    expect(formatTime('123')).toBe('12:3');
    expect(formatTime('8')).toBe('08'); // an hour can't start with 8
    expect(formatTime('8:3')).toBe('08:3');
  });

  it('drops anything that is not a digit, and anything past four digits', () => {
    expect(formatTime('ab12cd')).toBe('12');
    expect(formatTime('12:345')).toBe('12:34');
    expect(formatTime('٠٨٣٠')).toBe(''); // Arabic-Indic digits are not accepted: times are Latin
  });
});
