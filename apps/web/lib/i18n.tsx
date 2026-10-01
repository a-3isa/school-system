'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ar, en, Dict } from './strings';

export type Lang = 'en' | 'ar';
const LANG_KEY = 'sp-lang';
const DICTS: Record<Lang, Dict> = { en, ar };

/**
 * In Arabic, keeps Latin runs (class codes, times, ranges, emails) in their own
 * left-to-right island, so "4-A" never shows as "A-4" and "09:50–10:35" never
 * runs backwards. Numbers and times stay Latin, as the brief asks.
 */
const ARABIC = /[؀-ۿ]/;
const LATIN_RUN = /\+?[A-Za-z0-9@][A-Za-z0-9@:\-–%.\/_+ ]*[A-Za-z0-9%]|[A-Za-z0-9]/g;
const LATIN_ONLY_RANGE = /^[A-Za-z0-9:. ]*\d[A-Za-z0-9:. ]*[-–][A-Za-z0-9:. ]+$/;
export function isolateLatin(s: string): string {
  if (ARABIC.test(s)) return s.replace(LATIN_RUN, (m) => `⁦${m}⁩`);
  return LATIN_ONLY_RANGE.test(s) ? `⁦${s}⁩` : s;
}

interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  t: Dict;
  setLang: (l: Lang) => void;
  /** Use on any composed text that mixes Latin codes or times with words. */
  x: (s: string) => string;
  /** Date-only "YYYY-MM-DD" as words, e.g. "Thursday 1 October" / "الخميس 1 أكتوبر". */
  day: (date: string, opts?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANG_KEY);
      if (stored === 'ar' || stored === 'en') setLangState(stored);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const locale = lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
    return {
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      t: DICTS[lang],
      setLang,
      x: lang === 'ar' ? isolateLatin : (s: string) => s,
      day: (date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
        new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n outside LangProvider');
  return v;
}

/** A Latin value (code, time, email) shown on its own inside right-to-left text. */
export function L({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

export function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang" role="group" aria-label="Language">
      <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
        English
      </button>
      <button type="button" lang="ar" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')}>
        عربي
      </button>
    </div>
  );
}
