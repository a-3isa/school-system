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
  String get tabDay => _('At school', 'في المدرسة');
  String get tabNotifs => _('Notifications', 'الإشعارات');
  String get tabAccount => _('Account', 'حسابي');

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
      'attendance.absent' => _('$name is absent today', g('$name غائب اليوم', '$name غائبة اليوم', 'سُجِّل غياب $name اليوم')),
      'attendance.left' => _('$name left school early', g('غادر $name المدرسة مبكرًا', 'غادرت $name المدرسة مبكرًا', 'انصراف $name من المدرسة مبكرًا')),
      'attendance.lessonAbsent' when where != null => _('$name missed $where. Student Affairs is following up.', '${g('غاب $name عن', 'غابت $name عن', 'غياب $name عن')} حصة $where. وتتابع شؤون الطلبة الأمر.'),
      'attendance.lessonPresent' when subject != null && room != null => _('$name is back in $subject, $room', '${g('عاد $name إلى', 'عادت $name إلى', 'عودة $name إلى')} حصة $subject ب$room'),
      _ => fallback,
    };
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
}
