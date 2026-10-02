import 'package:flutter/widgets.dart';

import 'settings.dart';

/// Every word the app shows, in English and Arabic. Short plain sentences.
/// Numbers and times stay Latin in both languages.
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
  String get oneMoment => _('One moment…', 'لحظة…');
  String get justNow => _('Updated just now', 'تم التحديث الآن');
  String minutesAgo(int m) => _('Updated $m min ago', 'آخر تحديث منذ $m د');
  String stepOf(int a, int b) => _('Step $a of $b', 'الخطوة $a من $b');
  String get pwHelp => _('At least 8 characters.', '8 أحرف على الأقل.');
  String get otherLanguage => _('عربي', 'English');
  String get offline => _('Can’t reach the school right now. Pull down to try again.', 'تعذّر الوصول للمدرسة الآن. اسحب لأسفل للمحاولة مرة أخرى.');

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
  String get signInSub => _('Use the email you gave the school.', 'استخدم البريد الذي أعطيته للمدرسة.');
  String get forgot => _('Forgot password?', 'نسيت كلمة المرور؟');
  String get newHere => _('New here?', 'جديد هنا؟');
  String get createAccount => _('Create your account', 'أنشئ حسابك');
  String get staffOnly => _('This app is for parents. Staff use the school dashboard.', 'هذا التطبيق لأولياء الأمور. يستخدم الموظفون لوحة المدرسة.');

  // create account
  String get regEmail => _('It must be the email the school registered for you.', 'يجب أن يكون البريد الذي سجلته المدرسة لك.');
  String get sendMe => _('Send me a code', 'أرسل لي رمزًا');
  String get checkEmail => _('Check your email', 'افحص بريدك');
  String get codeSub => _('If the school registered this email, we sent a 6-digit code to', 'إن كانت المدرسة سجلت هذا البريد، أرسلنا رمزًا من 6 أرقام إلى');
  String get codeFromEmail => _('Code from the email', 'الرمز من البريد');
  String get mobileWa => _('Mobile number (WhatsApp)', 'رقم الموبايل (واتساب)');
  String get sendWa => _('Send a WhatsApp code', 'إرسال رمز واتساب');
  String get noEmailT => _('No email?', 'لم يصل البريد؟');
  String get noEmail => _('Check your spam folder. If nothing arrives, ask the school to check your email address.', 'افحص الرسائل غير المرغوبة. إن لم يصل شيء، اطلب من المدرسة مراجعة بريدك.');
  String get waTitle => _('Enter the WhatsApp code', 'أدخل رمز واتساب');
  String get waSub => _('We sent a 6-digit code on WhatsApp to', 'أرسلنا رمزًا من 6 أرقام على واتساب إلى');
  String get waCode => _('WhatsApp code', 'رمز واتساب');
  String get choosePw => _('Choose a password', 'اختر كلمة مرور');
  String get createBtn => _('Create account', 'إنشاء الحساب');
  String get fixNumber => _('No code, or wrong number? Fix the number and send again', 'لم يصل الرمز أو الرقم خطأ؟ صحّح الرقم وأرسل مرة أخرى');

  // forgot password
  String get resetTitle => _('Reset your password', 'إعادة تعيين كلمة المرور');
  String get resetSub => _('Enter the email you sign in with. We’ll send you a 6-digit code.', 'أدخل البريد الذي تدخل به. سنرسل لك رمزًا من 6 أرقام.');
  String get newPw => _('New password', 'كلمة المرور الجديدة');
  String get resetBtn => _('Save and sign in', 'حفظ والدخول');
  String resendIn(String t) => _('Send a new code in $t', 'إرسال رمز جديد بعد $t');
  String get resendNow => _('Send a new code', 'إرسال رمز جديد');
  String get codeSent => _('A new code is on its way.', 'رمز جديد في الطريق.');

  // consent
  String get oneTime => _('Before you start', 'قبل أن تبدأ');
  String get consentTitle => _('How the strap works', 'كيف يعمل السوار');
  String consentBody(String? child) => child == null
      ? _('Your child wears a small strap at school. Readers at the gate and in each classroom hear it, so the school knows when your child arrives and which lesson they are in.',
          'يرتدي طفلك سوارًا صغيرًا في المدرسة. أجهزة عند البوابة وفي كل فصل تلتقطه، فتعرف المدرسة متى وصل وفي أي حصة هو.')
      : _('$child wears a small strap at school. Readers at the gate and in each classroom hear it, so the school knows when $child arrives and which lesson they are in.',
          'يرتدي $child سوارًا صغيرًا في المدرسة. أجهزة عند البوابة وفي كل فصل تلتقطه، فتعرف المدرسة وقت الوصول وفي أي حصة.');
  String get c1 => _('When your child comes in and goes out of the school gate', 'وقت الدخول والخروج من بوابة المدرسة');
  String get c2 => _('Which classroom they are in, during school hours', 'الفصل الذي يوجد فيه خلال اليوم الدراسي');
  String get c3 => _('Nothing outside school. No sound, no camera.', 'لا شيء خارج المدرسة. لا صوت ولا كاميرا.');
  String get c4 => _('Detailed location data is deleted after one week. Attendance is kept.', 'بيانات المكان التفصيلية تُحذف بعد أسبوع. ويُحفظ الحضور.');
  String get agree => _('I agree', 'أوافق');
  String get notNow => _('Not now', 'ليس الآن');

  // tabs
  String get tabDay => _('Child’s day', 'يوم طفلي');
  String get tabNotifs => _('Notifications', 'الإشعارات');
  String get tabAccount => _('Account', 'الحساب');

  // child's day
  String get arrived => _('Arrived at school', 'الوصول إلى المدرسة');
  String get notArrived => _('Not arrived yet', 'لم يصل بعد');
  String get throughGate => _('Through the school gate', 'من بوابة المدرسة');
  String leftAt(String t) => _('Went out through the gate at $t', 'خرج من البوابة $t');
  String nowIn(String where) => _('In $where', 'في $where');
  String nowInLesson(String subject, String room) => _('In $subject in $room', 'في حصة $subject بـ$room');
  String heardAt(String t) => _('Heard there at $t.', 'رُصد هناك $t.');
  String get lessons => _('Today’s lessons', 'حصص اليوم');
  String get noLessons => _('No lessons today.', 'لا توجد حصص اليوم.');
  String get noChildren => _('No children are linked to your account yet. Ask the school.', 'لا يوجد أطفال مرتبطون بحسابك بعد. اسأل المدرسة.');
  String p(int n) => 'P$n';
  String period(int n) => _('Period $n', 'الحصة $n');
  String get inLesson => _('In the lesson', 'في الحصة');
  String get now => _('Now', 'الآن');
  String get later => _('Later', 'لاحقًا');
  String get notMarked => _('Not marked yet', 'لم يُسجل بعد');
  String status(String s) => switch (s) {
        'PRESENT' => _('Present', 'حاضر'),
        'LATE' => _('Late', 'متأخر'),
        'ABSENT' => _('Absent', 'غائب'),
        'EXCUSED' => _('Excused', 'بعذر'),
        'ON_TRIP' => _('On a trip', 'في رحلة'),
        _ => s,
      };

  // notifications
  String get markAllRead => _('Mark all read', 'تحديد الكل كمقروء');
  String get unread => _('Unread', 'غير مقروء');
  String get today => _('Today', 'اليوم');
  String get yesterday => _('Yesterday', 'أمس');
  String get noNotifs => _('No notifications yet. They show up here as things happen.', 'لا توجد إشعارات بعد. ستظهر هنا فور حدوثها.');
  /// A notification's sentence, written here so it reads well in both languages.
  /// Falls back to the server's English title for anything it doesn't know.
  String notification(String type, String name, Map<String, dynamic> data, String fallback) {
    final subject = data['subject'] as String?;
    final room = data['room'] as String?;
    final where = subject != null && room != null ? _('$subject in $room', '$subject في $room') : null;
    return switch (type) {
      'attendance.arrived' => _('$name arrived at school', 'وصول $name إلى المدرسة'),
      'attendance.absent' => _('$name is absent today', 'غياب $name اليوم'),
      'attendance.left' => _('$name left school early', 'خروج $name من المدرسة مبكرًا'),
      'attendance.lessonAbsent' when where != null => _('$name was absent from $where', 'غياب $name عن حصة $where'),
      'attendance.lessonPresent' when where != null => _('$name is in $where', '$name في حصة $where'),
      _ => isAr ? fallback : fallback,
    };
  }

  // account
  String get name => _('Name', 'الاسم');
  String get mobile => _('Mobile', 'الموبايل');
  String get notSet => _('Not set', 'غير مضاف');
  String get checkedWa => _('Checked on WhatsApp', 'تم التحقق عبر واتساب');
  String get notChecked => _('Not checked yet', 'لم يُتحقق بعد');
  String get changeMobile => _('Change mobile', 'تغيير الموبايل');
  String get language => _('Language', 'اللغة');
  String get langName => _('English', 'العربية');
  String get signOut => _('Sign out', 'تسجيل الخروج');
  String get newMobileSub => _('We’ll send a WhatsApp code to the new number.', 'سنرسل رمز واتساب إلى الرقم الجديد.');
  String get newMobile => _('New mobile number', 'رقم الموبايل الجديد');
  String get confirm => _('Confirm', 'تأكيد');
  String get doneA => _('Your mobile is now', 'رقم موبايلك الآن');
  String get doneC => _('The school has been told.', 'تم إبلاغ المدرسة.');
  String get done => _('Done', 'تم');
}
