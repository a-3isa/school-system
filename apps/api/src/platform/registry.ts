import { Plan } from '@prisma/client';

// The module catalog. Every capability belongs to one of these keys, and each
// school has only the modules its subscription includes. Core is always on.

export const MODULE_KEYS = [
  'core',
  'attendance',
  'transport',
  'canteen',
  'payments',
  'activities',
  'academics',
  'homework',
  'behavior',
  'messaging',
  'admissions',
  'reports',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDefinition {
  key: ModuleKey;
  name: string;
  // False while the module is not built yet: it is not listed and cannot be switched on.
  available: boolean;
  requires: ModuleKey[];
  // Feature switches inside the module and their default values.
  features: Record<string, boolean>;
}

export const MODULES: Record<ModuleKey, ModuleDefinition> = {
  core: { key: 'core', name: 'Core', available: true, requires: [], features: { excelImport: true } },
  attendance: {
    key: 'attendance',
    name: 'Attendance',
    available: true,
    requires: ['core'],
    // automatic = BLE gateways; off = manual marking on classroom PCs only.
    features: { automatic: false, leaveEarlyAlerts: true },
  },
  transport: { key: 'transport', name: 'Transport', available: false, requires: ['core', 'attendance'], features: { liveMapForParents: true } },
  canteen: { key: 'canteen', name: 'Canteen & wallet', available: false, requires: ['core', 'payments'], features: { parentalControls: true } },
  payments: { key: 'payments', name: 'Payments & fees', available: false, requires: ['core'], features: { tuitionFees: false } },
  // Trips with permission slips and the events calendar belong to activities.
  activities: { key: 'activities', name: 'Activities & clubs', available: true, requires: ['core'], features: { paidActivities: false, trips: true, events: true } },
  academics: { key: 'academics', name: 'Academics', available: true, requires: ['core'], features: { reportCards: true } },
  homework: { key: 'homework', name: 'Homework', available: false, requires: ['core', 'academics'], features: {} },
  behavior: { key: 'behavior', name: 'Behaviour & notes', available: true, requires: ['core'], features: { clinic: true, merits: true } },
  // Announcements and the emergency broadcast are always part of messaging;
  // chat, polls and meetings come with the full Messaging of the Complete plan.
  messaging: { key: 'messaging', name: 'Messaging', available: true, requires: ['core'], features: { chat: true, polls: true, meetings: true } },
  admissions: { key: 'admissions', name: 'Admissions', available: false, requires: ['core', 'payments'], features: {} },
  reports: { key: 'reports', name: 'Reports & analytics', available: false, requires: ['core'], features: {} },
};

// Plans are presets: the modules a school gets when it signs up for a plan.
export const PLAN_MODULES: Record<Plan, ModuleKey[]> = {
  ESSENTIALS: ['core', 'attendance', 'messaging'],
  SMART: ['core', 'attendance', 'messaging', 'transport', 'canteen', 'payments'],
  COMPLETE: [
    'core', 'attendance', 'messaging', 'transport', 'canteen', 'payments',
    'activities', 'academics', 'behavior', 'reports',
  ],
};

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

// The modules that exist today. PLAN_MODULES stays the commercial definition (what
// a plan will include once everything is built); availability applies where modules
// are written and listed.
export const AVAILABLE_KEYS: ModuleKey[] = MODULE_KEYS.filter((k) => MODULES[k].available);

// Switches inside a module that belong to something not built yet.
export const HIDDEN_FEATURES: Partial<Record<ModuleKey, string[]>> = { behavior: ['clinic'] };

/** A module's features: its defaults overlaid with the saved ones, without the hidden switches. */
export function visibleFeatures(key: ModuleKey, saved?: Record<string, boolean> | null): Record<string, boolean> {
  const merged = { ...MODULES[key].features, ...(saved ?? {}) };
  for (const f of HIDDEN_FEATURES[key] ?? []) delete merged[f];
  return merged;
}

export function isModuleKey(key: string): key is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(key);
}

/** Every module that `key` needs, directly or through its dependencies. */
export function requiredBy(key: ModuleKey): ModuleKey[] {
  const out = new Set<ModuleKey>();
  const visit = (k: ModuleKey) => {
    for (const dep of MODULES[k].requires) {
      if (!out.has(dep)) {
        out.add(dep);
        visit(dep);
      }
    }
  };
  visit(key);
  return [...out];
}

export type ToggleResult =
  | { ok: true; enabled: ModuleKey[]; alsoEnabled: ModuleKey[] }
  | { ok: false; reason: string; blockedBy?: ModuleKey[] };

/**
 * Applies turning one module on or off to a set of enabled modules.
 * Turning a module on also turns on everything it needs. A module can't be
 * turned off while an enabled module still needs it, and core never turns off.
 */
export function toggleModule(enabled: Iterable<ModuleKey>, key: ModuleKey, on: boolean): ToggleResult {
  const current = new Set(enabled);
  current.add('core');
  if (on) {
    const alsoEnabled = requiredBy(key).filter((d) => !current.has(d));
    [key, ...alsoEnabled].forEach((k) => current.add(k));
    return { ok: true, enabled: [...current], alsoEnabled };
  }
  if (key === 'core') return { ok: false, reason: 'Core is always on.' };
  const blockedBy = [...current].filter((k) => k !== key && MODULES[k].requires.includes(key));
  if (blockedBy.length) {
    return {
      ok: false,
      reason: `Turn off ${blockedBy.map((k) => MODULES[k].name).join(' and ')} first. It needs ${MODULES[key].name}.`,
      blockedBy,
    };
  }
  current.delete(key);
  return { ok: true, enabled: [...current], alsoEnabled: [] };
}

/**
 * Features that come with the subscription: only the platform owner switches
 * them. Automatic attendance means the school has straps and gateways.
 */
export const SUBSCRIPTION_FEATURES: Partial<Record<ModuleKey, string[]>> = {
  attendance: ['automatic'],
  messaging: ['chat', 'polls', 'meetings'],
};

export function isSubscriptionFeature(key: ModuleKey, feature: string): boolean {
  return !!SUBSCRIPTION_FEATURES[key]?.includes(feature);
}
