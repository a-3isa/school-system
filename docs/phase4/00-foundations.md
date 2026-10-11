# PR 0 · Foundations

Branch `feature/phase4-foundations`. This PR is small and shared by every later PR. **It has no schema change and no migration.**

## Goal

- The registry knows the new features and the plan presets.
- Every app can show and hide screens by feature, not only by module.
- One helper turns an audience ("Primary 4", "class 4/1", "the whole school") into parents.
- The dashboard teacher gets a menu.
- The parent app gets a five-tab bar and a shared selected child.

## 1. API

### 1.1 Registry (`apps/api/src/platform/registry.ts`)

Replace the `activities`, `behavior` and `messaging` entries:

```ts
// Trips with permission slips and the events calendar belong to activities.
activities: { key: 'activities', name: 'Activities & clubs', requires: ['core'], features: { paidActivities: false, trips: true, events: true } },
behavior: { key: 'behavior', name: 'Behaviour & notes', requires: ['core'], features: { clinic: true, merits: true } },
// Announcements and the emergency broadcast are always part of messaging;
// chat, polls and meetings come with the full Messaging of the Complete plan.
messaging: { key: 'messaging', name: 'Messaging', requires: ['core'], features: { chat: true, polls: true, meetings: true } },
```

Add the plan presets after `PLAN_MODULES`:

```ts
// Features each plan sets when a school signs up or changes plan. Only
// subscription features belong here; anything else stays the school's choice.
const FULL_MESSAGING = { chat: true, polls: true, meetings: true };
const ANNOUNCEMENTS_ONLY = { chat: false, polls: false, meetings: false };
export const PLAN_FEATURES: Record<Plan, Partial<Record<ModuleKey, Record<string, boolean>>>> = {
  ESSENTIALS: { messaging: ANNOUNCEMENTS_ONLY },
  SMART: { messaging: ANNOUNCEMENTS_ONLY },
  COMPLETE: { messaging: FULL_MESSAGING },
};

/** A module's features as a school on `plan` starts with them. */
export function planFeatures(plan: Plan, key: ModuleKey): Record<string, boolean> {
  return { ...MODULES[key].features, ...PLAN_FEATURES[plan][key] };
}
```

Extend the subscription features and add a helper:

```ts
export const SUBSCRIPTION_FEATURES: Partial<Record<ModuleKey, string[]>> = {
  attendance: ['automatic'],
  messaging: ['chat', 'polls', 'meetings'],
};
export function isSubscriptionFeature(key: ModuleKey, feature: string): boolean {
  return !!SUBSCRIPTION_FEATURES[key]?.includes(feature);
}
```

**`registry.spec.ts`:** add three tests.
- Every key in `PLAN_FEATURES` is a known feature of that module.
- Every preset feature is a subscription feature.
- `planFeatures('ESSENTIALS','messaging').chat === false` and `planFeatures('COMPLETE','messaging').chat === true`.

### 1.2 Applying plan features (`apps/api/src/platform/modules.ts`)

- **`apply()`** gets a new parameter: `apply(schoolId, enabled, tx = this.prisma, plan?: Plan)`.
  - When creating a row: `features: plan ? planFeatures(plan, key) : MODULES[key].features`.
  - When updating a row and `plan` is given: merge the plan's presets into the saved features, as `{ ...saved, ...PLAN_FEATURES[plan][key] }`. Read the saved row first. Only preset keys change; attendance `automatic` is untouched, as today.
- **`OwnerController.create`** and **`setPlan`** pass the plan through.
- **`setFeatures`** for a non-owner:
  - Use `isSubscriptionFeature`.
  - Pick the error message by module:
    - attendance keeps `'Automatic attendance comes with the subscription. Ask the platform owner.'`;
    - anything else gets `'This comes with the subscription. Ask the platform owner.'`.
- **`list()`** is unchanged. It already merges defaults, so schools created before this PR get `meetings: true`. That's fine, because no production schools exist yet.

### 1.3 Guard message (`apps/api/src/auth/access.guard.ts`)

When the feature is off:
- attendance/automatic keeps today's sentence;
- anything else throws `ForbiddenException('This isn’t part of this school’s subscription.')`. Use the typographic apostrophe, as in the other messages.

Add to `SERVER_AR` (`apps/web/lib/i18n.tsx`):

```ts
[/^This isn’t part of this school’s subscription\.$/, () => 'هذه الخدمة ليست ضمن اشتراك المدرسة.'],
[/^This comes with the subscription\. Ask the platform owner\.$/, () => 'هذه الخدمة جزء من الاشتراك. يُرجى التواصل مع مالك المنصة.'],
[/^(.+) isn’t switched on for this school\.$/, (_, m) => `خدمة «${m}» غير مفعّلة لهذه المدرسة.`],
```

### 1.4 `/auth/me` returns features (`apps/api/src/auth/auth.ts`, `me()`)

Add `features: Record<string, Record<string, boolean>>`. Its keys are the **enabled** modules and its values are the merged features (`{ ...MODULES[key].features, ...row.features }`). Keep `modules` and `straps` as they are.

### 1.5 Audience helper (`apps/api/src/common/audience.ts`, new)

```ts
export type AudienceKind = 'SCHOOL' | 'GRADES' | 'CLASSES' | 'ACTIVITY';
export class AudienceDto {
  @IsIn(['SCHOOL','GRADES','CLASSES','ACTIVITY']) kind: AudienceKind;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(200) ids?: string[];
}
export interface Reach { students: { id: string; gender: Gender | null; firstName: string }[]; parentIds: string[]; pairs: { parentId: string; studentId: string }[] }

@Injectable()
export class AudienceService {
  /** Active students in the audience, and their unrestricted parents (G36). */
  async reach(schoolId: string, a: AudienceDto): Promise<Reach>
  /** Throws BadRequest if ids are missing for GRADES/CLASSES/ACTIVITY, or any id isn't this school's. */
  async validate(schoolId: string, a: AudienceDto): Promise<void>
  /** Does this parent's child fall in the audience? (for showing a saved announcement/poll/event) */
  async includesParent(schoolId: string, a: AudienceDto, parentId: string): Promise<boolean>
}
```

- **Student filter by kind:**
  - SCHOOL: `{ schoolId, active: true }`;
  - GRADES: `class: { gradeId: { in: ids } }`;
  - CLASSES: `classId: { in: ids }`;
  - ACTIVITY: `activityEnrolments: { some: { activityId: { in: ids }, status: 'ENROLLED' } }`.
- **ACTIVITY before PR 4.** That model doesn't exist until PR 4. Until then, `validate` rejects ACTIVITY with `'Clubs aren’t available yet.'`, and PR 4 fills it in. Keep the switch exhaustive so PR 4 only edits one case.
- **Parents:** `guardians: { where: { restricted: false } }`. Deduplicate `parentIds`.
- **Errors:** `'Choose at least one year group or class.'` and `'Year group or class not found.'`
- **Module:** export it from a `@Global()` `CommonModule` registered in `app.module.ts`, or add it to an existing global module. Either works; keep one.
- **Unit test** (`common/audience.spec.ts`): mock Prisma with a jest object, as other unit specs do, or keep the logic small and test `validate` messages. **E2e coverage** comes from PR 1.

## 2. Dashboard

### 2.1 Session (`apps/web/lib/session.tsx`)

- Add `features: Record<string, Record<string, boolean>>` to `Me`.
- Add the helper `has(me, module, feature?)`: `me.modules.includes(module) && (!feature || !!me.features?.[module]?.[feature])`.

### 2.2 Shell (`apps/web/components/Shell.tsx`)

- **`NavItem`:** add `feature?: string`, and use `has()` in the filter.
- **Roles:**
  - Add `SOCIAL_WORKER` to `SCHOOL_WIDE` (the API already treats it as staff).
  - Add `const STAFF = [...SCHOOL_WIDE, 'TEACHER']`.
- **Teacher menu.** Replace the "teacher has one screen and no menu" branch. Teachers now get the normal sidebar, filtered to the items whose `roles` include `TEACHER`:
  - `/class` becomes a nav item `{ href: '/class', key: 'myClass', roles: ['TEACHER'] }` in a new first group `teaching`;
  - the teacher's home stays `/class`;
  - `allowed` uses the same `current` logic for everyone;
  - delete the `solo` layout branch, but keep the `solo` CSS if anything else uses it (search first).
- **New groups.** Leave `href`s for later PRs out until those PRs add the pages. A link to a missing page breaks navigation, so each later PR adds its own items. **This PR adds only the group keys and strings.**
- **`count`:** make the union extensible: `count?: 'exceptions' | 'excuses' | 'messages'`. PR 1 fills `messages`.

### 2.3 Shared components

- **`components/Modal.tsx`:**
  - Use `<dialog>` with `showModal()`. Props: `open`, `onClose`, `title`, `children`, `actions`.
  - Esc closes it, and focus returns to the opener.
  - Style `.modal` in `globals.css`: `--surface` background, 1px `--line` border, radius 10, no shadow, a `::backdrop` with rgba(27,42,78,.35), and max-inline-size 560px.
- **`components/AudiencePicker.tsx`:**
  - Props: `{ value: { kind, ids }, onChange, allowActivity?: boolean, activities?: {id,name}[] }`.
  - Radio chips (`.chips` / `.chip-toggle`) for Whole school / Year groups / Classes / Club.
  - Year groups come from `useApi('/grades')` as chip toggles.
  - Classes use the existing `byStage` grouping from `ClassPicker.tsx`, as multi-select chip toggles grouped by stage.
  - Show the summary line `t.audience.summary(kind, n)`.
- **Strings (`strings.ts`, en + ar):**

```ts
audience: {
  label: 'Who is it for?', SCHOOL: 'Whole school', GRADES: 'Year groups', CLASSES: 'Classes', ACTIVITY: 'A club',
  // summary: "Whole school" | "2 year groups" | "3 classes" | "Chess club"
}
// ar: label: 'إلى من؟', SCHOOL: 'المدرسة كلها', GRADES: 'صفوف دراسية', CLASSES: 'فصول', ACTIVITY: 'نادٍ'
// ar summary uses arN(n, 'صف دراسي واحد', 'صفّان دراسيان', 'صفوف دراسية', 'صفًا دراسيًا') and arN(n, 'فصل واحد', 'فصلان', 'فصول', 'فصلًا')
```

### 2.4 Nav and feature strings

Add to `nav`. Groups: `teaching`, `academics`, `messages`, `behaviour`, `activities`. Items: `myClass`. Later PRs add their own item keys.

| key | en | ar |
|---|---|---|
| teaching | Teaching | التدريس |
| myClass | My class | فصلي |
| academics | Academics | الشؤون الأكاديمية |
| messages | Messages | الرسائل |
| behaviour | Behaviour | السلوك |
| activities | Activities | الأنشطة |

Add to `modules.features`:

| key | en | ar |
|---|---|---|
| meetings | Parent–teacher meetings | مقابلات أولياء الأمور |
| trips | Trips and permission slips | الرحلات وموافقات أولياء الأمور |
| events | Events calendar | تقويم الفعاليات |

The modules page reads the subscription features from a list. Find the place that shows "In your subscription" for `automatic` and show the same for `chat`, `polls` and `meetings`.

## 3. Parent app

### 3.1 `lib/api.dart`

- Add `put`, `patch` and `delete` alongside `get`/`post`, using `_send`.
- Add a generic multipart helper, and rewrite `sendExcuse` to use it (behaviour unchanged):

```dart
Future<dynamic> upload(String path, Map<String, String> fields, {String? fileName, Uint8List? fileBytes, String method = 'POST'})
```

### 3.2 Shared state (`screens/home.dart`)

- **`HomeData`:**
  - Add `String? childId` (the selected child) and `void selectChild(String id)`, which calls `notifyListeners`.
  - Default to the first child after `load()` when it's null or no longer in the list.
  - Add `bool has(String module, [String? feature])`, reading `me['modules']` and `me['features']`.
- **`DayTab`:** use `data.childId` instead of its private `_childId`. Move `_ChildSwitch` to `widgets.dart` as public `ChildSwitch(data)`, so every per-child screen can show it.

### 3.3 Tab bar

- Replace `_TabBar` with a Material 3 `NavigationBar`, themed with `Palette`:
  - `backgroundColor: c.surface`, `indicatorColor: c.primary.withOpacity(.12)`;
  - icons and labels in `c.ink2`, and `c.primary` when selected;
  - a top border `c.line`.
- **Tabs, in order:**

| Tab | Icon | Shown when | en | ar |
|---|---|---|---|---|
| Today | `Icons.wb_sunny_outlined` | always | Today | اليوم |
| Messages | `Icons.forum_outlined` | `has('messaging')` | Messages | الرسائل |
| School | `Icons.school_outlined` | any of academics, behavior, activities, `messaging.meetings` | School | المدرسة |
| Notifications | `Icons.notifications_none` + `Badge` with unread | always | Notifications | الإشعارات |
| Account | `Icons.person_outline` | always | Account | الحساب |

- Keep the existing `tabDay` / `tabNotifs` / `tabAccount` strings, re-worded to the short labels above if they differ. Add `tabMessages` and `tabSchool`.
- Keep `IndexedStack`, and build the list of tabs from the visible ones.
- **Placeholders in this PR:**
  - `MessagesTab` is a placeholder `Empty`-style screen saying "Messages from the school will appear here." / «ستظهر هنا رسائل المدرسة.».
  - `SchoolTab` (`screens/school.dart`) is a list of tiles, each shown only when its module/feature is on:
    - Grades, Behaviour, Clubs, Trips, Calendar, Meetings;
    - each tile opens a placeholder until its PR replaces it;
    - hide tiles whose PR hasn't landed: keep a `const _ready = <String>{}` set, and each PR adds its tile key.

### 3.4 Shared widgets (`lib/widgets.dart`)

- Promote `_Notice` from `screens/day.dart` to public `Notice` with the same API, and update `day.dart` to use it.
- Add `Panel({child, padding})`: surface, line border, `Brand.radius`. Use it for new cards instead of repeating the decoration.
- Add `EmptyState({icon, title, body})` for empty lists.

### 3.5 Tests (`test/widget_test.dart`)

1. With `me.modules = ['core','attendance']`, the bar shows Today/Notifications/Account only.
2. With messaging + academics, it shows all five.
3. Selecting a child on Today keeps the selection when switching tabs and back.

Update the existing tests if the tab labels changed.

## 4. Docs

- **`PLAN.md` §8:** add T1–T7 from `docs/phase4/README.md`.
- **`docs/SYSTEM.md`:**
  - Teachers now have a menu.
  - The parent app has five tabs.
  - Note which messaging features each plan has.

## Done when

- `/check` is green.
- An Essentials school's `/auth/me` shows `features.messaging.chat === false`.
- A Complete school's shows `true`.
- A teacher signs in to the dashboard and sees a sidebar with "My class".
