import { parseNationalId } from './national-id';

describe('Egyptian national number', () => {
  it('reads the birth date, governorate and gender', () => {
    // Born 15 March 2017 in Cairo; 13th digit 3 (odd) is a boy.
    expect(parseNationalId('31703150101234')).toEqual({ dateOfBirth: '2017-03-15', governorate: 'Cairo', gender: 'MALE' });
    // Born 1 October 2018 in Giza; 13th digit 2 (even) is a girl.
    expect(parseNationalId(' 31810012101225 ')).toEqual({ dateOfBirth: '2018-10-01', governorate: 'Giza', gender: 'FEMALE' });
    expect(parseNationalId('29912318800011')?.dateOfBirth).toBe('1999-12-31');
  });

  it('refuses what can’t be a national number', () => {
    expect(parseNationalId('3170315010123')).toBeNull(); // 13 digits
    expect(parseNationalId('41703150101234')).toBeNull(); // century 4
    expect(parseNationalId('31702300101234')).toBeNull(); // 30 February
    expect(parseNationalId('31703159901234')).toBeNull(); // no governorate 99
    expect(parseNationalId('3170315010123a')).toBeNull();
  });
});
