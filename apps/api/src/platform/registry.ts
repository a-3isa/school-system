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
  requires: ModuleKey[];
  // Feature switches inside the module and their default values.
  features: Record<string, boolean>;
}

export const MODULES: Record<ModuleKey, ModuleDefinition> = {
  core: { key: 'core', name: 'Core', requires: [], features: { excelImport: true } },
  attendance: {
    key: 'attendance',
    name: 'Attendance',
    requires: ['core'],
    // automatic = BLE gateways; off = manual marking on classroom PCs only.
    features: { automatic: false, leaveEarlyAlerts: true },
  },
  transport: { key: 'transport', name: 'Transport', requires: ['core', 'attendance'], features: { liveMapForParents: true } },
  canteen: { key: 'canteen', name: 'Canteen & wallet', requires: ['core', 'payments'], features: { parentalControls: true } },
  payments: { key: 'payments', name: 'Payments & fees', requires: ['core'], features: { tuitionFees: false } },
  // Trips with permission slips and the events calendar belong to activities.
  activities: { key: 'activities', name: 'Activities & clubs', requires: ['core'], features: { paidActivities: false, trips: true, events: true } },
  academics: { key: 'academics', name: 'Academics', requires: ['core'], features: { reportCards: true } },
  homework: { key: 'homework', name: 'Homework', requires: ['core', 'academics'], features: {} },
  behavior: { key: 'behavior', name: 'Behaviour & notes', requires: ['core'], features: { clinic: true, merits: true } },
  // Announcements and the emergency broadcast are always part of messaging;
  // chat, polls and meetings come with the full Messaging of the Complete plan.
  messaging: { key: 'messaging', name: 'Messaging', requires: ['core'], features: { chat: true, polls: true, meetings: true } },
  admissions: { key: 'admissions', name: 'Admissions', requires: ['core', 'payments'], features: {} },
  reports: { key: 'reports', name: 'Reports & analytics', requires: ['core'], features: {} },
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
