# Design handoff (v2)

The design the dashboard and the parent app follow: **"Ivory, Oxford navy & a crest. The school's own register."**

It was exported from Claude Design. Only the current version (v2) is kept here; the earlier "Limestone & lapis" direction (v1) is no longer followed and is in git history only.

| File | What it shows |
|---|---|
| `Direction and Components.dc.html` | Colour tokens (light and dark), status system, type scale, spacing, radius, every component |
| `Staff Dashboard.dc.html` | Every dashboard screen, with all English and Arabic strings in its script |
| `Teacher Screens.dc.html` | The classroom PC: with smart bands, the manual register, and between periods |
| `Staff Sign In.dc.html` | Dashboard sign-in and forgotten password |
| `Parent App.dc.html` / `Parent Screen.dc.html` | Every parent app screen in English, Arabic, light and dark |

These are prototypes: read the HTML and CSS for exact values. Don't copy the structure.

## Where the build deliberately differs, and why

- **Arabic** stays in polite Modern Standard Arabic. The prototypes are sometimes colloquial.
- **The consent screen** keeps "detailed location data is deleted after one week" (decision H38). It does not say "switch this off from your account", because the app has no such switch.
- **The "Teacher" role** stays "Teacher". In this product "Class teacher" means a class's homeroom teacher (رائد الفصل).
- **Features added after the design** use the same tokens and components. These are the Parents and Classes pages, the enrolment form, school structure and year, crest upload, and staff titles.
