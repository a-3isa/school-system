import { bandOf, bandsFor, checkBands, DEFAULT_BANDS, familyOf, gpaOf, mean, overall, subjectPercent } from './grades';

const item = (score: number | null, max: number, weight = 1, over: Partial<{ absent: boolean; excused: boolean }> = {}) => ({ score, max, weight, absent: false, excused: false, ...over });

describe('subjectPercent', () => {
  it('weights each assessment: weight × score ÷ max over the sum of weights', () => {
    // 18/20 at weight 1 and 60/100 at weight 3: (0.9 + 1.8) / 4 = 67.5%
    expect(subjectPercent([item(18, 20, 1), item(60, 100, 3)])).toBeCloseTo(67.5, 10);
  });

  it('leaves out an excused absence', () => {
    expect(subjectPercent([item(10, 10, 1), item(null, 10, 3, { absent: true, excused: true })])).toBeCloseTo(100, 10);
  });

  it('counts an absence without an excuse as zero', () => {
    expect(subjectPercent([item(10, 10, 1), item(null, 10, 1, { absent: true })])).toBeCloseTo(50, 10);
  });

  it('leaves out an assessment that has no mark yet', () => {
    expect(subjectPercent([item(5, 10, 1), item(null, 10, 3)])).toBeCloseTo(50, 10);
  });

  it('is null when nothing counts', () => {
    expect(subjectPercent([])).toBeNull();
    expect(subjectPercent([item(null, 10), item(null, 10, 2, { absent: true, excused: true })])).toBeNull();
  });
});

describe('overall', () => {
  it('is the plain average of the subjects that have a percentage, to one decimal', () => {
    expect(overall([80, 70, null, 91])).toBe(80.3);
    expect(mean([80, 70, null, 91])).toBeCloseTo(80.3333, 3);
  });

  it('is null with no subject', () => {
    expect(overall([null, null])).toBeNull();
    expect(overall([])).toBeNull();
  });
});

describe('bands', () => {
  const national = DEFAULT_BANDS.NATIONAL;

  it('look up the highest band the percentage reaches, using the unrounded value', () => {
    expect(bandOf(84.99, national).label).toBe('Very good');
    expect(bandOf(85, national).label).toBe('Excellent');
    expect(bandOf(0, national).labelAr).toBe('دون المستوى');
    expect(bandOf(100, national).labelAr).toBe('ممتاز');
  });

  it('take the lowest band for a percentage below every band', () => {
    expect(bandOf(-1, national).label).toBe('Below pass');
  });

  it('give each system its scale: national for the Egyptian and other systems, British, American', () => {
    expect(familyOf('NATIONAL_ARABIC')).toBe('NATIONAL');
    expect(familyOf('IB')).toBe('NATIONAL');
    expect(familyOf(null)).toBe('NATIONAL');
    expect(bandOf(95, bandsFor('BRITISH', {})).label).toBe('A*');
    expect(bandOf(89.9, bandsFor('BRITISH', {})).label).toBe('A');
    expect(bandOf(10, bandsFor('BRITISH', {})).label).toBe('U');
  });

  it('use the school’s own bands in place of a system’s defaults', () => {
    const own = [{ min: 50, label: 'Pass', labelAr: 'ناجح' }, { min: 0, label: 'Fail', labelAr: 'راسب' }];
    expect(bandOf(70, bandsFor('BRITISH', { BRITISH: own })).label).toBe('Pass');
    expect(bandOf(70, bandsFor('AMERICAN', { BRITISH: own })).label).toBe('C−'); // another system is untouched
  });

  it('carry the American GPA, and average it', () => {
    const us = bandsFor('AMERICAN', {});
    expect(bandOf(93, us)).toMatchObject({ label: 'A', gpa: 4 });
    expect(bandOf(88, us)).toMatchObject({ label: 'B+', gpa: 3.3 });
    expect(gpaOf([bandOf(95, us), bandOf(88, us), null])).toBe(3.65);
    expect(gpaOf([bandOf(95, bandsFor('BRITISH', {}))])).toBeNull();
  });
});

describe('checkBands', () => {
  const ok = [{ min: 0, label: 'Fail', labelAr: 'راسب' }, { min: 50, label: 'Pass', labelAr: 'ناجح' }];

  it('accepts a scale and sorts it from the top', () => {
    const r = checkBands(ok);
    expect(r.ok && r.bands.map((b) => b.min)).toEqual([50, 0]);
  });

  it('refuses a scale that does not reach 0, repeats a step or has an empty name', () => {
    expect(checkBands([{ min: 10, label: 'A', labelAr: 'أ' }, { min: 50, label: 'B', labelAr: 'ب' }])).toEqual({ ok: false, message: 'The lowest grade must start at 0%.' });
    expect(checkBands([...ok, { min: 50, label: 'Dup', labelAr: 'م' }])).toEqual({ ok: false, message: 'Each grade must start at a different percentage.' });
    expect(checkBands([{ min: 0, label: ' ', labelAr: 'ب' }, { min: 50, label: 'B', labelAr: 'ب' }])).toEqual({ ok: false, message: 'Each grade needs a name in English and in Arabic.' });
    expect(checkBands([{ min: 0, label: 'A', labelAr: 'أ' }])).toEqual({ ok: false, message: 'A scale needs between 2 and 20 grades.' });
  });
});
