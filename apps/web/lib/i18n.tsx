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
const LATIN = /[A-Za-z0-9]/;
export function isolateLatin(s: string): string {
  if (ARABIC.test(s)) return s.replace(LATIN_RUN, (m) => `\u2066${m}\u2069`);
  // All Latin (a class, subject and room from the school, a time range): one island.
  return LATIN.test(s) ? `\u2066${s}\u2069` : s;
}

/**
 * Exceptions and school messages are written by the server in English. In
 * Arabic, the known sentences are said again in Arabic; anything else is shown
 * as it came.
 */
const SERVER_AR: [RegExp, (...m: string[]) => string][] = [
  [/^(.+) came in at (\d\d:\d\d) but hasn’t been in (\S+) (.+) in (.+) \(period (\d+)\)\.$/, (_, n, at, c, sub, room, p) => `${n}: وصول إلى المدرسة الساعة ${at}، دون حضور حصة ${sub} لفصل ${c} في ${room} (الحصة ${p}).`],
  [/^(.+) was in (\S+) (.+) \(period (\d+)\) for only (\d+)% of the lesson\.$/, (_, n, c, sub, p, pct) => `${n}: حضور ${pct}% فقط من حصة ${sub} لفصل ${c} (الحصة ${p}).`],
  [/^(.+) arrived at (\d\d:\d\d) but wasn’t in (\S+) (.+) \(period (\d+)\)\.$/, (_, n, at, c, sub, p) => `${n}: وصول الساعة ${at}، دون حضور حصة ${sub} لفصل ${c} (الحصة ${p}).`],
  [/^(.+) went out through the gate at (\d\d:\d\d) before the end of the school day\.$/, (_, n, at) => `${n}: انصراف من البوابة الساعة ${at} قبل انتهاء اليوم الدراسي.`],
  [/^Gateway “(.+)” in (.+) isn’t reporting\. Lessons there switch to manual marking\.$/, (_, g, room) => `جهاز القراءة «${g}» في ${room} غير متصل، ويُسجَّل الحضور هناك يدويًا.`],
  [/^Gateway “(.+)” isn’t reporting\. Lessons there switch to manual marking\.$/, (_, g) => `جهاز القراءة «${g}» غير متصل، ويُسجَّل الحضور هناك يدويًا.`],
  [/^(.+)’s strap battery is at (\d+)%\. Replace the battery soon\.$/, (_, n, b) => `بطارية السوار الذكي لـ ${n} عند ${b}%. يُرجى استبدالها قريبًا.`],
  [/^(.+) updated their mobile number$/, (_, n) => `${n}: تحديث رقم الهاتف`],
  [/^(.+) verified a new mobile number, (\+\d+), (when signing up in the app|in the app)\. It replaces (\+\d+)\.$/, (_, n, ph, how, old) => `${n}: تأكيد رقم هاتف جديد ${ph} ${how === 'in the app' ? 'من التطبيق' : 'عند التسجيل في التطبيق'}، بدلًا من ${old}.`],
  [/^(.+) verified their mobile number, (\+\d+), (when signing up in the app|in the app)\.$/, (_, n, ph, how) => `${n}: تأكيد رقم الهاتف ${ph} ${how === 'in the app' ? 'من التطبيق' : 'عند التسجيل في التطبيق'}.`],
  [/^This isn’t part of this school’s subscription\.$/, () => 'هذه الخدمة ليست ضمن اشتراك المدرسة.'],
  [/^This comes with the subscription\. Ask the platform owner\.$/, () => 'هذه الخدمة جزء من الاشتراك. يُرجى التواصل مع مالك المنصة.'],
  [/^(.+) isn’t switched on for this school\.$/, (_, m) => `خدمة «${m}» غير مفعّلة لهذه المدرسة.`],
  [/^Choose at least one year group or class\.$/, () => 'يُرجى اختيار صف دراسي أو فصل واحد على الأقل.'],
  [/^Year group or class not found\.$/, () => 'لم يتم العثور على الصف الدراسي أو الفصل.'],
  // Messaging
  ...(
    [
      ['Announcement not found.', 'لم يتم العثور على الإعلان.'],
      ['Only the author or Student Affairs can change this announcement.', 'يمكن للكاتب أو لشؤون الطلبة فقط تعديل هذا الإعلان.'],
      ['This announcement has already been sent.', 'تم إرسال هذا الإعلان بالفعل.'],
      ['Teachers can write to their own classes only.', 'يمكن للمعلمين الكتابة إلى فصولهم فقط.'],
      ['Attach a photo (JPG, PNG or WebP) or a PDF.', 'يُرجى إرفاق صورة (JPG أو PNG أو WebP) أو ملف PDF.'],
      ['Only drafts can be deleted.', 'لا يمكن حذف إلا المسودات.'],
      ['There are no parents to send this to yet.', 'لا يوجد أولياء أمور لإرسال هذه الرسالة إليهم بعد.'],
      ['No attachment.', 'لا يوجد مرفق.'],
      ['Poll not found.', 'لم يتم العثور على الاستطلاع.'],
      ['Every answer needs some text.', 'يجب أن تحتوي كل إجابة على نص.'],
      ['Each answer must be different.', 'يجب أن تختلف الإجابات عن بعضها.'],
      ['The closing time must be in the future.', 'يجب أن يكون موعد الإغلاق في المستقبل.'],
      ['Conversation not found.', 'لم يتم العثور على المحادثة.'],
      ['Only the teacher in this conversation can reply.', 'يمكن لمعلم هذه المحادثة وحده الرد عليها.'],
      ['This conversation is closed.', 'هذه المحادثة مغلقة.'],
      ['Write a message first.', 'اكتبوا رسالة أولًا.'],
      ['Only Student Affairs can see every conversation.', 'شؤون الطلبة وحدها يمكنها الاطلاع على كل المحادثات.'],
      ['Choose the teacher.', 'اختاروا المعلم.'],
      ['You can add meeting times for yourself only.', 'يمكنكم إضافة مواعيد المقابلات لأنفسكم فقط.'],
      ['Teacher not found.', 'لم يتم العثور على المعلم.'],
      ['The end time must be after the start time.', 'يجب أن يكون وقت الانتهاء بعد وقت البدء.'],
      ['This time is too short for one meeting.', 'هذه الفترة أقصر من أن تتسع لمقابلة واحدة.'],
      ['Choose a day that hasn’t passed.', 'اختاروا يومًا لم يمضِ بعد.'],
      ['The school is closed that day.', 'المدرسة مغلقة في هذا اليوم.'],
      ['This overlaps another meeting time on the same day.', 'تتداخل هذه الفترة مع فترة مقابلات أخرى في اليوم نفسه.'],
      ['Meeting time not found.', 'لم يتم العثور على موعد المقابلة.'],
      ['This time isn’t booked.', 'هذا الموعد غير محجوز.'],
      ['Office hours must end after they start.', 'يجب أن تنتهي ساعات الاستقبال بعد بدايتها.'],
      // Behaviour
      ['You can write notes only for students you teach.', 'يمكنكم كتابة ملاحظات عن الطلاب الذين تدرّسونهم فقط.'],
      ['Incidents are recorded by Student Affairs.', 'تسجّل شؤون الطلبة الوقائع.'],
      ['Merit points are switched off for this school.', 'نقاط التميز غير مفعّلة في هذه المدرسة.'],
      ['Choose a category that fits this kind of note.', 'اختاروا تصنيفًا يناسب نوع الملاحظة.'],
      ['Choose how serious the incident is.', 'اختاروا درجة جسامة الواقعة.'],
      ['Only incidents have a severity, an action taken and a place.', 'الجسامة والإجراء المتخذ والمكان خاصة بالوقائع فقط.'],
      ['A note can’t be dated in the future.', 'لا يمكن تأريخ الملاحظة بتاريخ مستقبلي.'],
      ['Note not found.', 'لم يتم العثور على الملاحظة.'],
      ['Only the author or Student Affairs can change this note.', 'يمكن لكاتب الملاحظة أو لشؤون الطلبة فقط تعديلها.'],
      ['You can see only the classes you teach.', 'يمكنكم الاطلاع على الفصول التي تدرّسونها فقط.'],
    ] as [string, string][]
  ).map(([en, ar]): [RegExp, () => string] => [new RegExp(`^${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), () => ar]),
  [/^Points for (praise|concern|incident) notes must be between (-?\d+) and (-?\d+)\.$/, (_, _k, a, b) => `يجب أن تكون النقاط بين ${a} و${b}.`],
  [/^A note can be dated up to (\d+) days back\.$/, (_, n) => `يمكن تأريخ الملاحظة حتى ${n} يومًا إلى الوراء.`],
  [/^You can change your own notes for (\d+) hours\. After that, please ask Student Affairs\.$/, (_, n) => `يمكنكم تعديل ملاحظاتكم خلال ${n} ساعة، وبعد ذلك يُرجى الرجوع إلى شؤون الطلبة.`],
];
export function serverTextAr(s: string): string {
  for (const [re, f] of SERVER_AR) {
    const m = s.match(re);
    if (m) return f(...m);
  }
  return s;
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
  /** A member of staff as they are addressed: "Ms. Hana Nabil" / «مس Hana Nabil». */
  staff: (u: { name: string; honorific?: string | null } | null | undefined) => string;
}

/** How staff are addressed, in each language. */
export const HONORIFICS = { en: { MR: 'Mr.', MS: 'Ms.', MRS: 'Mrs.', DR: 'Dr.' }, ar: { MR: 'مستر', MS: 'مس', MRS: 'مدام', DR: 'د.' } } as const;

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
      x: lang === 'ar' ? (s: string) => isolateLatin(serverTextAr(s)) : (s: string) => s,
      staff: (u) => {
        if (!u) return '';
        const title = u.honorific ? HONORIFICS[lang][u.honorific as keyof (typeof HONORIFICS)['en']] : undefined;
        return title ? `${title} ${u.name}` : u.name;
      },
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
