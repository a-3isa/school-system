import 'package:flutter/material.dart';

/// The look of a good private school's stationery: warm ivory, deep navy for
/// actions, a little brass-gold for distinction, and a colour, a glyph and a word
/// for every status. Dark mode lifts the navy, the gold and the tints.
@immutable
class Palette extends ThemeExtension<Palette> {
  const Palette({
    required this.bg, required this.surface, required this.sunk, required this.line,
    required this.ink, required this.ink2, required this.ink3,
    required this.primary, required this.onPrimary, required this.unread, required this.gold,
    required this.pFg, required this.pBg, required this.lFg, required this.lBg,
    required this.aFg, required this.aBg, required this.eFg, required this.eBg,
    required this.tFg, required this.tBg,
  });

  final Color bg, surface, sunk, line, ink, ink2, ink3, primary, onPrimary, unread, gold;
  final Color pFg, pBg, lFg, lBg, aFg, aBg, eFg, eBg, tFg, tBg;

  static const light = Palette(
    bg: Color(0xFFF6F3EC), surface: Color(0xFFFFFFFF), sunk: Color(0xFFECE7DC), line: Color(0xFFE2DCCF),
    ink: Color(0xFF172033), ink2: Color(0xFF4E5566), ink3: Color(0xFF6A7080),
    primary: Color(0xFF1C2E5A), onPrimary: Color(0xFFFFFFFF), unread: Color(0xFFF3F5F9), gold: Color(0xFF86662A),
    pFg: Color(0xFF23683F), pBg: Color(0xFFE2EFE5), lFg: Color(0xFF8A5A00), lBg: Color(0xFFF8ECD2),
    aFg: Color(0xFFA3291F), aBg: Color(0xFFF8E3DF), eFg: Color(0xFF4A5566), eBg: Color(0xFFE6E9EE),
    tFg: Color(0xFF3B5876), tBg: Color(0xFFE2EAF1),
  );

  static const dark = Palette(
    bg: Color(0xFF0F1420), surface: Color(0xFF161C29), sunk: Color(0xFF0A0F19), line: Color(0xFF283041),
    ink: Color(0xFFECE7DC), ink2: Color(0xFFB3B2AC), ink3: Color(0xFF8E8E8A),
    primary: Color(0xFF9DB3E3), onPrimary: Color(0xFF0F1420), unread: Color(0xFF182032), gold: Color(0xFFD4B475),
    pFg: Color(0xFF7FCB98), pBg: Color(0xFF1E3326), lFg: Color(0xFFE6B75A), lBg: Color(0xFF3A2E14),
    aFg: Color(0xFFF08A7B), aBg: Color(0xFF3D1F1B), eFg: Color(0xFFAEB7C4), eBg: Color(0xFF262B32),
    tFg: Color(0xFF9DB8D6), tBg: Color(0xFF1F2A36),
  );

  @override
  Palette copyWith() => this;

  @override
  Palette lerp(ThemeExtension<Palette>? other, double t) => t < .5 || other is! Palette ? this : other;

  /// Colours and glyph for an attendance status.
  ({Color fg, Color bg, String glyph}) status(String status) => switch (status) {
        'PRESENT' => (fg: pFg, bg: pBg, glyph: '✓'),
        'LATE' => (fg: lFg, bg: lBg, glyph: '◔'),
        'ABSENT' => (fg: aFg, bg: aBg, glyph: '×'),
        'EXCUSED' => (fg: eFg, bg: eBg, glyph: '–'),
        'ON_TRIP' => (fg: tFg, bg: tBg, glyph: '↗'),
        _ => (fg: ink2, bg: sunk, glyph: '·'),
      };
}

extension PaletteOf on BuildContext {
  Palette get c => Theme.of(this).extension<Palette>()!;
}

class Brand {
  static const font = 'IBMPlexSans';
  static const fallback = ['IBMPlexSansArabic'];
  static const radius = 10.0;

  /// The serif for titles and figures: Source Serif in English, Naskh in Arabic.
  static TextStyle display(BuildContext context, {double size = 26, FontWeight weight = FontWeight.w600, Color? color, double height = 1.25}) {
    final arabic = Directionality.of(context) == TextDirection.rtl;
    return TextStyle(
      fontFamily: arabic ? 'NotoNaskhArabic' : 'SourceSerif4',
      fontFamilyFallback: arabic ? const ['SourceSerif4'] : const ['NotoNaskhArabic'],
      fontSize: size,
      fontWeight: arabic && weight == FontWeight.w600 ? FontWeight.w700 : weight,
      fontVariations: [FontVariation('wght', (arabic && weight == FontWeight.w600 ? 700 : weight.value).toDouble())],
      height: arabic ? height + .25 : height,
      letterSpacing: arabic ? 0 : -.2,
      color: color,
    );
  }

  static ThemeData theme(Brightness brightness, {required bool arabic}) {
    final c = brightness == Brightness.dark ? Palette.dark : Palette.light;
    // Arabic first when the app is in Arabic, so Arabic shapes come from the Arabic face.
    final family = arabic ? 'IBMPlexSansArabic' : font;
    final fallback = arabic ? const [font] : Brand.fallback;
    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      fontFamily: family,
      fontFamilyFallback: fallback,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: c.primary, onPrimary: c.onPrimary,
        secondary: c.primary, onSecondary: c.onPrimary,
        error: c.aFg, onError: c.surface,
        surface: c.bg, onSurface: c.ink,
      ),
      scaffoldBackgroundColor: c.bg,
      extensions: [c],
    );
    final border = OutlineInputBorder(borderRadius: BorderRadius.circular(Brand.radius), borderSide: BorderSide(color: c.line));
    return base.copyWith(
      textTheme: base.textTheme.apply(bodyColor: c.ink, displayColor: c.ink, fontFamily: family),
      dividerColor: c.line,
      progressIndicatorTheme: ProgressIndicatorThemeData(color: c.primary),
      textSelectionTheme: TextSelectionThemeData(cursorColor: c.primary),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
        border: border,
        enabledBorder: border,
        focusedBorder: border.copyWith(borderSide: BorderSide(color: c.primary, width: 2)),
        errorBorder: border.copyWith(borderSide: BorderSide(color: c.aFg)),
        hintStyle: TextStyle(color: c.ink3),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: c.primary,
          foregroundColor: c.onPrimary,
          disabledBackgroundColor: c.sunk,
          disabledForegroundColor: c.ink3,
          minimumSize: const Size.fromHeight(52),
          textStyle: TextStyle(fontFamily: family, fontFamilyFallback: fallback, fontSize: 16, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radius)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: c.ink,
          minimumSize: const Size(0, 48),
          side: BorderSide(color: c.line),
          textStyle: TextStyle(fontFamily: family, fontFamilyFallback: fallback, fontSize: 15, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radius)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: c.primary,
          minimumSize: const Size(0, 44),
          padding: EdgeInsets.zero,
          alignment: AlignmentDirectional.centerStart,
          textStyle: TextStyle(fontFamily: family, fontFamilyFallback: fallback, fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
