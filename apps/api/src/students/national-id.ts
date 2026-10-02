/**
 * The 14-digit Egyptian national number: C YY MM DD GG SSSS X.
 * C is the century (2 = 1900s, 3 = 2000s), then the birth date, the
 * governorate of birth (88 = born abroad), a serial whose last digit is odd
 * for a boy and even for a girl, and a check digit.
 */
export const GOVERNORATES: Record<string, string> = {
  '01': 'Cairo', '02': 'Alexandria', '03': 'Port Said', '04': 'Suez',
  '11': 'Damietta', '12': 'Dakahlia', '13': 'Sharqia', '14': 'Qalyubia', '15': 'Kafr El Sheikh', '16': 'Gharbia', '17': 'Monufia', '18': 'Beheira', '19': 'Ismailia',
  '21': 'Giza', '22': 'Beni Suef', '23': 'Faiyum', '24': 'Minya', '25': 'Asyut', '26': 'Sohag', '27': 'Qena', '28': 'Aswan', '29': 'Luxor',
  '31': 'Red Sea', '32': 'New Valley', '33': 'Matrouh', '34': 'North Sinai', '35': 'South Sinai',
  '88': 'Born abroad',
};

export interface NationalId {
  dateOfBirth: string; // YYYY-MM-DD
  governorate: string;
  gender: 'MALE' | 'FEMALE';
}

/** Reads a national number, or returns null when it can't be one. */
export function parseNationalId(raw: string): NationalId | null {
  const id = raw.trim();
  if (!/^[23]\d{13}$/.test(id)) return null;
  const year = (id[0] === '2' ? 1900 : 2000) + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const governorate = GOVERNORATES[id.slice(7, 9)];
  if (!governorate) return null;
  return { dateOfBirth: date.toISOString().slice(0, 10), governorate, gender: Number(id[12]) % 2 === 1 ? 'MALE' : 'FEMALE' };
}
