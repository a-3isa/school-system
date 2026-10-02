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
  String get appName => _('School', 'المدرسة');
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
  String get newHere => _('First time here?', 'أول مرة؟');
  String get createAccount => _('Create your account', 'إنشاء حساب');
  String get staffOnly => _('This app is for parents and guardians. Members of staff, please use the school dashboard.', 'هذا التطبيق مخصّص لأولياء الأمور. يُرجى من فريق العمل استخدام لوحة المدرسة.');

  // create account
  String get regEmail => _('Please use the email address the school has on file for you.', 'يُرجى استخدام البريد الإلكتروني المسجّل لكم لدى المدرسة.');
  String get sendMe => _('Send me a code', 'إرسال الرمز');
  String get checkEmail => _('Please check your email', 'يُرجى مراجعة بريدكم الإلكتروني');
  String get codeSub => _('If this address is registered with the school, a 6-digit code has been sent to', 'إن كان هذا البريد مسجّلًا لدى المدرسة، فقد أُرسل رمز من 6 أرقام إلى');
  String get codeFromEmail => _('Code from the email', 'الرمز الوارد في البريد');
  String get mobileWa => _('Mobile number (WhatsApp)', 'رقم الهاتف (واتساب)');
  String get sendWa => _('Send a code by WhatsApp', 'إرسال الرمز عبر واتساب');
  String get noEmailT => _('No email?', 'لم تصلكم الرسالة؟');
  String get noEmail => _('Please check your spam folder. If nothing arrives, the school office will be happy to confirm your email address.', 'يُرجى مراجعة مجلد الرسائل غير المرغوب فيها. وإن لم تصل الرسالة، يسعد مكتب المدرسة بتأكيد بريدكم الإلكتروني.');
  String get waTitle => _('Enter the WhatsApp code', 'أدخلوا رمز واتساب');
  String get waSub => _('A 6-digit code has been sent by WhatsApp to', 'أُرسل رمز من 6 أرقام عبر واتساب إلى');
  String get waCode => _('WhatsApp code', 'رمز واتساب');
  String get choosePw => _('Choose a password', 'اختيار كلمة المرور');
  String get createBtn => _('Create account', 'إنشاء الحساب');
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
  String get oneTime => _('Welcome', 'أهلًا بكم');
  String get consentTitle => _('About the smart band', 'عن السوار الذكي');
  String consentBody(String? child) => child == null
      ? _('Your child wears a discreet smart band at school. Readers at the gate and in each classroom detect it, so you know when your child arrives and which lesson they are in.',
          'يرتدي ابنكم سوارًا ذكيًا صغيرًا في المدرسة، ترصده أجهزة عند البوابة وفي كل فصل، فتطمئنون إلى وقت وصوله والحصة التي يحضرها.')
      : _('$child wears a discreet smart band at school. Readers at the gate and in each classroom detect it, so you know when $child arrives and which lesson they are in.',
          'يرتدي $child سوارًا ذكيًا صغيرًا في المدرسة، ترصده أجهزة عند البوابة وفي كل فصل، فتطمئنون إلى وقت الوصول والحصة الحالية.');
  String get c1 => _('When your child arrives and leaves through the school gate', 'موعد الوصول والانصراف من بوابة المدرسة');
  String get c2 => _('Which classroom they are in, during school hours only', 'الفصل الحالي، خلال اليوم الدراسي فقط');
  String get c3 => _('Nothing outside school. No microphone, no camera.', 'لا شيء خارج المدرسة. لا ميكروفون ولا كاميرا.');
  String get c4 => _('Detailed location data is deleted after one week; attendance records are kept.', 'تُحذف بيانات المكان التفصيلية بعد أسبوع، ويُحتفظ بسجل الحضور.');
  String get agree => _('I agree', 'أوافق');
  String get notNow => _('Not now', 'لاحقًا');

  // tabs
  String get tabDay => _('Today', 'اليوم الدراسي');
  String get tabNotifs => _('Notifications', 'الإشعارات');
  String get tabAccount => _('Account', 'حسابي');

  // child's day
  String get arrived => _('Arrived at school', 'الوصول إلى المدرسة');
  String get notArrived => _('Not yet arrived', 'لم يُسجَّل الوصول بعد');
  String get throughGate => _('Through the school gate', 'من بوابة المدرسة');
  String leftAt(String t, [String? gender]) => _('Left through the school gate at $t', switch (gender) { 'FEMALE' => 'غادرت المدرسة الساعة $t', 'MALE' => 'غادر المدرسة الساعة $t', _ => 'الانصراف من المدرسة الساعة $t' });
  String nowIn(String where) => _('In $where', 'في $where');
  String nowInLesson(String subject, String room) => _('In $subject, $room', 'في حصة $subject، $room');
  String heardAt(String t) => _('Last seen there at $t.', 'آخر رصد الساعة $t.');
  String get lessons => _('Today’s lessons', 'حصص اليوم');
  String get noLessons => _('No lessons today.', 'لا توجد حصص اليوم.');
  String get noChildren => _('No children are linked to your account yet. Please contact the school office.', 'لا يوجد أبناء مرتبطون بحسابكم بعد. يُرجى التواصل مع مكتب المدرسة.');
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
      'attendance.arrived' => _('$name has arrived at school', g('وصل $name إلى المدرسة', 'وصلت $name إلى المدرسة', 'وصول $name إلى المدرسة')),
      'attendance.absent' => _('$name is marked absent today', 'سُجِّل غياب $name اليوم'),
      'attendance.left' => _('$name left school early', g('غادر $name المدرسة مبكرًا', 'غادرت $name المدرسة مبكرًا', 'انصراف $name من المدرسة مبكرًا')),
      'attendance.lessonAbsent' when where != null => _('$name hasn’t joined $where', g('لم يحضر $name حصة $where', 'لم تحضر $name حصة $where', 'عدم حضور $name حصة $where')),
      'attendance.lessonPresent' when where != null => _('$name is now in $where', '$name الآن في حصة $where'),
      _ => fallback,
    };
  }

  // account
  String get name => _('Name', 'الاسم');
  String get mobile => _('Mobile number', 'رقم الهاتف');
  String get notSet => _('Not set', 'غير مضاف');
  String get checkedWa => _('Verified via WhatsApp', 'تم التأكيد عبر واتساب');
  String get notChecked => _('Not yet verified', 'لم يُؤكَّد بعد');
  String get changeMobile => _('Change mobile number', 'تغيير رقم الهاتف');
  String get language => _('Language', 'اللغة');
  String get langName => _('English', 'العربية');
  String get signOut => _('Sign out', 'تسجيل الخروج');
  String get newMobileSub => _('We will send a WhatsApp code to the new number.', 'سنرسل رمز تأكيد عبر واتساب إلى الرقم الجديد.');
  String get newMobile => _('New mobile number', 'رقم الهاتف الجديد');
  String get confirm => _('Confirm', 'تأكيد');
  String get doneA => _('Your mobile number is now', 'رقم هاتفكم الآن');
  String get doneC => _('The school has been informed.', 'وقد أُبلغت المدرسة بذلك.');
  String get done => _('Done', 'تم');
}
