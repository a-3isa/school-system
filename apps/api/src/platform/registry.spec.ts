import { AVAILABLE_KEYS, MODULES, PLAN_FEATURES, PLAN_MODULES, isSubscriptionFeature, ModuleKey, planFeatures, requiredBy, toggleModule, visibleFeatures } from './registry';

describe('module registry', () => {
  it('offers only the modules that are built', () => {
    expect([...AVAILABLE_KEYS].sort()).toEqual(['academics', 'activities', 'attendance', 'behavior', 'core', 'messaging']);
  });

  it('never needs a module that is not built', () => {
    for (const key of AVAILABLE_KEYS) for (const dep of requiredBy(key)) expect(AVAILABLE_KEYS).toContain(dep);
  });

  it('hides the clinic switch until clinic visits exist', () => {
    expect(visibleFeatures('behavior', undefined)).toEqual({ merits: true });
    expect(visibleFeatures('behavior', { clinic: true, merits: false })).toEqual({ merits: false });
    expect(visibleFeatures('messaging', { chat: false })).toEqual({ chat: false, polls: true, meetings: true });
  });

  it('lists indirect dependencies', () => {
    expect(requiredBy('transport').sort()).toEqual(['attendance', 'core']);
    expect(requiredBy('homework').sort()).toEqual(['academics', 'core']);
  });

  it('turns on dependencies with a module', () => {
    const r = toggleModule(['core'], 'canteen', true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.enabled.sort()).toEqual(['canteen', 'core', 'payments']);
      expect(r.alsoEnabled).toEqual(['payments']);
    }
  });

  it('refuses to turn off a module another enabled module needs', () => {
    const r = toggleModule(['core', 'payments', 'canteen'], 'payments', false);
    expect(r).toEqual(expect.objectContaining({ ok: false, blockedBy: ['canteen'] }));
  });

  it('never turns off core', () => {
    expect(toggleModule(['core'], 'core', false).ok).toBe(false);
  });

  it('turns off a module nobody needs', () => {
    const r = toggleModule(['core', 'payments', 'canteen'], 'canteen', false);
    expect(r.ok && r.enabled.sort()).toEqual(['core', 'payments']);
  });

  it('keeps every plan consistent with dependencies', () => {
    for (const mods of Object.values(PLAN_MODULES)) {
      for (const m of mods) for (const d of requiredBy(m)) expect(mods).toContain(d);
    }
  });

  it('only presets features the module has, and only subscription features', () => {
    for (const presets of Object.values(PLAN_FEATURES)) {
      for (const [key, features] of Object.entries(presets) as [ModuleKey, Record<string, boolean>][]) {
        for (const feature of Object.keys(features)) {
          expect(Object.keys(MODULES[key].features)).toContain(feature);
          expect(isSubscriptionFeature(key, feature)).toBe(true);
        }
      }
    }
  });

  it('gives chat, polls and meetings to the Complete plan only', () => {
    expect(planFeatures('ESSENTIALS', 'messaging')).toEqual({ chat: false, polls: false, meetings: false });
    expect(planFeatures('SMART', 'messaging').chat).toBe(false);
    expect(planFeatures('COMPLETE', 'messaging')).toEqual({ chat: true, polls: true, meetings: true });
    expect(planFeatures('ESSENTIALS', 'attendance')).toEqual(MODULES.attendance.features);
  });
});
