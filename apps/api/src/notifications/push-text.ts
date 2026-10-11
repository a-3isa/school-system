import { Gender } from '@prisma/client';

export type Lang = 'en' | 'ar';

export interface TextContext {
  lang: Lang;
  /** The child's first name, when the notification is about a child. */
  name?: string | null;
  gender?: Gender | null;
  data: Record<string, unknown>;
}

// The words of a push notification, in the language the parent's app is in.
// They say the same as the app's own list (apps/parent/lib/strings.dart,
// S.notification): keep the two in step when a type is added or reworded.
// Arabic agrees with the child's gender: «وصل أحمد / وصلت ليلى».

const HONORIFICS: [RegExp, string][] = [
  [/^Mr\.\s+/, 'مستر '],
  [/^Ms\.\s+/, 'مس '],
  [/^Mrs\.\s+/, 'مدام '],
  [/^Dr\.\s+/, 'د. '],
];

/** "Ms. Hana Nabil" as a parent reads it in Arabic: «مس Hana Nabil». */
export const arabicTitled = (name: string) => HONORIFICS.reduce((n, [re, ar]) => n.replace(re, ar), name);

/** Keeps a Latin value (a time) in its own left-to-right island inside Arabic text. */
const ltr = (s: string) => String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** "Sunday 4 October" / «الأحد 4 أكتوبر» from "2026-10-04". */
export function dayLine(date: string, lang: Lang): string {
  const parts = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).formatToParts(new Date(`${date}T00:00:00Z`));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

/**
 * The sentence for a notification, or null when this type has no wording here
 * (the caller then sends the English text the server saved).
 */
export function pushBody(type: string, c: TextContext): string | null {
  const ar = c.lang === 'ar';
  const name = c.name ?? '';
  const d = c.data;
  const g = (boy: string, girl: string, neutral: string) => (c.gender === 'MALE' ? boy : c.gender === 'FEMALE' ? girl : neutral);
  const about = ['attendance.arrived', 'attendance.absentCheck', 'attendance.absent', 'attendance.left', 'attendance.lessonAbsent', 'attendance.lessonPresent', 'excuse.approved', 'excuse.rejected', 'message.new', 'behaviour.note'];
  if (about.includes(type) && !name) return null;

  switch (type) {
    case 'attendance.arrived':
      return ar ? g(`وصل ${name} المدرسة بالسلامة`, `وصلت ${name} المدرسة بالسلامة`, `وصول ${name} إلى المدرسة بالسلامة`) : `${name} arrived safely at school`;
    case 'attendance.absentCheck':
      return ar
        ? g(`لم يحضر ${name} إلى المدرسة اليوم. هل تعلمون السبب؟`, `لم تحضر ${name} إلى المدرسة اليوم. هل تعلمون السبب؟`, `لم يُسجَّل حضور ${name} اليوم. هل تعلمون السبب؟`)
        : `${name} didn’t come to school today. Do you know why?`;
    case 'attendance.absent':
      return ar ? g(`${name} غائب اليوم`, `${name} غائبة اليوم`, `سُجِّل غياب ${name} اليوم`) : `${name} is absent today`;
    case 'attendance.left':
      return ar ? g(`غادر ${name} المدرسة مبكرًا`, `غادرت ${name} المدرسة مبكرًا`, `انصراف ${name} من المدرسة مبكرًا`) : `${name} left school early`;
    case 'attendance.lessonAbsent': {
      const [subject, room] = [str(d.subject), str(d.room)];
      if (!subject || !room) return null;
      return ar
        ? `${g(`غاب ${name} عن`, `غابت ${name} عن`, `غياب ${name} عن`)} حصة ${subject} في ${room}. وتتابع شؤون الطلبة الأمر.`
        : `${name} missed ${subject} in ${room}. Student Affairs is following up.`;
    }
    case 'attendance.lessonPresent': {
      const [subject, room] = [str(d.subject), str(d.room)];
      if (!subject || !room) return null;
      return ar ? `${g(`عاد ${name} إلى`, `عادت ${name} إلى`, `عودة ${name} إلى`)} حصة ${subject} ب${room}` : `${name} is back in ${subject}, ${room}`;
    }
    case 'excuse.approved':
      return ar ? `قبلت المدرسة عذر ${name}` : `The school accepted ${name}’s excuse`;
    case 'excuse.rejected':
      return ar ? `لم تقبل المدرسة عذر ${name}` : `The school did not accept ${name}’s excuse`;
    case 'behaviour.note':
      return ar
        ? d.kind === 'PRAISE' ? `أحسنت! ثناء من المدرسة على ${name}` : d.kind === 'INCIDENT' ? `تواصلت شؤون الطلبة معكم بشأن ${name}` : `ملاحظة من المدرسة بشأن ${name}`
        : d.kind === 'PRAISE' ? `Well done! A note of praise for ${name}` : d.kind === 'INCIDENT' ? `Student Affairs has written to you about ${name}` : `A note from school about ${name}`;
    case 'announcement.new':
      return str(d.title) ? (ar ? `جديد من المدرسة: ${str(d.title)}` : `New from the school: ${str(d.title)}`) : null;
    case 'announcement.emergency':
      return str(d.title) ? (ar ? `عاجل من المدرسة: ${str(d.title)}` : `Urgent from the school: ${str(d.title)}`) : null;
    case 'poll.new':
      return str(d.question) ? (ar ? `تودّ المدرسة معرفة رأيكم: ${str(d.question)}` : `The school asks your opinion: ${str(d.question)}`) : null;
    case 'message.new': {
      const from = str(d.from);
      if (!from) return null;
      return ar ? `رسالة جديدة من ${arabicTitled(from)} بشأن ${name}` : `New message from ${from} about ${name}`;
    }
    case 'meeting.cancelled': {
      const [teacher, date, time] = [str(d.teacher), str(d.date), str(d.time)];
      if (!teacher || !date || !time) return null;
      return ar
        ? `أُلغي موعد مقابلتكم مع ${arabicTitled(teacher)} يوم ${dayLine(date, 'ar')} الساعة ${ltr(time)}`
        : `Your meeting with ${teacher} on ${dayLine(date, 'en')} at ${time} was cancelled`;
    }
    default:
      return null;
  }
}
