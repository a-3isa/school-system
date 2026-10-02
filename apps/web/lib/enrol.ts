// Helpers for the student form: the Egyptian national number, countries, codes and age.

const GOVERNORATES: Record<string, [string, string]> = {
  '01': ['Cairo', 'القاهرة'], '02': ['Alexandria', 'الإسكندرية'], '03': ['Port Said', 'بورسعيد'], '04': ['Suez', 'السويس'],
  '11': ['Damietta', 'دمياط'], '12': ['Dakahlia', 'الدقهلية'], '13': ['Sharqia', 'الشرقية'], '14': ['Qalyubia', 'القليوبية'], '15': ['Kafr El Sheikh', 'كفر الشيخ'],
  '16': ['Gharbia', 'الغربية'], '17': ['Monufia', 'المنوفية'], '18': ['Beheira', 'البحيرة'], '19': ['Ismailia', 'الإسماعيلية'],
  '21': ['Giza', 'الجيزة'], '22': ['Beni Suef', 'بني سويف'], '23': ['Faiyum', 'الفيوم'], '24': ['Minya', 'المنيا'], '25': ['Asyut', 'أسيوط'],
  '26': ['Sohag', 'سوهاج'], '27': ['Qena', 'قنا'], '28': ['Aswan', 'أسوان'], '29': ['Luxor', 'الأقصر'],
  '31': ['Red Sea', 'البحر الأحمر'], '32': ['New Valley', 'الوادي الجديد'], '33': ['Matrouh', 'مطروح'], '34': ['North Sinai', 'شمال سيناء'], '35': ['South Sinai', 'جنوب سيناء'],
  '88': ['abroad', 'الخارج'],
};

/** Reads a 14-digit Egyptian national number (same rules as the API), or null. */
export function parseNationalId(raw: string, lang: 'en' | 'ar' = 'en') {
  const id = raw.trim();
  if (!/^[23]\d{13}$/.test(id)) return null;
  const year = (id[0] === '2' ? 1900 : 2000) + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const gov = GOVERNORATES[id.slice(7, 9)];
  if (!gov) return null;
  return { dateOfBirth: d.toISOString().slice(0, 10), place: gov[lang === 'ar' ? 1 : 0], gender: Number(id[12]) % 2 === 1 ? 'MALE' : 'FEMALE' };
}

// Countries, Egypt and its neighbours first; names come from the browser in the page's language.
const FIRST = ['EG', 'SA', 'AE', 'KW', 'QA', 'JO', 'LB', 'SY', 'PS', 'IQ', 'SD', 'LY', 'YE', 'GB', 'US'];
const ALL = 'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PS PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW'.split(' ');

export function countries(lang: 'en' | 'ar'): [string, string][] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([lang === 'ar' ? 'ar' : 'en'], { type: 'region' });
  } catch {
    /* older browsers: show the codes */
  }
  const name = (c: string) => names?.of(c) ?? c;
  const rest = ALL.filter((c) => !FIRST.includes(c)).map((c): [string, string] => [c, name(c)]).sort((a, b) => a[1].localeCompare(b[1], lang));
  return [...FIRST.map((c): [string, string] => [c, name(c)]), ...rest];
}

/** The next student code after the school's highest one with the most common prefix, e.g. 2026-0024 → 2026-0025. */
export function nextCode(codes: string[]): string {
  const groups = new Map<string, { width: number; max: number; n: number }>();
  for (const c of codes) {
    const m = c.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const g = groups.get(m[1]) ?? { width: m[2].length, max: 0, n: 0 };
    g.max = Math.max(g.max, Number(m[2]));
    g.width = Math.max(g.width, m[2].length);
    g.n++;
    groups.set(m[1], g);
  }
  const best = [...groups.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return best ? `${best[0]}${String(best[1].max + 1).padStart(best[1].width, '0')}` : '';
}

/** Egyptian schools count age on 1 October of the school year. */
export function ageOnFirstOctober(dateOfBirth: string, today = new Date()) {
  const y = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const cut = new Date(Date.UTC(y, 9, 1));
  const b = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(b.getTime()) || b > cut) return null;
  let months = (cut.getUTCFullYear() - b.getUTCFullYear()) * 12 + (cut.getUTCMonth() - b.getUTCMonth());
  if (cut.getUTCDate() < b.getUTCDate()) months--;
  return { on: cut.toISOString().slice(0, 10), years: Math.floor(months / 12), months: months % 12 };
}
