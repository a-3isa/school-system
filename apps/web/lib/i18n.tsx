'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ar, arN, en, Dict } from './strings';

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
/** A module's name, as the API writes it, in Arabic (the English one if it is not a module we know). */
const moduleAr = (name: string): string => {
  const key = Object.keys(en.moduleNames).find((k) => en.moduleNames[k] === name);
  return key ? ar.moduleNames[key] : name;
};

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
  [/^(.+) isn’t switched on( for this school)?\.$/, (_, m, school) => `خدمة «${moduleAr(m)}» غير مفعّلة${school ? ' لهذه المدرسة' : ''}.`],
  [/^(.+) isn’t available yet\.$/, (_, m) => `خدمة «${moduleAr(m)}» غير متاحة بعد.`],
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
      // Academics
      ['You can only mark subjects you teach.', 'يمكنكم رصد درجات المواد التي تدرّسونها فقط.'],
      ['You can see only the classes and subjects you teach.', 'يمكنكم الاطلاع على الفصول والمواد التي تدرّسونها فقط.'],
      ['That date isn’t in an academic year.', 'هذا التاريخ لا يقع ضمن عام دراسي.'],
      ['Exams need a start and an end time.', 'تحتاج الامتحانات إلى وقت بدء ووقت انتهاء.'],
      ['Only exams have a time and a room.', 'الموعد والقاعة خاصان بالامتحانات فقط.'],
      ['An exam must end after it starts.', 'يجب أن ينتهي الامتحان بعد بدئه.'],
      ['This class already has an exam at that time.', 'لدى هذا الفصل امتحان آخر في الموعد نفسه.'],
      ['That room is already used for an exam at that time.', 'القاعة محجوزة لامتحان آخر في الموعد نفسه.'],
      ['Some marks are higher than the new maximum.', 'بعض الدرجات أعلى من الدرجة العظمى الجديدة.'],
      ['Published marks can’t be deleted. Unpublish them first.', 'لا يمكن حذف درجات تم نشرها. يُرجى إلغاء نشرها أولًا.'],
      ['Scores can have at most 2 decimals.', 'يمكن أن تتضمن الدرجة منزلتين عشريتين على الأكثر.'],
      ['Only a student who was absent can be excused.', 'لا يُسجَّل بعذر إلا الطالب الغائب.'],
      ['Some of these students aren’t in this class.', 'بعض هؤلاء الطلاب ليسوا في هذا الفصل.'],
      ['Enter at least one mark before publishing.', 'أدخلوا درجة واحدة على الأقل قبل النشر.'],
      ['Choose a class and a subject.', 'اختاروا الفصل والمادة.'],
      ['Choose a class.', 'اختاروا الفصل.'],
      ['Choose term 1 or 2.', 'اختاروا الفصل الدراسي الأول أو الثاني.'],
      ['Choose a school system.', 'اختاروا النظام الدراسي.'],
      ['Assessment not found.', 'لم يتم العثور على التقييم.'],
      ['Class not found.', 'لم يتم العثور على الفصل.'],
      ['Subject not found.', 'لم يتم العثور على المادة.'],
      ['Room not found.', 'لم يتم العثور على القاعة.'],
      ['Academic year not found.', 'لم يتم العثور على العام الدراسي.'],
      ['Report card not found.', 'لم يتم العثور على الشهادة.'],
      ['Only the class teacher can prepare report cards.', 'رائد الفصل وحده يمكنه إعداد الشهادات.'],
      ['This school year has only one term.', 'هذا العام الدراسي فصل دراسي واحد فقط.'],
      ['This report card is published. Unpublish it to change it.', 'تم نشر هذه الشهادة. يُرجى إلغاء نشرها لتعديلها.'],
      ['Send a subject comment, the class teacher’s comment or the principal’s comment.', 'أرسلوا تعليق مادة أو تعليق رائد الفصل أو تعليق مدير المدرسة.'],
      ['Choose the subject and write the comment.', 'اختاروا المادة واكتبوا التعليق.'],
      ['You can only comment on subjects you teach.', 'يمكنكم التعليق على المواد التي تدرّسونها فقط.'],
      ['Only the class teacher can write this comment.', 'رائد الفصل وحده يمكنه كتابة هذا التعليق.'],
      ['Only Student Affairs can write the principal’s comment.', 'شؤون الطلبة وحدها يمكنها كتابة تعليق مدير المدرسة.'],
      ['Choose which report cards to publish.', 'اختاروا الشهادات المراد نشرها.'],
      ['A scale needs between 2 and 20 grades.', 'يجب أن يضم المقياس ما بين تقديرين و20 تقديرًا.'],
      ['Each grade starts at a percentage between 0 and 100.', 'يبدأ كل تقدير من نسبة مئوية بين 0 و100.'],
      ['Each grade needs a name in English and in Arabic.', 'يحتاج كل تقدير إلى اسم بالإنجليزية وآخر بالعربية.'],
      ['A grade point must be between 0 and 5.', 'يجب أن تكون نقاط التقدير بين 0 و5.'],
      ['The lowest grade must start at 0%.', 'يجب أن يبدأ أدنى تقدير من 0%.'],
      ['Each grade must start at a different percentage.', 'يجب أن يبدأ كل تقدير من نسبة مئوية مختلفة.'],
      // Subjects and teachers
      ['A subject with this name already exists.', 'توجد مادة بهذا الاسم بالفعل.'],
      ['This subject is in the timetable or has marks, so it can’t be deleted.', 'هذه المادة مستخدمة في الجدول الدراسي أو لها درجات، ولذلك لا يمكن حذفها.'],
      ['This subject isn’t one of this class’s subjects. Add it to the year group’s subjects first.', 'هذه المادة ليست من مواد هذا الفصل. أضيفوها إلى مواد الصف الدراسي أولًا.'],
      ['Choose the teacher of this subject in this class.', 'اختاروا معلم هذه المادة في هذا الفصل.'],
      ['This year group’s classes already have lessons or marks in this subject, so it can’t be removed.', 'لدى فصول هذا الصف الدراسي حصص أو درجات في هذه المادة، ولذلك لا يمكن إزالتها.'],
      ['Grade not found.', 'لم يتم العثور على الصف الدراسي.'],
      ['That day isn’t a school day.', 'هذا اليوم ليس يوم دراسة.'],
      ['Class not found in this school.', 'لم يتم العثور على الفصل في هذه المدرسة.'],
      ['Choose two different classes.', 'اختاروا فصلين مختلفين.'],
      ['A week can be copied only to another class of the same year group.', 'يمكن نسخ الأسبوع إلى فصل آخر من الصف الدراسي نفسه فقط.'],
      ['This class has no lessons to copy.', 'لا توجد حصص في هذا الفصل لنسخها.'],
      ['Choose the classroom for the new class’s lessons.', 'اختاروا القاعة التي تُقام فيها حصص الفصل الجديد.'],
      ['Club not found.', 'لم يتم العثور على النادي.'],
      ['You can manage only the clubs you supervise.', 'يمكنكم إدارة الأندية التي تشرفون عليها فقط.'],
      ['Each day can be chosen once.', 'يمكن اختيار كل يوم مرة واحدة فقط.'],
      ['Choose days the school is open.', 'اختاروا أيامًا تكون فيها المدرسة مفتوحة.'],
      ['Times must look like 14:30.', 'يجب كتابة الوقت بصيغة مثل 14:30.'],
      ['The club must start before it ends.', 'يجب أن يبدأ النادي قبل أن ينتهي.'],
      ['Year group not found.', 'لم يتم العثور على الصف الدراسي.'],
      ['Fees for clubs are switched off for this school.', 'رسوم الأندية غير مفعَّلة في هذه المدرسة.'],
      ['Supervisor not found in this school.', 'لم يتم العثور على المشرف في هذه المدرسة.'],
      ['Set the school year first, under School structure & year.', 'حدّدوا العام الدراسي أولًا من «هيكل المدرسة والعام الدراسي».'],
      ['School year not found.', 'لم يتم العثور على العام الدراسي.'],
      ['More students are enrolled than the new number of places.', 'عدد المشتركين أكبر من عدد الأماكن الجديد.'],
      ['Student not found.', 'لم يتم العثور على الطالب.'],
      ['That student isn’t in this club.', 'هذا الطالب غير مشترك في هذا النادي.'],
      ['This club has no fee.', 'هذا النادي بلا رسوم.'],
      ['Only enrolled students can be marked as paid.', 'يمكن تسجيل الدفع للطلاب المشتركين فقط.'],
      ['Dates must look like 2026-09-30.', 'يجب كتابة التاريخ بصيغة مثل 2026-09-30.'],
      ['The club doesn’t meet that day.', 'لا يجتمع النادي في هذا اليوم.'],
      ['Attendance can’t be taken for a day that hasn’t come.', 'لا يمكن رصد الحضور ليوم لم يأتِ بعد.'],
      ['Some of those students aren’t enrolled in this club.', 'بعض هؤلاء الطلاب غير مشتركين في هذا النادي.'],
      ['Choose at least one club.', 'اختاروا نادٍ واحدًا على الأقل.'],
      ['Sign-up for this club is closed.', 'التسجيل في هذا النادي مغلق.'],
      ['Trip not found.', 'لم يتم العثور على الرحلة.'],
      ['You can see only the trips of your own classes.', 'يمكنكم الاطلاع على رحلات فصولكم فقط.'],
      ['The trip must leave before it returns.', 'يجب أن تنطلق الرحلة قبل عودتها.'],
      ['Times must look like 08:30.', 'يجب كتابة الوقت بصيغة مثل 08:30.'],
      ['Give both fromPeriod and toPeriod, or neither for the whole day.', 'حدّدوا الحصة الأولى والأخيرة معًا، أو اتركوهما فارغتين معًا لليوم الدراسي كله.'],
      ['toPeriod must not be before fromPeriod.', 'يجب ألا تسبق الحصة الأخيرة الحصة الأولى.'],
      ['The answer deadline must be in the future.', 'يجب أن يكون آخر موعد للرد في المستقبل.'],
      ['The answer deadline must be before the trip leaves.', 'يجب أن يسبق آخر موعد للرد انطلاق الرحلة.'],
      ['Trip leader not found in this school.', 'لم يتم العثور على مشرف الرحلة في هذه المدرسة.'],
      ['This trip is closed. Cancel it and create a new one to change it.', 'هذه الرحلة مغلقة. ألغوها وأنشئوا رحلة جديدة لإجراء أي تعديل.'],
      ['This trip has been cancelled.', 'تم إلغاء هذه الرحلة.'],
      ['The classes can be changed only while the trip is a draft.', 'لا يمكن تغيير الفصول إلا ما دامت الرحلة مسودة.'],
      ['Only a draft trip can be opened.', 'لا يمكن فتح باب الموافقة إلا لرحلة في حالة مسودة.'],
      ['The answer deadline has passed. Move it later before opening the trip.', 'انقضى آخر موعد للرد. أجّلوه قبل فتح باب الموافقة.'],
      ['Only an open trip can be closed.', 'لا يمكن إغلاق الردود إلا لرحلة مفتوحة.'],
      ['This trip is already cancelled.', 'هذه الرحلة ملغاة بالفعل.'],
      ['This trip has no fee.', 'هذه الرحلة بلا رسوم.'],
      ['Only students with permission can be marked as paid.', 'يمكن تسجيل الدفع للطلاب الحاصلين على الموافقة فقط.'],
      ['Only Student Affairs or the trip leader can take the headcount.', 'العدّ مقصور على شؤون الطلبة ومشرف الرحلة.'],
      ['Headcount is taken on the day of the trip.', 'يُؤخذ العدّ في يوم الرحلة.'],
      ['Headcount can be taken for an open or closed trip.', 'يمكن أخذ العدّ لرحلة مفتوحة أو مغلقة فقط.'],
      ['That student isn’t going on this trip.', 'هذا الطالب غير مشارك في هذه الرحلة.'],
      ['Mark that the student left first.', 'سجّلوا انطلاق الطالب أولًا.'],
      ['The deadline for this permission slip has passed. Please contact the school.', 'انقضى الموعد النهائي للرد على طلب الموافقة. يُرجى التواصل مع المدرسة.'],
      ['Type your full name to sign.', 'اكتبوا اسمكم الكامل للتوقيع.'],
      ['Event not found.', 'لم يتم العثور على الفعالية.'],
      ['The event must start before it ends.', 'يجب أن تبدأ الفعالية قبل أن تنتهي.'],
      ['This event is already published.', 'هذه الفعالية منشورة بالفعل.'],
      ['Attach the photo as “file”.', 'أرفقوا الصورة.'],
      ['Photos must be JPEG, PNG or WebP.', 'يجب أن تكون الصور بصيغة JPEG أو PNG أو WebP.'],
      ['An event can have up to 30 photos.', 'يمكن أن تحتوي الفعالية على 30 صورة كحدٍّ أقصى.'],
      ['Photo not found.', 'لم يتم العثور على الصورة.'],
      ['The end of the range is before its start.', 'نهاية الفترة تسبق بدايتها.'],
      ['Ask for about three months at a time.', 'اطلبوا نحو ثلاثة أشهر في كل مرة.'],
      ['Period not found in this school.', 'لم يتم العثور على الحصة في هذه المدرسة.'],
      ['Room not found in this school.', 'لم يتم العثور على القاعة في هذه المدرسة.'],
      ['Subject not found in this school.', 'لم يتم العثور على المادة في هذه المدرسة.'],
      ['Teacher not found in this school.', 'لم يتم العثور على المعلم في هذه المدرسة.'],
      ['You can see only your own profile.', 'يمكنكم الاطلاع على ملفكم الشخصي فقط.'],
      ['Staff member not found.', 'لم يتم العثور على العضو.'],
      // Sign-in and access
      ['Sign in first.', 'يُرجى تسجيل الدخول أولًا.'],
      ['Your session has expired. Sign in again.', 'انتهت جلستكم. يُرجى تسجيل الدخول مجددًا.'],
      ['Your role can’t do this.', 'لا تتيح صلاحياتكم هذا الإجراء.'],
      ['This action needs a school account.', 'يتطلّب هذا الإجراء حسابًا مدرسيًا.'],
      ['Smart bands and readers (automatic attendance) aren’t part of this school’s subscription.', 'الأساور الذكية وأجهزة القراءة (الحضور التلقائي) ليست ضمن اشتراك المدرسة.'],
      ['Automatic attendance comes with the subscription. Ask the platform owner.', 'الحضور التلقائي جزء من الاشتراك. يُرجى التواصل مع مالك المنصة.'],
      ['Automatic attendance isn’t included in this school’s plan.', 'الحضور التلقائي غير مشمول في باقة المدرسة.'],
      ['That code is wrong or has expired. Ask for a new one.', 'الرمز غير صحيح أو انتهت صلاحيته. يُرجى طلب رمز جديد.'],
      ['Wrong email or password.', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
      ['Too many codes. Try again in an hour.', 'تجاوزتم عدد الرموز المسموح به. يُرجى المحاولة بعد ساعة.'],
      ['This mobile number is already used by another account.', 'رقم الهاتف هذا مستخدم في حساب آخر.'],
      ['This mobile number belongs to another account.', 'رقم الهاتف هذا يخص حسابًا آخر.'],
      ['Sign-up took too long. Start again.', 'استغرق التسجيل وقتًا طويلًا. يُرجى البدء من جديد.'],
      // The wording of rules on forms
      ['Add the student’s mother, father or guardian.', 'أضيفوا أحد والدَي الطالب أو ولي أمره.'],
      ['Choose a password of at least 8 characters.', 'اختاروا كلمة مرور من 8 أحرف على الأقل.'],
      ['Choose boy or girl.', 'اختاروا ذكرًا أو أنثى.'],
      ['Choose the nationality.', 'اختاروا الجنسية.'],
      ['Enter a valid email address.', 'أدخلوا عنوان بريد إلكتروني صحيحًا.'],
      ['Enter the date of birth.', 'أدخلوا تاريخ الميلاد.'],
      ['Enter the parent’s email: they sign up in the app with it.', 'أدخلوا البريد الإلكتروني لولي الأمر؛ إذ يُنشئ به حسابه في التطبيق.'],
      ['Name the year like 2026/2027.', 'سمّوا العام الدراسي بصيغة مثل 2026/2027.'],
      ['The code has 6 digits.', 'يتكوّن الرمز من 6 أرقام.'],
      ['serial may use letters, digits and dashes (4–40)', 'يمكن أن يتكوّن الرقم التسلسلي من حروف وأرقام وشرطات (من 4 إلى 40 خانة).'],
      ['Enter the mobile number with its country code, like +201001234567.', 'أدخلوا رقم الهاتف مع رمز الدولة، مثل +201001234567.'],
      ['This email belongs to another account.', 'هذا البريد الإلكتروني يخص حسابًا آخر.'],
      ['A user with this email already exists.', 'يوجد مستخدم بهذا البريد الإلكتروني بالفعل.'],
      ['Someone already uses this email or phone number.', 'هذا البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل.'],
      ['Unknown staff role.', 'الدور الوظيفي غير معروف.'],
      ['You can’t deactivate your own account.', 'لا يمكنكم إيقاف حسابكم بأنفسكم.'],
      ['School not found.', 'لم يتم العثور على المدرسة.'],
      ['Core is always on.', 'الخدمة الأساسية مفعّلة دائمًا.'],
      // Records
      ['Not found.', 'لم يتم العثور على العنصر المطلوب.'],
      ['It’s still in use, or it refers to something that doesn’t exist.', 'لا يزال قيد الاستخدام، أو يشير إلى عنصر غير موجود.'],
      ['This already exists.', 'هذا العنصر موجود بالفعل.'],
      ['Child not found.', 'لم يتم العثور على الطالب.'],
      ['Parent not found.', 'لم يتم العثور على ولي الأمر.'],
      ['File not found.', 'لم يتم العثور على الملف.'],
      ['Notification not found.', 'لم يتم العثور على الإشعار.'],
      ['Lesson not found.', 'لم يتم العثور على الحصة في الجدول.'],
      ['Period not found.', 'لم يتم العثور على موعد الحصة.'],
      ['Holiday not found.', 'لم يتم العثور على الإجازة.'],
      ['Exception not found.', 'لم يتم العثور على المتابعة.'],
      ['Excuse not found.', 'لم يتم العثور على العذر.'],
      ['Gateway not found.', 'لم يتم العثور على جهاز القراءة.'],
      ['Strap not found.', 'لم يتم العثور على السوار الذكي.'],
      ['Student not found in this school.', 'لم يتم العثور على الطالب في هذه المدرسة.'],
      // Attendance
      ['Choose a subject.', 'اختاروا المادة.'],
      ['A student in the list isn’t in this class.', 'يوجد في القائمة طالب ليس من هذا الفصل.'],
      ['Automatic attendance is on, so a manual mark needs a reason.', 'الحضور التلقائي مفعّل، لذا يلزم ذكر سبب عند التسجيل اليدوي.'],
      ['Only the homeroom teacher or an admin can mark this class away.', 'لا يسجّل الفصل خارج المدرسة إلا رائد الفصل أو شؤون الطلبة.'],
      ['Past days can only be corrected by an admin.', 'لا يصحّح الأيام السابقة إلا شؤون الطلبة.'],
      ['This is from an earlier day. An admin has to resolve it.', 'هذه المتابعة من يوم سابق، ولا يغلقها إلا شؤون الطلبة.'],
      // Excuses
      ['The last day can’t be before the first day.', 'لا يمكن أن يسبق آخر يوم أول يوم.'],
      ['You already sent an excuse for some of these days. The school hasn’t answered yet.', 'سبق أن أرسلتم عذرًا عن بعض هذه الأيام، ولم ترد المدرسة بعد.'],
      ['Some of these days are already excused.', 'بعض هذه الأيام معتذَر عنها بالفعل.'],
      ['There is nothing to answer for that day.', 'لا يوجد ما يستوجب الرد في ذلك اليوم.'],
      ['This excuse has no attachment.', 'لا يوجد مرفق لهذا العذر.'],
      ['Say why the excuse is rejected: the parent will read it.', 'يُرجى ذكر سبب رفض العذر؛ فسيطّلع عليه ولي الأمر.'],
      ['This excuse has already been decided.', 'سبق البتّ في هذا العذر.'],
      ['Unknown status.', 'الحالة غير معروفة.'],
      // Messaging
      ['Attach the file as “file”.', 'أرفقوا الملف في الحقل «file».'],
      ['Only urgent messages need confirming.', 'التأكيد مطلوب للرسائل العاجلة فقط.'],
      ['Unknown priority.', 'درجة الأولوية غير معروفة.'],
      ['You can write to your child’s teachers and Student Affairs only.', 'يمكنكم مراسلة معلمي أبنائكم وشؤون الطلبة فقط.'],
      ['Unknown scope.', 'النطاق غير معروف.'],
      ['That time has passed.', 'انقضى هذا الموعد.'],
      ['You already have a meeting with this teacher that day.', 'لديكم مقابلة مع هذا المعلم في اليوم نفسه بالفعل.'],
      ['Someone has just booked this time. Please choose another.', 'حُجز هذا الموعد للتو. يُرجى اختيار موعد آخر.'],
      ['It’s too late to cancel online. Please call the school.', 'فات وقت الإلغاء عبر التطبيق. يُرجى الاتصال بالمدرسة.'],
      ['This poll has closed.', 'أُغلق هذا الاستطلاع.'],
      ['Choose one of the answers listed.', 'يُرجى اختيار إحدى الإجابات المعروضة.'],
      ['Choose one answer.', 'يُرجى اختيار إجابة واحدة.'],
      // School set-up
      ['A period must end after it starts.', 'يجب أن تنتهي الحصة بعد بدايتها.'],
      ['The year must end after it starts.', 'يجب أن ينتهي العام الدراسي بعد بدايته.'],
      ['The second term must start inside the year.', 'يجب أن يبدأ الفصل الدراسي الثاني ضمن العام الدراسي.'],
      ['Give the mid-year break both a first and a last day.', 'حدّدوا لإجازة منتصف العام أول يوم وآخر يوم.'],
      ['The mid-year break must be inside the year, and end after it starts.', 'يجب أن تقع إجازة منتصف العام ضمن العام الدراسي، وأن تنتهي بعد بدايتها.'],
      ['Only secondary classes have a stream (science, mathematics or literary).', 'الشعبة (علمي علوم أو علمي رياضة أو أدبي) خاصة بفصول المرحلة الثانوية فقط.'],
      ['This school has no crest yet.', 'ليس للمدرسة شعار بعد.'],
      ['Attach the crest as “file”.', 'أرفقوا الشعار في الحقل «file».'],
      ['Please use a PNG, JPG or WebP image for the crest.', 'يُرجى استخدام صورة بصيغة PNG أو JPG أو WebP للشعار.'],
      ['A holiday must end on or after the day it starts.', 'يجب ألا تنتهي الإجازة قبل يوم بدايتها.'],
      ['A grade with this name already exists.', 'يوجد صف دراسي بهذا الاسم بالفعل.'],
      ['A class with this name already exists.', 'يوجد فصل بهذا الاسم بالفعل.'],
      ['A room with this name already exists.', 'توجد قاعة بهذا الاسم بالفعل.'],
      ['Give a roomId or a classId.', 'حدّدوا قاعة أو فصلًا.'],
      ['“at” must be a date and time.', 'يجب أن يكون «at» تاريخًا ووقتًا.'],
      // Smart bands and readers
      ['A room gateway needs a room.', 'يلزم تحديد قاعة لجهاز القراءة الخاص بالقاعة.'],
      ['No gateway has this claim code. Check the label on the device.', 'لا يوجد جهاز قراءة بهذا الرمز. يُرجى مراجعة الملصق على الجهاز.'],
      ['This gateway belongs to another school.', 'جهاز القراءة هذا يخص مدرسة أخرى.'],
      ['That isn’t a valid strap address (12 hex digits, like DC:0D:30:AA:4A:11).', 'عنوان السوار غير صالح (12 خانة سداسية عشرية، مثل DC:0D:30:AA:4A:11).'],
      ['Those rules are out of range.', 'القيم المحدَّدة خارج النطاق المسموح.'],
      ['This strap is already registered, or the student already has a strap.', 'هذا السوار مسجّل بالفعل، أو أن للطالب سوارًا بالفعل.'],
      ['This student already has a strap. Unassign it first.', 'لدى الطالب سوار بالفعل. يُرجى إلغاء ربطه أولًا.'],
      // Students and their papers
      ['Attach the photo or scan as “file”.', 'أرفقوا الصورة أو المستند الممسوح في الحقل «file».'],
      ['Choose what this paper is.', 'يُرجى تحديد نوع هذا المستند.'],
      ['Use a photo (JPG, PNG or WebP) or a PDF. Phone photos in HEIC can be saved as JPG first.', 'استخدموا صورة (JPG أو PNG أو WebP) أو ملف PDF. ويمكن حفظ صور الهاتف بصيغة HEIC بصيغة JPG أولًا.'],
      ['The student’s photo must be an image, not a PDF.', 'يجب أن تكون صورة الطالب صورة وليست ملف PDF.'],
      ['Some photos weren’t uploaded. Add them again.', 'تعذّر رفع بعض الصور. يُرجى إضافتها مجددًا.'],
      ['Only the school admin can open this paper.', 'لا يفتح هذا المستند إلا شؤون الطلبة.'],
      ['This paper is required. Upload a new one before removing this.', 'هذا المستند مطلوب. يُرجى رفع مستند جديد قبل حذف الحالي.'],
      ['That file isn’t an Excel workbook (.xlsx).', 'هذا الملف ليس ملف Excel بصيغة xlsx.'],
      ['The workbook has no sheets.', 'ملف Excel لا يحتوي على أي ورقة.'],
      ['Import at most 5,000 students at a time.', 'يمكن استيراد 5,000 طالب كحدٍّ أقصى في المرة الواحدة.'],
      ['Attach the Excel file as “file”.', 'أرفقوا ملف Excel في الحقل «file».'],
      ['Enter the student’s national number (14 digits, on the birth certificate).', 'أدخلوا الرقم القومي للطالب (14 رقمًا، كما في شهادة الميلاد).'],
      ['The national number should be 14 digits, as on the birth certificate.', 'يجب أن يتكوّن الرقم القومي من 14 رقمًا كما في شهادة الميلاد.'],
      ['Another student already has this national number.', 'الرقم القومي هذا مسجّل بالفعل لطالب آخر.'],
      ['This parent is already linked to the student.', 'ولي الأمر هذا مرتبط بالطالب بالفعل.'],
      ['This parent isn’t linked to the student.', 'ولي الأمر هذا غير مرتبط بالطالب.'],
      ['A student needs at least one parent or guardian. Add another before removing this one.', 'يلزم أن يكون للطالب ولي أمر واحد على الأقل. يُرجى إضافة آخر قبل حذف هذا.'],
    ] as [string, string][]
  ).map(([en, ar]): [RegExp, () => string] => [new RegExp(`^${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), () => ar]),
  [/^Points for (praise|concern|incident) notes must be between (-?\d+) and (-?\d+)\.$/, (_, _k, a, b) => `يجب أن تكون النقاط بين ${a} و${b}.`],
  [/^(.+) teaches (.+) in (.+)\. To change the teacher, change it for the whole subject\.$/, (_, who, sub, cls) => `${who} يدرّس ${sub} في الفصل ${cls}. لتغيير المعلم، غيّروه للمادة كلها.`],
  [/^(.+) already teaches (.+) on (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) in period (\d+)\.$/, (_, who, cls, day, p) => `${who} يدرّس الفصل ${cls} يوم ${({ Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت' } as Record<string, string>)[day]} في الحصة ${p} بالفعل.`],
  [/^(.+) already teaches (.+) in period (\d+)\.$/, (_, who, cls, p) => `${who} يدرّس الفصل ${cls} في الحصة ${p} بالفعل.`],
  [/^(.+) already has (.+) in period (\d+)\.$/, (_, cls, sub, p) => `لدى الفصل ${cls} حصة ${sub} في الحصة ${p} بالفعل.`],
  [/^(.+) is already used by (.+) in period (\d+)\.$/, (_, room, cls, p) => `القاعة ${room} مستخدمة بالفعل مع الفصل ${cls} في الحصة ${p}.`],
  [/^Scores must be between 0 and (\d+)\.$/, (_, n) => `يجب أن تكون الدرجة بين 0 و${n}.`],
  [/^A note can be dated up to (\d+) days back\.$/, (_, n) => `يمكن تأريخ الملاحظة حتى ${n} يومًا إلى الوراء.`],
  [/^You can change your own notes for (\d+) hours\. After that, please ask Student Affairs\.$/, (_, n) => `يمكنكم تعديل ملاحظاتكم خلال ${n} ساعة، وبعد ذلك يُرجى الرجوع إلى شؤون الطلبة.`],
  [/^(.+) is already on the list\.$/, (_, n) => `تم تسجيل ${n} في القائمة بالفعل.`],
  [/^(.+) isn’t in this club\.$/, (_, n) => `${n} غير مشترك في هذا النادي.`],
  [/^This club isn’t open to (.+)’s year group\.$/, (_, n) => `هذا النادي غير مفتوح لطلاب الصف الدراسي الذي يدرس فيه ${n}.`],
  // Sentences with a name, a number or a time in them
  [/^There’s no school that day: (.+)\.$/, (_, why) => `لا توجد دراسة في هذا اليوم: ${why}.`],
  [/^Too many wrong passwords\. Try again in (\d+) minutes?\.$/, (_, n) => `تجاوزتم عدد المحاولات المسموح به. يُرجى المحاولة بعد ${arN(+n, 'دقيقة واحدة', 'دقيقتين', 'دقائق', 'دقيقة')}.`],
  [/^Gateway (.+) is already registered\.$/, (_, serial) => `جهاز القراءة ${serial} مسجّل بالفعل.`],
  [/^An excuse can be sent up to (\d+) days after the absence\. For an older one, please contact the school\.$/, (_, n) => `يمكن إرسال العذر خلال ${arN(+n, 'يوم واحد', 'يومين', 'أيام', 'يومًا')} من الغياب. وللأعذار الأقدم، يُرجى التواصل مع المدرسة.`],
  [/^An excuse can be sent up to (\d+) days ahead\.$/, (_, n) => `يمكن إرسال العذر قبل الغياب بما يصل إلى ${arN(+n, 'يوم واحد', 'يومين', 'أيام', 'يومًا')}.`],
  [/^One excuse can cover at most (\d+) days\.$/, (_, n) => `لا يغطي العذر الواحد أكثر من ${arN(+n, 'يوم واحد', 'يومين', 'أيام', 'يومًا')}.`],
  [/^There is no module called “(.+)”\.$/, (_, k) => `لا توجد خدمة باسم «${k}».`],
  [/^Unknown feature: (.+)\.$/, (_, f) => `ميزة غير معروفة: ${f}.`],
  [/^Turn off (.+) first\. It needs (.+)\.$/, (_, a, b) => {
    const off = a.split(' and ').map((n: string) => `«${moduleAr(n)}»`);
    return `يُرجى إيقاف ${off.length === 1 ? 'خدمة' : 'الخدمات'} ${off.join(' و')} أولًا، فهي تحتاج إلى خدمة «${moduleAr(b)}».`;
  }],
  [/^Overlaps period (\d+) \((.+)–(.+)\)\.$/, (_, n, from, to) => `تتداخل مع الحصة ${n} (من ${from} إلى ${to}).`],
  [/^It overlaps the year (.+)\.$/, (_, name) => `يتداخل مع العام الدراسي ${name}.`],
  [/^The year (.+) already exists\.$/, (_, name) => `العام الدراسي ${name} موجود بالفعل.`],
  [/^Period (\d+) already exists\.$/, (_, n) => `الحصة ${n} موجودة بالفعل.`],
  [/^(.+) not found in this school\.$/, (_, what) => `لم يتم العثور على ${({ Grade: 'الصف الدراسي', Teacher: 'المعلم', Class: 'الفصل', Room: 'القاعة', Subject: 'المادة', Period: 'الحصة', Student: 'الطالب' } as Record<string, string>)[what] ?? `«${what}»`} في هذه المدرسة.`],
  [/^Add the (.+)\.$/, (_, what) => `يُرجى إضافة ${what.replace('student’s photo', 'صورة الطالب').replace('birth certificate', 'شهادة الميلاد').replace(' and ', ' و')}.`],
  [/^The first row needs a “(.+)” column\. Download the template to see the layout\.$/, (_, col) => `يجب أن يتضمن الصف الأول عمود «${col}». يُرجى تنزيل النموذج للاطلاع على التنسيق.`],
  [/^Check the date of birth: the student would be (\d+) years old\.$/, (_, n) => `يُرجى مراجعة تاريخ الميلاد؛ فعمر الطالب وفقه ${arN(+n, 'سنة واحدة', 'سنتان', 'سنوات', 'سنة')}.`],
  [/^The national number says the student was born on (.+)\. Check the date of birth or the number\.$/, (_, d) => `تاريخ الميلاد وفق الرقم القومي هو ${d}. يُرجى مراجعة تاريخ الميلاد أو الرقم.`],
  [/^The national number is a (boy|girl)’s\. Check the gender or the number\.$/, (_, g) => `الرقم القومي يدل على أن النوع ${g === 'boy' ? 'ذكر' : 'أنثى'}. يُرجى مراجعة النوع أو الرقم.`],
  [/^Student (.+) already has this national number\.$/, (_, code) => `الرقم القومي هذا مسجّل بالفعل للطالب ${code}.`],
  [/^This student already has a (mother|father|guardian)\.$/, (_, r) => `تم تسجيل ${({ mother: 'أم', father: 'أب', guardian: 'ولي أمر' } as Record<string, string>)[r]} لهذا الطالب بالفعل.`],
  [/^Student code (.+) is already used\.$/, (_, code) => `كود الطالب ${code} مستخدم بالفعل.`],
  [/^(\w+) must look like (.+)$/, (_, field, example) => `يجب كتابة «${field}» بصيغة مثل ${example}.`],
  // What staff read in their notifications on Today
  [/^URGENT: (.+) isn’t at school and the parents don’t know where$/, (_, n) => `عاجل: ${n} غير موجود في المدرسة، ولا يعلم أولياء الأمور مكان وجوده`],
  [/^(.+) sent an excuse for (.+)$/, (_, parent, child) => `عذر غياب جديد من ${parent} عن ${child}`],
  [/^(.+) booked a meeting about (.+)$/, (_, parent, child) => `طلب حجز مقابلة من ${parent} بخصوص ${child}`],
  [/^(.+) cancelled the meeting on (.+) at (.+)$/, (_, parent, day, time) => `إلغاء مقابلة يوم ${day} الساعة ${time} من ${parent}`],
  // The bodies of what staff are told: a parent's excuse, a meeting, an early departure, the urgent absence
  [/^(.+?)(?: \((.+?)\))?: (sick|appointment|family|other), (\d{4}-\d{2}-\d{2})(?: to (\d{4}-\d{2}-\d{2}))?\.(?: (“.*”))?$/, (_, who, cls, why, from, to, note) => `${who}${cls ? ` (${cls})` : ''}: ${ar.excuses.reason[why.toUpperCase()]}، ${to ? `من ${from} إلى ${to}` : from}.${note ? ` ${note}` : ''}`],
  [/^(\d{4}-\d{2}-\d{2}) at (\d\d:\d\d), (.*?)\.(?: (“.*”))?$/, (_, day, time, place, note) => `يوم ${day} الساعة ${time}، ${place}.${note ? ` ${note}` : ''}`],
  [/^The time is free again\.$/, () => 'أصبح هذا الموعد متاحًا من جديد.'],
  [/^(.+) left early$/, (_, who) => `انصراف مبكر: ${who}`],
  [/^Went out through the gate at (\d\d:\d\d) without a dismissal\.$/, (_, at) => `انصراف من البوابة الساعة ${at} دون إذن انصراف.`],
  [/^New message from (.+) about (.+)$/, (_, sender, child) => `رسالة جديدة من ${sender} بخصوص ${child}`],
  [/^(.+?)(?: \((.+?)\))? didn’t come to school and the parents (said they don’t know where the child is|didn’t answer within (\d+) minutes)\. Call the parents to find out where (.+?) is: (.+)\.$/, (_, who, cls, _why, mins, first, calls) => `${who}${cls ? ` (${cls})` : ''}: غياب عن المدرسة، ${mins ? `ولم يرد أولياء الأمور خلال ${arN(+mins, 'دقيقة واحدة', 'دقيقتين', 'دقائق', 'دقيقة')}` : 'وأفاد أولياء الأمور بأنهم لا يعلمون مكان وجود الطالب'}. يُرجى الاتصال بأولياء الأمور لمعرفة مكان وجود ${first}: ${calls === 'no number on file' ? 'لا يوجد رقم مسجّل' : calls}.`],
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
  /** A subject's name in this language: the Arabic one when the school has given it, else the English one. */
  subject: (s: { name: string; nameAr?: string | null } | null | undefined) => string;
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
      subject: (s) => (!s ? '' : lang === 'ar' && s.nameAr ? s.nameAr : s.name),
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
