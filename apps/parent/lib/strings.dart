import 'package:flutter/widgets.dart';

import 'settings.dart';

/// Every word the app shows, in English and Arabic: warm, courteous and reassuring,
/// in the register of Egypt's private schools. Arabic verbs agree with the child's
/// gender when the school has recorded it. Numbers and times stay Latin.
class S {
  const S._(this.lang);
  final String lang;

  static const en = S._('en');
  static const ar = S._('ar');

  static S of(BuildContext context) => Settings.of(context).lang == 'ar' ? ar : en;

  bool get isAr => lang == 'ar';
  String _(String e, String a) => isAr ? a : e;

  // common
  String get appName => _('Parent app', 'تطبيق أولياء الأمور');
  /// "Good morning, Dina": by the hour in Cairo, with the parent's first name.
  String greeting(int hour, String? fullName) {
    final first = fullName?.trim().split(RegExp(r'\s+')).first;
    final hello = hour < 12 ? _('Good morning', 'صباح الخير') : hour < 17 ? _('Good afternoon', 'نهاركم سعيد') : _('Good evening', 'مساء الخير');
    return first == null || first.isEmpty ? hello : _('$hello, $first', '$hello، $first');
  }
  String get back => _('Back', 'رجوع');
  String get email => _('Email', 'البريد الإلكتروني');
  String get password => _('Password', 'كلمة المرور');
  String get oneMoment => _('Just a moment…', 'لحظات من فضلك…');
  String get justNow => _('Updated just now', 'تم التحديث الآن');
  String minutesAgo(int m) => _('Updated $m min ago', 'آخر تحديث منذ $m د');
  String stepOf(int a, int b) => _('Step $a of $b', 'الخطوة $a من $b');
  String get pwHelp => _('At least 8 characters.', '8 أحرف على الأقل.');
  String get otherLanguage => _('عربي', 'English');
  String get offline => _('We can’t reach the school at the moment. Please pull down to try again.', 'تعذّر الاتصال بالمدرسة حاليًا. يُرجى السحب لأسفل للمحاولة مجددًا.');

  /// "Thursday 1 October" / "الخميس 1 أكتوبر" for a YYYY-MM-DD date.
  String dayLine(String date) {
    final d = DateTime.parse(date);
    const enDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const arDays = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    return '${(isAr ? arDays : enDays)[d.weekday - 1]} ${dayMonth(date)}';
  }

  /// "1 October" / "1 أكتوبر".
  String dayMonth(String date) {
    final d = DateTime.parse(date);
    const enMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const arMonths = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return '${d.day} ${(isAr ? arMonths : enMonths)[d.month - 1]}';
  }

  // sign in
  String get signIn => _('Sign in', 'تسجيل الدخول');
  String get signInSub => _('Please use the email address registered with the school.', 'يُرجى استخدام البريد الإلكتروني المسجّل لدى المدرسة.');
  String get forgot => _('Forgot password?', 'نسيت كلمة المرور؟');
  String get newHere => _('New to the parent app?', 'أول مرة في تطبيق أولياء الأمور؟');
  String get createAccount => _('Activate your account', 'تفعيل حسابكم');
  String get staffOnly => _('This app is for parents and guardians. Members of staff, please use the school dashboard.', 'هذا التطبيق مخصّص لأولياء الأمور. يُرجى من فريق العمل استخدام لوحة المدرسة.');

  // create account
  String get regEmail => _('Use the email you registered with the school.', 'يُرجى استخدام البريد الإلكتروني المسجّل لدى المدرسة.');
  String get sendMe => _('Send me a code', 'إرسال الرمز');
  String get checkEmail => _('Please check your email', 'يُرجى مراجعة بريدكم الإلكتروني');
  String get codeSub => _('If this address is registered with the school, a 6-digit code has been sent to', 'إن كان هذا البريد مسجّلًا لدى المدرسة، فقد أُرسل رمز من 6 أرقام إلى');
  String get codeFromEmail => _('Code from the email', 'الرمز الوارد في البريد');
  String get mobileWa => _('Mobile number (WhatsApp)', 'رقم الهاتف (واتساب)');
  String get sendWa => _('Send a code by WhatsApp', 'إرسال الرمز عبر واتساب');
  String get noEmailT => _('No email?', 'لم تصلكم الرسالة؟');
  String get noEmail => _('Check your spam folder. Still nothing? Contact Student Affairs to confirm your email.', 'يُرجى مراجعة مجلد الرسائل غير المرغوب فيها. وإن لم تصل الرسالة، يُرجى التواصل مع شؤون الطلبة لتأكيد بريدكم.');
  String get waTitle => _('Enter the WhatsApp code', 'أدخلوا رمز واتساب');
  String get waSub => _('A 6-digit code has been sent by WhatsApp to', 'أُرسل رمز من 6 أرقام عبر واتساب إلى');
  String get waCode => _('WhatsApp code', 'رمز واتساب');
  String get choosePw => _('Choose a password', 'اختيار كلمة المرور');
  String get createBtn => _('Activate account', 'تفعيل الحساب');
  String get fixNumber => _('No code, or the wrong number? Correct it and send again', 'لم يصل الرمز أو الرقم غير صحيح؟ صحّحوا الرقم وأعيدوا الإرسال');

  // forgot password
  String get resetTitle => _('Reset your password', 'إعادة تعيين كلمة المرور');
  String get resetSub => _('Enter the email address you sign in with and we will send you a 6-digit code.', 'أدخلوا البريد الإلكتروني المستخدم لتسجيل الدخول، وسنرسل إليكم رمزًا من 6 أرقام.');
  String get newPw => _('New password', 'كلمة المرور الجديدة');
  String get resetBtn => _('Save and sign in', 'حفظ والدخول');
  String resendIn(String t) => _('Send a new code in $t', 'إرسال رمز جديد بعد $t');
  String get resendNow => _('Send a new code', 'إرسال رمز جديد');
  String get codeSent => _('A new code is on its way.', 'تم إرسال رمز جديد.');

  // consent
  String get oneTime => _('Before you begin', 'قبل أن تبدأوا');
  String get consentTitle => _('How the smart band works', 'كيف يعمل السوار الذكي');
  /// [gender] is the child's (MALE or FEMALE) when the school recorded it.
  String consentBody(String? child, [String? gender]) {
    final (she, wears) = switch (gender) { 'FEMALE' => ('she', 'ترتدي'), 'MALE' => ('he', 'يرتدي'), _ => ('they', 'يرتدي') };
    final is_ = she == 'they' ? 'are' : 'is';
    return child == null
        ? _('Your child wears a smart ID band at school. Readers at the gate and in each classroom detect it, so you know your child arrived safely and which lesson they are in.',
            'يرتدي أبناؤكم سوارًا ذكيًا في المدرسة، ترصده أجهزة عند البوابة وفي كل فصل، لتطمئنوا على وصولهم وتعرفوا الحصة التي يحضرونها.')
        : _('$child wears a smart ID band at school. Readers at the gate and in each classroom detect it, so you know $she arrived safely and which lesson $she $is_ in.',
            '$wears $child سوارًا ذكيًا في المدرسة، ترصده أجهزة عند البوابة وفي كل فصل، لتطمئنوا على الوصول وتعرفوا الحصة الحالية.');
  }
  String c1([String? gender]) => _('When ${switch (gender) { 'FEMALE' => 'she enters', 'MALE' => 'he enters', _ => 'your child enters' }} and leaves through the school gate', 'وقت الدخول والخروج من بوابة المدرسة');
  String get c2 => _('Which classroom your child is in during school hours', 'الفصل الذي يوجد فيه الطالب خلال اليوم الدراسي');
  String get c3 => _('Nothing outside school. No microphone, no camera, no GPS.', 'لا شيء خارج المدرسة. لا ميكروفون ولا كاميرا ولا GPS.');
  String get c4 => _('Detailed location data is deleted after one week; attendance records are kept.', 'تُحذف بيانات المكان التفصيلية بعد أسبوع، ويُحتفظ بسجل الحضور.');
  String get agree => _('I agree', 'أوافق');
  String get notNow => _('Not now', 'لاحقًا');

  // tabs
  String get tabDay => _('Today', 'اليوم');
  String get tabMessages => _('Messages', 'الرسائل');
  String get tabSchool => _('School', 'المدرسة');
  String get tabNotifs => _('Notifications', 'الإشعارات');
  String get tabAccount => _('Account', 'الحساب');

  // messages and school hubs
  String get schoolNothingYet => _('Nothing here yet.', 'لا يوجد شيء هنا بعد.');
  String get tileGrades => _('Grades', 'الدرجات');
  String get tileBehaviour => _('Behaviour', 'السلوك');
  String get tileClubs => _('Clubs', 'الأندية');
  String get tileTrips => _('Trips', 'الرحلات');
  String get tileCalendar => _('Calendar', 'التقويم');
  String get tileMeetings => _('Meetings', 'المقابلات');

  // child's day
  String arrived([String? gender]) => _('Arrived safely at school', switch (gender) { 'FEMALE' => 'وصلت المدرسة بالسلامة', 'MALE' => 'وصل المدرسة بالسلامة', _ => 'الوصول إلى المدرسة بالسلامة' });
  String get notArrived => _('Not yet arrived', 'لم يُسجَّل الوصول بعد');
  String get throughGate => _('Through the school gate', 'من بوابة المدرسة');
  String leftAt(String t, [String? gender]) => _('Left through the school gate at $t', switch (gender) { 'FEMALE' => 'غادرت المدرسة الساعة $t', 'MALE' => 'غادر المدرسة الساعة $t', _ => 'الانصراف من المدرسة الساعة $t' });
  String nowIn(String where) => _('In $where', 'في $where');
  String nowInLesson(String subject, String room) => _('In $subject · $room', 'في حصة $subject · $room');
  String heardAt(String t) => _('Last seen there at $t.', 'آخر رصد الساعة $t.');
  String inClassAt(String t) => _('Detected in class at $t.', 'رُصد في الفصل الساعة $t.');
  String get lessons => _('Today’s lessons', 'حصص اليوم');
  String get noLessons => _('No lessons today.', 'لا توجد حصص اليوم.');
  String get noChildren => _('No children are linked to your account yet. Please contact Student Affairs.', 'لا يوجد أبناء مرتبطون بحسابكم بعد. يُرجى التواصل مع شؤون الطلبة.');
  String p(int n) => 'P$n';
  String period(int n) => _('Period $n', 'الحصة $n');
  String get inLesson => _('In the lesson', 'في الحصة');
  String get now => _('Now', 'الآن');
  String get later => _('Later', 'لاحقًا');
  String get notMarked => _('Not yet recorded', 'لم يُسجَّل بعد');
  String status(String s) => switch (s) {
        'PRESENT' => _('Present', 'حاضر'),
        'LATE' => _('Late', 'متأخر'),
        'ABSENT' => _('Absent', 'غائب'),
        'EXCUSED' => _('Excused', 'بعذر'),
        'ON_TRIP' => _('On a trip', 'في رحلة'),
        _ => s,
      };

  // notifications
  String get markAllRead => _('Mark all as read', 'تمييز الكل كمقروء');
  String get unread => _('Unread', 'غير مقروء');
  String get today => _('Today', 'اليوم');
  String get yesterday => _('Yesterday', 'أمس');
  String get noNotifs => _('No notifications yet. Updates from the school will appear here.', 'لا توجد إشعارات بعد. ستظهر هنا مستجدات المدرسة.');
  /// A notification's sentence, written here so it reads well in both languages.
  /// Falls back to the server's English title for anything it doesn't know.
  /// [gender] is the child's (MALE or FEMALE) when the school recorded it, so the
  /// Arabic verb agrees; without it the sentence uses a noun instead.
  String notification(String type, String name, Map<String, dynamic> data, String fallback, [String? gender]) {
    final subject = data['subject'] as String?;
    final room = data['room'] as String?;
    final where = subject != null && room != null ? _('$subject in $room', '$subject في $room') : null;
    String g(String boy, String girl, String neutral) => switch (gender) { 'MALE' => boy, 'FEMALE' => girl, _ => neutral };
    return switch (type) {
      'attendance.arrived' => _('$name arrived safely at school', g('وصل $name المدرسة بالسلامة', 'وصلت $name المدرسة بالسلامة', 'وصول $name إلى المدرسة بالسلامة')),
      'attendance.absentCheck' => _('$name didn’t come to school today. Do you know why?', g('لم يحضر $name إلى المدرسة اليوم. هل تعلمون السبب؟', 'لم تحضر $name إلى المدرسة اليوم. هل تعلمون السبب؟', 'لم يُسجَّل حضور $name اليوم. هل تعلمون السبب؟')),
      'excuse.approved' => _('The school accepted $name’s excuse', 'قبلت المدرسة عذر $name'),
      'excuse.rejected' => _('The school did not accept $name’s excuse', 'لم تقبل المدرسة عذر $name'),
      'attendance.absent' => _('$name is absent today', g('$name غائب اليوم', '$name غائبة اليوم', 'سُجِّل غياب $name اليوم')),
      'attendance.left' => _('$name left school early', g('غادر $name المدرسة مبكرًا', 'غادرت $name المدرسة مبكرًا', 'انصراف $name من المدرسة مبكرًا')),
      'attendance.lessonAbsent' when where != null => _('$name missed $where. Student Affairs is following up.', '${g('غاب $name عن', 'غابت $name عن', 'غياب $name عن')} حصة $where. وتتابع شؤون الطلبة الأمر.'),
      'attendance.lessonPresent' when subject != null && room != null => _('$name is back in $subject, $room', '${g('عاد $name إلى', 'عادت $name إلى', 'عودة $name إلى')} حصة $subject ب$room'),
      'announcement.new' => _('New from the school: ${data['title']}', 'جديد من المدرسة: ${data['title']}'),
      'announcement.emergency' => _('Urgent from the school: ${data['title']}', 'عاجل من المدرسة: ${data['title']}'),
      'poll.new' => _('The school asks your opinion: ${data['question']}', 'تودّ المدرسة معرفة رأيكم: ${data['question']}'),
      'message.new' => _('New message from ${data['from']} about $name', 'رسالة جديدة من ${data['from']} بشأن $name'),
      'marks.published' when data['subject'] != null && data['title'] != null => _('New mark for $name in ${data['subject']}: ${data['title']}', 'درجة جديدة لـ$name في ${data['subject']}: ${data['title']}'),
      'reportCard.published' when data['term'] == 1 || data['term'] == 2 => _('$name’s report card for term ${data['term']} is ready', 'صدرت شهادة $name عن الفصل الدراسي ${data['term'] == 1 ? 'الأول' : 'الثاني'}'),
      'behaviour.note' => switch (data['kind']) {
          'PRAISE' => _('Well done! A note of praise for $name', 'أحسنتم! ثناء من المدرسة على $name'),
          'INCIDENT' => _('Student Affairs has written to you about $name', 'تواصلت شؤون الطلبة معكم بشأن $name'),
          _ => _('A note from school about $name', 'ملاحظة من المدرسة بشأن $name'),
        },
      'meeting.cancelled' when data['teacher'] != null && data['date'] != null && data['time'] != null => _(
          'Your meeting with ${data['teacher']} on ${dayLine(data['date'] as String)} at ${data['time']} was cancelled',
          'أُلغي موعد مقابلتكم مع ${data['teacher']} يوم ${dayLine(data['date'] as String)} الساعة ${_ltr(data['time'] as String)}'),
      _ => fallback,
    };
  }

  /// Notifications that are about the school, not about one child, so they read the same without a child.
  static const schoolNotificationTypes = {'announcement.new', 'announcement.emergency', 'poll.new', 'meeting.cancelled'};

  // messaging
  String _ltr(String s) => '${String.fromCharCode(0x2066)}$s${String.fromCharCode(0x2069)}';

  /// Arabic counts: the noun changes with the number (صوت واحد، صوتان، 3 أصوات، 11 صوتًا).
  String _arCount(int n, String one, String two, String few, String many) {
    final r = n % 100;
    if (n == 1) return one;
    if (n == 2) return two;
    if (r >= 3 && r <= 10) return '$n $few';
    return '$n $many';
  }

  String get newsTab => _('School news', 'أخبار المدرسة');
  String get chatsTab => _('Conversations', 'المحادثات');
  String get noNews => _('Nothing from the school yet.', 'لا توجد رسائل من المدرسة بعد.');
  String get urgent => _('Urgent', 'عاجل');
  String get haveRead => _('I have read this', 'اطلعتُ على الرسالة');
  String get pdfAttachment => _('This message has a PDF attached. You can ask the school office for a copy.', 'مع هذه الرسالة ملف PDF مرفق. يمكنكم طلب نسخة منه من مكتب المدرسة.');
  String get poll => _('Poll', 'استطلاع');
  String get sendAnswer => _('Send my answer', 'إرسال إجابتي');
  String get thanksAnswer => _('Thank you. Your answer has been received.', 'شكرًا لكم، وصلت إجابتكم.');
  String get pollClosed => _('This poll has closed.', 'انتهى هذا الاستطلاع.');
  String get pickOne => _('Choose one answer', 'اختاروا إجابة واحدة');
  String get pickMany => _('You can choose more than one answer', 'يمكنكم اختيار أكثر من إجابة');
  String votesN(int n) => _(n == 1 ? '1 vote' : '$n votes', _arCount(n, 'صوت واحد', 'صوتان', 'أصوات', 'صوتًا'));

  String get noChats => _('No conversations yet.', 'لا توجد محادثات بعد.');
  String get newMessage => _('New message', 'رسالة جديدة');
  String contactsFor(String child) => _('Who would you like to write to about $child?', 'مع من تودّون التواصل بشأن $child؟');
  String get classTeacher => _('Class teacher', 'رائد الفصل');
  String get studentAffairs => _('Student Affairs', 'شؤون الطلبة');
  String get noContacts => _('There is nobody to write to yet. Please contact the school.', 'لا يوجد من يمكن مراسلته بعد. يُرجى التواصل مع المدرسة.');
  String officeHours(String from, String to) => _('Usually replies between $from and $to', 'الرد عادةً بين ${_ltr(from)} و${_ltr(to)}');
  String get typeMessage => _('Write a message', 'اكتبوا رسالة');
  String get send => _('Send', 'إرسال');
  String get seen => _('Seen', 'تمت القراءة');
  String get earlier => _('Earlier messages', 'رسائل أقدم');
  String get fileTooBig => _('The file is larger than 5 MB.', 'حجم الملف أكبر من 5 ميجابايت.');
  String get attachment => _('Attachment', 'مرفق');
  String aboutChild(String name) => _('About $name', 'بشأن $name');
  /// A member of staff as they are addressed: "Ms. Hana Nabil" / «مس Hana Nabil».
  String staffName(Map<String, dynamic> u) {
    final name = u['name'] as String? ?? '';
    final title = switch (u['honorific']) {
      'MR' => _('Mr.', 'مستر'),
      'MS' => _('Ms.', 'مس'),
      'MRS' => _('Mrs.', 'مدام'),
      'DR' => _('Dr.', 'د.'),
      _ => null,
    };
    return title == null ? name : '$title $name';
  }

  String get meetingsTitle => _('Parent meetings', 'مقابلات أولياء الأمور');
  String get yourMeetings => _('Your meetings', 'مقابلاتكم');
  String get noMeetings => _('You have no meetings booked.', 'لا توجد مقابلات محجوزة.');
  String get freeTimes => _('Free times', 'المواعيد المتاحة');
  String get noFreeTimes => _('No free times at the moment.', 'لا توجد مواعيد متاحة حاليًا.');
  String get bookThis => _('Book this time', 'حجز هذا الموعد');
  String get meetingNote => _('Note for the teacher (optional)', 'ملاحظة للمعلم (اختيارية)');
  String get meetingBooked => _('Your meeting is booked.', 'تم حجز موعدكم.');
  String get cancelMeeting => _('Cancel meeting', 'إلغاء المقابلة');
  String get meetingCancelled => _('Your meeting was cancelled.', 'تم إلغاء المقابلة.');
  String meetingAt(String time, String place) => _('$time · $place', '${_ltr(time)} · $place');

  // behaviour
  String get behaviourTitle => _('Behaviour', 'السلوك');
  String get behaviourPraise => _('Praise', 'ثناء');
  String get behaviourConcerns => _('To follow up', 'للمتابعة');
  String get behaviourPoints => _('Merit points', 'نقاط التميز');
  String get behaviourThisYear => _('This school year', 'العام الدراسي الحالي');
  String get noBehaviour => _('No notes yet. Notes from teachers will appear here.', 'لا توجد ملاحظات بعد. ستظهر هنا ملاحظات المعلمين.');
  String behaviourKind(String kind) => switch (kind) {
        'PRAISE' => _('Praise', 'ثناء'),
        'INCIDENT' => _('From Student Affairs', 'من شؤون الطلبة'),
        _ => _('Note', 'ملاحظة'),
      };
  String behaviourCategory(String category) => switch (category) {
        'KINDNESS' => _('Kindness', 'اللطف'),
        'EFFORT' => _('Effort', 'الاجتهاد'),
        'ACHIEVEMENT' => _('Achievement', 'التفوق'),
        'PARTICIPATION' => _('Participation', 'المشاركة'),
        'LEADERSHIP' => _('Leadership', 'القيادة'),
        'HELPING' => _('Helping others', 'مساعدة الآخرين'),
        'HOMEWORK' => _('Homework', 'الواجبات'),
        'PUNCTUALITY' => _('Punctuality', 'الالتزام بالمواعيد'),
        'DISRUPTION' => _('Class conduct', 'الانضباط في الفصل'),
        'UNIFORM' => _('Uniform', 'الزي المدرسي'),
        'EQUIPMENT' => _('Equipment', 'الأدوات'),
        'RESPECT' => _('Respect', 'الاحترام'),
        'FIGHT' => _('Fighting', 'شجار'),
        'BULLYING' => _('Bullying', 'تنمر'),
        'DAMAGE' => _('Damage', 'إتلاف'),
        'SAFETY' => _('Safety', 'السلامة'),
        _ => _('Other', 'أخرى'),
      };
  String behaviourSeverity(String severity) => switch (severity) {
        'SERIOUS' => _('Serious', 'جسيمة'),
        'MODERATE' => _('Moderate', 'متوسطة'),
        _ => _('Minor', 'بسيطة'),
      };
  String get behaviourNew => _('New', 'جديد');
  String get behaviourAction => _('What the school did', 'ما اتخذته المدرسة');
  /// "+3" / "−2": merit points of one note, always Latin digits.
  String behaviourPointsN(int n) {
    final v = '${n > 0 ? '+' : n < 0 ? '−' : ''}${n.abs()}';
    return isAr ? _ltr(v) : v;
  }

  // grades, exams and report cards
  String get gradesTitle => _('Grades', 'الدرجات');
  String get gradesSub => _('Marks your teachers have published', 'الدرجات التي نشرها المعلمون');
  String termShort(int n) => _('Term $n', n == 1 ? 'الفصل الأول' : 'الفصل الثاني');
  String termLong(int n) => _('Term $n', 'الفصل الدراسي ${n == 1 ? 'الأول' : 'الثاني'}');
  String get overallGrade => _('Overall', 'المجموع العام');
  String get noGrades => _('No marks have been published for this term yet.', 'لم تُنشر درجات هذا الفصل الدراسي بعد.');
  String get noTrend => _('A progress line appears once there are two marks.', 'يظهر خط التقدم بعد وجود درجتين.');
  String get progressLine => _('Progress', 'التقدم');
  String assessmentKind(String kind) => switch (kind) {
        'CLASSWORK' => _('Classwork', 'أعمال الفصل'),
        'QUIZ' => _('Quiz', 'اختبار قصير'),
        'HOMEWORK' => _('Homework', 'واجب'),
        'PROJECT' => _('Project', 'مشروع'),
        'MIDTERM' => _('Midterm exam', 'امتحان منتصف الفصل'),
        'FINAL' => _('Final exam', 'امتحان نهاية الفصل'),
        _ => kind,
      };
  String get upcomingExams => _('Upcoming exams', 'الامتحانات القادمة');
  String get noUpcomingExams => _('No exams are scheduled.', 'لا توجد امتحانات مجدولة.');
  String get reportCardsTitle => _('Report cards', 'الشهادات');
  String get noReportCards => _('No report cards have been published yet.', 'لم تُنشر شهادات بعد.');
  String reportCardFor(int term, String year) => _('Term $term · $year', '${termLong(term)} · ${_ltr(year)}');
  String get reportCard => _('Report card', 'شهادة الفصل الدراسي');
  String get studentIdLabel => _('Student ID', 'كود الطالب');
  String get yearGroupLabel => _('Year group', 'الصف الدراسي');
  String get classLabel => _('Class', 'الفصل');
  String get yearLabel => _('Academic year', 'العام الدراسي');
  String get termLabel => _('Term', 'الفصل الدراسي');
  String get subjectLabel => _('Subject', 'المادة');
  String get gradeLabel => _('Grade', 'التقدير');
  String get teacherCommentLabel => _('Teacher’s comment', 'تعليق المعلم');
  String get classTeacherComment => _('Class teacher’s comment', 'تعليق رائد الفصل');
  String get principalComment => _('Principal’s comment', 'تعليق مدير المدرسة');
  String get classTeacherLabel => _('Class teacher', 'رائد الفصل');
  String get principalLabel => _('Principal', 'مدير المدرسة');
  String get noMarkYet => _('No mark yet', 'لا توجد درجة بعد');
  String gpa(num n) => _('GPA ${n.toStringAsFixed(2)}', 'المعدل التراكمي ${_ltr(n.toStringAsFixed(2))}');
  String issuedOn(String date) => _('Issued ${dayLine(date)}', 'صدرت بتاريخ ${dayLine(date)}');
  /// "20 days, absent 2": Arabic counts change with the number.
  String attendanceLine(int days, int absent) {
    String d(int n) => isAr ? (n == 0 ? '0 يوم' : _arCount(n, 'يوم واحد', 'يومان', 'أيام', 'يومًا')) : (n == 1 ? '1 day' : '$n days');
    return _('Attendance: ${d(days)}, absent $absent', 'الحضور: ${d(days)}، الغياب: ${d(absent)}');
  }
  String attendanceDetail(int present, int late, int excused) => _('Present $present · Late $late · Excused $excused', 'حضور $present · تأخر $late · بعذر $excused');
  /// 85 → "85%", 67.5 → "67.5%"; always Latin digits.
  String pct(num p) {
    final v = '${p == p.roundToDouble() ? p.round() : p}%';
    return isAr ? _ltr(v) : v;
  }
  /// The score of one assessment, "17 / 20".
  String scoreOf(num score, num max) {
    String f(num n) => n == n.roundToDouble() ? '${n.round()}' : '$n';
    final v = '${f(score)} / ${f(max)}';
    return isAr ? _ltr(v) : v;
  }
  /// A band's name in this language.
  String bandName(Map<String, dynamic>? band) => band == null ? '—' : (isAr ? band['labelAr'] : band['label']) as String;
  /// "Ms. Hana Nabil" → «مس Hana Nabil» in Arabic.
  String titledName(String? name) {
    if (name == null || !isAr) return name ?? '';
    final m = RegExp(r'^(Mr|Ms|Mrs|Dr)\.\s+(.*)$').firstMatch(name);
    if (m == null) return name;
    return '${const {'Mr': 'مستر', 'Ms': 'مس', 'Mrs': 'مدام', 'Dr': 'د.'}[m.group(1)]} ${m.group(2)}';
  }

  // account
  String get name => _('Name', 'الاسم');
  String get mobile => _('Mobile', 'رقم الهاتف');
  String get notSet => _('Not set', 'غير مضاف');
  String get checkedWa => _('Checked on WhatsApp', 'تم التحقق عبر واتساب');
  String get notChecked => _('Not yet verified', 'لم يُؤكَّد بعد');
  String get changeMobile => _('Change mobile', 'تغيير رقم الهاتف');
  String get language => _('Language', 'اللغة');
  String get langName => _('English', 'العربية');
  String get signOut => _('Sign out', 'تسجيل الخروج');
  String get newMobileSub => _('We will send a WhatsApp code to the new number.', 'سنرسل رمز تأكيد عبر واتساب إلى الرقم الجديد.');
  String get newMobile => _('New mobile number', 'رقم الهاتف الجديد');
  String get confirm => _('Confirm', 'تأكيد');
  String get doneA => _('Your mobile number is now', 'رقم هاتفكم الآن');
  String get doneC => _('Student Affairs has been notified.', 'وقد أُبلغت شؤون الطلبة بذلك.');
  String get done => _('Done', 'تم');

  // excuses
  String get excusesTitle => _('Excuses', 'الأعذار');
  String get sendExcuse => _('Send an excuse', 'إرسال عذر');
  String get newExcuse => _('New excuse', 'عذر جديد');
  String excuseFor(String child) => _('For $child', 'عن غياب $child');
  String get fromDay => _('From', 'من');
  String get toDay => _('To', 'إلى');
  String get reasonLabel => _('Reason', 'السبب');
  String reason(String r) => switch (r) {
        'SICK' => _('Illness', 'مرض'),
        'APPOINTMENT' => _('Appointment', 'موعد'),
        'FAMILY' => _('Family reason', 'ظرف عائلي'),
        'OTHER' => _('Other', 'سبب آخر'),
        _ => r,
      };
  String get noteLabel => _('Note (optional)', 'ملاحظة (اختيارية)');
  String get noteHelp => _('For example: fever since last night, seen by the doctor.', 'مثال: ارتفاع في الحرارة منذ الليلة الماضية، وقد عُرض على الطبيب.');
  String get attach => _('Attach a photo or PDF', 'إرفاق صورة أو ملف PDF');
  String get attachHelp => _('Optional. A doctor’s note helps the school accept the excuse.', 'اختياري. تساعد شهادة الطبيب المدرسة على قبول العذر.');
  String get attachChange => _('Choose another file', 'اختيار ملف آخر');
  String get removeFile => _('Remove', 'إزالة');
  String get excuseWindow => _('You can send an excuse up to 7 days after an absence, or ahead of time.', 'يمكنكم إرسال العذر حتى 7 أيام بعد الغياب، أو مقدّمًا.');
  String get sendIt => _('Send the excuse', 'إرسال العذر');
  String get excuseSent => _('The excuse was sent', 'تم إرسال العذر');
  String get excuseSentSub => _('Student Affairs will look at it and let you know.', 'ستراجعه شؤون الطلبة وتُبلغكم بالقرار.');
  String get noExcuses => _('No excuses sent yet.', 'لم يُرسَل أي عذر بعد.');
  String get excusesSub => _('Excuses you sent, and what the school decided.', 'الأعذار التي أرسلتموها وقرار المدرسة بشأنها.');
  String excuseDays(String from, String to) => from == to ? dayMonth(from) : _('${dayMonth(from)} to ${dayMonth(to)}', 'من ${dayMonth(from)} إلى ${dayMonth(to)}');
  String excuseStatus(String st) => switch (st) {
        'PENDING' => _('Waiting for the school', 'بانتظار قرار المدرسة'),
        'APPROVED' => _('Accepted', 'مقبول'),
        'REJECTED' => _('Not accepted', 'غير مقبول'),
        _ => st,
      };

  // the "didn't come" question
  String didntCome(String child, [String? gender]) =>
      _('$child didn’t come to school today', switch (gender) { 'FEMALE' => 'لم تحضر $child إلى المدرسة اليوم', 'MALE' => 'لم يحضر $child إلى المدرسة اليوم', _ => 'لم يُسجَّل حضور $child اليوم' });
  String get doYouKnow => _('Do you know why?', 'هل تعلمون السبب؟');
  String get yesIKnow => _('Yes, I know', 'نعم، أعلم');
  String get noIDont => _('No, I don’t', 'لا، لا أعلم');
  String get asked15 => _('If we don’t hear from you, the school will call you.', 'إن لم نسمع منكم فستتصل بكم المدرسة.');
  String get schoolWillCall => _('The school has been told and will call you now. If you hear from your child, please call the school.', 'أُبلغت المدرسة وستتصل بكم الآن. إن علمتم بمكان ابنكم أو ابنتكم يُرجى الاتصال بالمدرسة.');
  String get pleaseExcuse => _('Thank you. Please send an excuse so the school can record the absence.', 'شكرًا لكم. يُرجى إرسال عذر ليسجّل المدرسة الغياب.');
  String excusePending(String child) => _('Your excuse for $child is waiting for the school.', 'عذر $child بانتظار قرار المدرسة.');
  String get excuseAccepted => _('The school accepted your excuse.', 'قبلت المدرسة عذركم.');
  String excuseRejected(String? why) => _('The school did not accept the excuse.${why == null ? '' : ' $why'}', 'لم تقبل المدرسة العذر.${why == null ? '' : ' $why'}');
  String get sendNewExcuse => _('Send a new excuse', 'إرسال عذر جديد');
}
