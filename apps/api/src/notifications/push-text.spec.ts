import { arabicTitled, dayLine, pushBody, TextContext } from './push-text';

const ctx = (over: Partial<TextContext> = {}): TextContext => ({ lang: 'en', name: 'Salma', gender: 'FEMALE', data: {}, ...over });

describe('pushBody', () => {
  it('says the same as the app’s list, in English', () => {
    expect(pushBody('attendance.arrived', ctx())).toBe('Salma arrived safely at school');
    expect(pushBody('attendance.absentCheck', ctx())).toBe('Salma didn’t come to school today. Do you know why?');
    expect(pushBody('attendance.absent', ctx())).toBe('Salma is absent today');
    expect(pushBody('attendance.left', ctx())).toBe('Salma left school early');
    expect(pushBody('attendance.lessonAbsent', ctx({ data: { subject: 'Math', room: 'Room 204' } }))).toBe('Salma missed Math in Room 204. Student Affairs is following up.');
    expect(pushBody('attendance.lessonPresent', ctx({ data: { subject: 'Math', room: 'Room 204' } }))).toBe('Salma is back in Math, Room 204');
    expect(pushBody('excuse.approved', ctx())).toBe('The school accepted Salma’s excuse');
    expect(pushBody('excuse.rejected', ctx())).toBe('The school did not accept Salma’s excuse');
  });

  it('agrees with the child’s gender in Arabic', () => {
    const boy = ctx({ lang: 'ar', name: 'أحمد', gender: 'MALE' });
    const girl = ctx({ lang: 'ar', name: 'ليلى', gender: 'FEMALE' });
    const neutral = ctx({ lang: 'ar', name: 'سلمى', gender: null });
    expect(pushBody('attendance.arrived', boy)).toBe('وصل أحمد المدرسة بالسلامة');
    expect(pushBody('attendance.arrived', girl)).toBe('وصلت ليلى المدرسة بالسلامة');
    expect(pushBody('attendance.arrived', neutral)).toBe('وصول سلمى إلى المدرسة بالسلامة');
    expect(pushBody('attendance.absent', boy)).toBe('أحمد غائب اليوم');
    expect(pushBody('attendance.absent', girl)).toBe('ليلى غائبة اليوم');
    expect(pushBody('attendance.left', girl)).toBe('غادرت ليلى المدرسة مبكرًا');
    expect(pushBody('attendance.absentCheck', boy)).toBe('لم يحضر أحمد إلى المدرسة اليوم. هل تعلمون السبب؟');
    expect(pushBody('attendance.lessonAbsent', { ...girl, data: { subject: 'الرياضيات', room: 'فصل 204' } })).toBe('غابت ليلى عن حصة الرياضيات في فصل 204. وتتابع شؤون الطلبة الأمر.');
    expect(pushBody('attendance.lessonPresent', { ...boy, data: { subject: 'الرياضيات', room: 'فصل 204' } })).toBe('عاد أحمد إلى حصة الرياضيات بفصل 204');
    expect(pushBody('excuse.approved', boy)).toBe('قبلت المدرسة عذر أحمد');
  });

  it('words clubs, trips and events in both languages, and the child’s name where it is about the child', () => {
    const club = { name: 'Chess', nameAr: 'الشطرنج' };
    expect(pushBody('activity.promoted', ctx({ data: club }))).toBe('Good news: Salma now has a place in Chess');
    expect(pushBody('activity.promoted', ctx({ lang: 'ar', name: 'سلمى', data: club }))).toBe('يسعدنا إبلاغكم بأنه أصبح لـسلمى مكان في الشطرنج');
    expect(pushBody('activity.promoted', ctx({ lang: 'ar', name: 'سلمى', data: { name: 'Chess' } }))).toBe('يسعدنا إبلاغكم بأنه أصبح لـسلمى مكان في Chess');
    const trip = { title: 'Pyramids', date: '2030-03-05' };
    expect(pushBody('trip.consent', ctx({ data: trip }))).toBe('Permission needed: Pyramids on Tuesday 5 March for Salma');
    expect(pushBody('trip.consent', ctx({ lang: 'ar', name: 'سلمى', data: trip }))).toBe('مطلوب موافقتكم: رحلة Pyramids يوم الثلاثاء 5 مارس لـسلمى');
    expect(pushBody('trip.reminder', ctx())).toBe('Reminder: please answer the permission slip for Salma by tomorrow');
    expect(pushBody('trip.reminder', ctx({ lang: 'ar', name: 'سلمى' }))).toBe('تذكير: يُرجى الرد على طلب الموافقة على رحلة سلمى قبل الغد');
    expect(pushBody('trip.answered', ctx({ data: { by: 'Dina', decision: 'GIVEN' } }))).toBe('Dina answered the permission slip for Salma: Yes');
    expect(pushBody('trip.answered', ctx({ lang: 'ar', name: 'سلمى', data: { by: 'Dina', decision: 'DECLINED' } }))).toBe('ردّ Dina على طلب الموافقة على رحلة سلمى: غير موافق');
    expect(pushBody('trip.answered', ctx({ data: { by: 'Dina' } }))).toBeNull(); // no decision: the server’s words
    expect(pushBody('trip.changed', ctx({ data: trip }))).toBe('The trip Pyramids has changed. Please check the details');
    expect(pushBody('trip.changed', ctx({ lang: 'ar', data: trip }))).toBe('طرأ تعديل على رحلة Pyramids، يُرجى مراجعة التفاصيل');
    expect(pushBody('trip.cancelled', ctx({ data: trip }))).toBe('The trip Pyramids on Tuesday 5 March has been cancelled');
    expect(pushBody('trip.cancelled', ctx({ lang: 'ar', data: trip }))).toBe('أُلغيت رحلة Pyramids المقررة يوم الثلاثاء 5 مارس');
    expect(pushBody('event.new', ctx({ name: null, data: { title: 'Sports day', date: '2030-03-10' } }))).toBe('School event: Sports day on Sunday 10 March');
    expect(pushBody('event.new', ctx({ lang: 'ar', name: null, data: { title: 'اليوم الرياضي', date: '2030-03-10' } }))).toBe('فعالية مدرسية: اليوم الرياضي يوم الأحد 10 مارس');
    expect(pushBody('trip.consent', ctx({ name: null, data: trip }))).toBeNull(); // about a child, but no child
  });

  it('words messages from the school in both languages', () => {
    expect(pushBody('announcement.new', ctx({ data: { title: 'Sports day' } }))).toBe('New from the school: Sports day');
    expect(pushBody('announcement.new', ctx({ lang: 'ar', data: { title: 'اليوم الرياضي' } }))).toBe('جديد من المدرسة: اليوم الرياضي');
    expect(pushBody('announcement.emergency', ctx({ lang: 'ar', name: null, data: { title: 'إغلاق مبكر' } }))).toBe('عاجل من المدرسة: إغلاق مبكر');
    expect(pushBody('poll.new', ctx({ data: { question: 'Which lunch?' } }))).toBe('The school asks your opinion: Which lunch?');
    expect(pushBody('message.new', ctx({ data: { from: 'Ms. Hana Nabil' } }))).toBe('New message from Ms. Hana Nabil about Salma');
    expect(pushBody('message.new', ctx({ lang: 'ar', data: { from: 'Ms. Hana Nabil' } }))).toBe('رسالة جديدة من مس Hana Nabil بشأن Salma');
  });

  it('words a note from school by its kind', () => {
    expect(pushBody('behaviour.note', ctx({ data: { kind: 'PRAISE' } }))).toBe('Well done! A note of praise for Salma');
    expect(pushBody('behaviour.note', ctx({ data: { kind: 'CONCERN' } }))).toBe('A note from school about Salma');
    expect(pushBody('behaviour.note', ctx({ data: { kind: 'INCIDENT' } }))).toBe('Student Affairs has written to you about Salma');
    expect(pushBody('behaviour.note', ctx({ lang: 'ar', name: 'سلمى', data: { kind: 'PRAISE' } }))).toBe('أحسنتم! ثناء من المدرسة على سلمى');
    expect(pushBody('behaviour.note', ctx({ lang: 'ar', name: 'سلمى', data: { kind: 'CONCERN' } }))).toBe('ملاحظة من المدرسة بشأن سلمى');
    expect(pushBody('behaviour.note', ctx({ lang: 'ar', name: 'سلمى', data: { kind: 'INCIDENT' } }))).toBe('تواصلت شؤون الطلبة معكم بشأن سلمى');
    expect(pushBody('behaviour.note', ctx({ name: null, data: { kind: 'PRAISE' } }))).toBeNull();
  });

  it('words a new mark and a report card, in both languages', () => {
    const mark = { subject: 'Math', title: 'Unit 3 quiz' };
    expect(pushBody('marks.published', ctx({ data: mark }))).toBe('New mark for Salma in Math: Unit 3 quiz');
    expect(pushBody('marks.published', ctx({ lang: 'ar', name: 'سلمى', data: { subject: 'الرياضيات', title: 'اختبار الوحدة الثالثة' } }))).toBe('درجة جديدة لـسلمى في الرياضيات: اختبار الوحدة الثالثة');
    expect(pushBody('marks.published', ctx({ lang: 'ar', name: 'سلمى', data: { subject: 'Math', subjectAr: 'الرياضيات', title: 'اختبار' } }))).toBe('درجة جديدة لـسلمى في الرياضيات: اختبار'); // the Arabic subject name when there is one
    expect(pushBody('marks.published', ctx({ lang: 'ar', name: 'سلمى', data: { subject: 'Math', subjectAr: null, title: 'اختبار' } }))).toBe('درجة جديدة لـسلمى في Math: اختبار');
    expect(pushBody('marks.published', ctx({ data: { subject: 'Math' } }))).toBeNull();
    expect(pushBody('reportCard.published', ctx({ data: { term: 1 } }))).toBe('Salma’s report card for term 1 is ready');
    expect(pushBody('reportCard.published', ctx({ lang: 'ar', name: 'سلمى', data: { term: 1 } }))).toBe('صدرت شهادة سلمى عن الفصل الدراسي الأول');
    expect(pushBody('reportCard.published', ctx({ lang: 'ar', name: 'سلمى', data: { term: 2 } }))).toBe('صدرت شهادة سلمى عن الفصل الدراسي الثاني');
    expect(pushBody('reportCard.published', ctx({ data: { term: 3 } }))).toBeNull();
  });

  it('words a cancelled meeting with the day and the time', () => {
    const data = { teacher: 'Mr. Sherif Kamal', date: '2026-10-04', time: '14:00' };
    expect(pushBody('meeting.cancelled', ctx({ name: null, data }))).toBe('Your meeting with Mr. Sherif Kamal on Sunday 4 October at 14:00 was cancelled');
    const ar = pushBody('meeting.cancelled', ctx({ lang: 'ar', name: null, data }))!;
    expect(ar).toContain('مستر Sherif Kamal');
    expect(ar).toContain('الأحد 4 أكتوبر');
    expect(ar).toContain('⁦' + '14:00' + '⁩'); // the time stays left to right inside Arabic
  });

  it('has nothing to say for what it doesn’t know, or when a name is missing', () => {
    expect(pushBody('something.else', ctx())).toBeNull();
    expect(pushBody('attendance.arrived', ctx({ name: null }))).toBeNull();
    expect(pushBody('attendance.lessonAbsent', ctx({ data: { subject: 'Math' } }))).toBeNull();
    expect(pushBody('announcement.new', ctx({ data: {} }))).toBeNull();
  });
});

describe('helpers', () => {
  it('gives teachers their Arabic titles', () => {
    expect(arabicTitled('Ms. Hana Nabil')).toBe('مس Hana Nabil');
    expect(arabicTitled('Mrs. Dina Adel')).toBe('مدام Dina Adel');
    expect(arabicTitled('Dr. Omar Fathy')).toBe('د. Omar Fathy');
    expect(arabicTitled('Hana Nabil')).toBe('Hana Nabil');
  });

  it('writes a date as a weekday and day', () => {
    expect(dayLine('2026-10-01', 'en')).toBe('Thursday 1 October');
    expect(dayLine('2026-10-01', 'ar')).toBe('الخميس 1 أكتوبر');
  });
});
