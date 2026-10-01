import 'package:flutter/material.dart';

/// The product's look: warm ivory ground, near-black ink, clay accent.
class Brand {
  static const ground = Color(0xFFFAF9F5);
  static const surface = Colors.white;
  static const ink = Color(0xFF141413);
  static const muted = Color(0xFF5E5D59);
  static const line = Color(0x1F1F1E1D);
  static const clay = Color(0xFFD97757);
  static const okBg = Color(0xFFE4EDDA), ok = Color(0xFF35592A);
  static const warnBg = Color(0xFFF5E9C8), warn = Color(0xFF71500A);
  static const alertBg = Color(0xFFF7DDD3), alert = Color(0xFF973A1F);
  static const infoBg = Color(0xFFDEE7F3), info = Color(0xFF24528F);

  static ThemeData theme() {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: clay, surface: ground, primary: ink),
      scaffoldBackgroundColor: ground,
    );
    return base.copyWith(
      appBarTheme: const AppBarTheme(backgroundColor: ground, foregroundColor: ink, elevation: 0, scrolledUnderElevation: 0),
      textTheme: base.textTheme.copyWith(
        headlineMedium: const TextStyle(fontFamily: 'serif', fontSize: 30, fontWeight: FontWeight.w500, color: ink),
        titleMedium: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: ink),
      ),
      cardTheme: const CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(16)), side: BorderSide(color: line)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: ink,
          foregroundColor: ground,
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

/// Colours and words for an attendance status.
({String label, Color fg, Color bg}) statusStyle(String status) => switch (status) {
      'PRESENT' => (label: 'Present', fg: Brand.ok, bg: Brand.okBg),
      'LATE' => (label: 'Late', fg: Brand.warn, bg: Brand.warnBg),
      'ABSENT' => (label: 'Absent', fg: Brand.alert, bg: Brand.alertBg),
      'EXCUSED' => (label: 'Excused', fg: Brand.info, bg: Brand.infoBg),
      'ON_TRIP' => (label: 'On a trip', fg: Brand.info, bg: Brand.infoBg),
      _ => (label: status, fg: Brand.muted, bg: Brand.line),
    };
