import { describe, expect, it } from 'vitest';
import { isolateLatin, serverTextAr } from './i18n';
import { fillings, serverMessages } from './serverMessages';

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

describe('serverTextAr, sentences with a number or a name in them', () => {
  it('counts minutes the Arabic way', () => {
    expect(serverTextAr('Too many wrong passwords. Try again in 1 minute.')).toBe('تجاوزتم عدد المحاولات المسموح به. يُرجى المحاولة بعد دقيقة واحدة.');
    expect(serverTextAr('Too many wrong passwords. Try again in 2 minutes.')).toBe('تجاوزتم عدد المحاولات المسموح به. يُرجى المحاولة بعد دقيقتين.');
    expect(serverTextAr('Too many wrong passwords. Try again in 14 minutes.')).toBe('تجاوزتم عدد المحاولات المسموح به. يُرجى المحاولة بعد 14 دقيقة.');
  });

  it('counts days the Arabic way', () => {
    expect(serverTextAr('An excuse can be sent up to 7 days after the absence. For an older one, please contact the school.')).toBe('يمكن إرسال العذر خلال 7 أيام من الغياب. وللأعذار الأقدم، يُرجى التواصل مع المدرسة.');
    expect(serverTextAr('One excuse can cover at most 14 days.')).toBe('لا يغطي العذر الواحد أكثر من 14 يومًا.');
  });

  it('keeps the numbers, times and names it was given', () => {
    expect(serverTextAr('Overlaps period 2 (09:00–09:45).')).toBe('تتداخل مع الحصة 2 (من 09:00 إلى 09:45).');
    expect(serverTextAr('Student code S-104 is already used.')).toBe('كود الطالب S-104 مستخدم بالفعل.');
    expect(serverTextAr('Check the date of birth: the student would be 31 years old.')).toBe('يُرجى مراجعة تاريخ الميلاد؛ فعمر الطالب وفقه 31 سنة.');
  });

  it('names what is missing, in the words of the fixed vocabulary', () => {
    expect(serverTextAr('Add the student’s photo and birth certificate.')).toBe('يُرجى إضافة صورة الطالب وشهادة الميلاد.');
    expect(serverTextAr('Add the birth certificate.')).toBe('يُرجى إضافة شهادة الميلاد.');
    expect(serverTextAr('This student already has a mother.')).toBe('تم تسجيل أم لهذا الطالب بالفعل.');
    expect(serverTextAr('Teacher not found in this school.')).toBe('لم يتم العثور على المعلم في هذه المدرسة.');
  });

  it('says the rules on form fields', () => {
    expect(serverTextAr('Enter a valid email address.')).toBe('أدخلوا عنوان بريد إلكتروني صحيحًا.');
    expect(serverTextAr('startTime must look like 08:00')).toBe('يجب كتابة «startTime» بصيغة مثل 08:00.');
    expect(serverTextAr('fromDate must look like 2026-09-30')).toBe('يجب كتابة «fromDate» بصيغة مثل 2026-09-30.');
  });

  it('says a switched-off service with or without the school', () => {
    expect(serverTextAr('Messaging isn’t switched on for this school.')).toBe('خدمة «Messaging» غير مفعّلة لهذه المدرسة.');
    expect(serverTextAr('Messaging isn’t switched on.')).toBe('خدمة «Messaging» غير مفعّلة.');
  });

  it('says what staff read in their notifications on Today, without guessing anyone’s gender', () => {
    expect(serverTextAr('URGENT: Salma Gamal isn’t at school and the parents don’t know where')).toBe('عاجل: Salma Gamal غير موجود في المدرسة، ولا يعلم أولياء الأمور مكان وجوده');
    expect(serverTextAr('Dina Farouk sent an excuse for Salma Gamal')).toBe('عذر غياب جديد من Dina Farouk عن Salma Gamal');
    expect(serverTextAr('Dina Farouk booked a meeting about Salma Gamal')).toBe('طلب حجز مقابلة من Dina Farouk بخصوص Salma Gamal');
    expect(serverTextAr('Dina Farouk cancelled the meeting on 2026-10-20 at 14:20')).toBe('إلغاء مقابلة يوم 2026-10-20 الساعة 14:20 من Dina Farouk');
    expect(serverTextAr('Dina Farouk updated their mobile number')).toBe('Dina Farouk: تحديث رقم الهاتف');
  });
});

describe('every sentence the API can answer with', () => {
  // Only gateways (the readers) ever see these; nobody reads them on a screen.
  const GATEWAY_ONLY = new Set(['Gateway credentials missing.', 'Unknown gateway or wrong secret.']);
  const ARABIC = /[؀-ۿ]/;

  it('is found in the API’s source', () => {
    // If this drops, the reader below has stopped finding messages and the next test would pass for nothing.
    expect(serverMessages().length).toBeGreaterThan(250);
  });

  it('has an Arabic form on the dashboard', () => {
    const missing = serverMessages()
      .filter((m) => !GATEWAY_ONLY.has(m.text))
      .filter((m) => !fillings(m.text).some((sample) => ARABIC.test(serverTextAr(sample)) && serverTextAr(sample) !== sample))
      .map((m) => `${m.file}: ${m.text}`);
    expect(missing).toEqual([]);
  });
});
