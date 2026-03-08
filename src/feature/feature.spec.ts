import { FeatureFlags, Flag } from './index';

describe('FeatureFlags', () => {
  let ff: FeatureFlags;

  beforeEach(() => {
    ff = new FeatureFlags();
  });

  // -------------------------------------------------------------------------
  // set / isEnabled
  // -------------------------------------------------------------------------

  describe('set() + isEnabled()', () => {
    it('is disabled for an unknown key', () => {
      expect(ff.isEnabled('unknown')).toBe(false);
    });

    it('is enabled after set with boolean true', () => {
      ff.set('my-flag', true);
      expect(ff.isEnabled('my-flag')).toBe(true);
    });

    it('is disabled after set with boolean false', () => {
      ff.set('my-flag', false);
      expect(ff.isEnabled('my-flag')).toBe(false);
    });

    it('is enabled for a Flag object with enabled: true and no constraints', () => {
      ff.set('global', { enabled: true });
      expect(ff.isEnabled('global')).toBe(true);
    });

    it('is disabled for a Flag object with enabled: false', () => {
      ff.set('off', { enabled: false });
      expect(ff.isEnabled('off')).toBe(false);
    });

    it('is enabled when percentage is 100', () => {
      ff.set('full-rollout', { enabled: true, percentage: 100 });
      expect(ff.isEnabled('full-rollout')).toBe(true);
    });

    it('is not globally enabled when percentage < 100 (requires entity)', () => {
      ff.set('partial', { enabled: true, percentage: 50 });
      expect(ff.isEnabled('partial')).toBe(false);
    });

    it('is not globally enabled when allowList is non-empty (requires entity)', () => {
      ff.set('list', { enabled: true, allowList: ['user-1'] });
      expect(ff.isEnabled('list')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isEnabledFor
  // -------------------------------------------------------------------------

  describe('isEnabledFor()', () => {
    it('returns false for unknown flag', () => {
      expect(ff.isEnabledFor('ghost', 'user-1')).toBe(false);
    });

    it('returns false for disabled flag', () => {
      ff.set('off', false);
      expect(ff.isEnabledFor('off', 'user-1')).toBe(false);
    });

    it('returns true for entity in allowList', () => {
      ff.set('list', { enabled: true, allowList: ['vip-1', 'vip-2'] });
      expect(ff.isEnabledFor('list', 'vip-1')).toBe(true);
    });

    it('returns false for entity not in allowList when no percentage', () => {
      ff.set('list', { enabled: true, allowList: ['vip-1'], percentage: 0 });
      expect(ff.isEnabledFor('list', 'other-user')).toBe(false);
    });

    it('returns true for globally-enabled flag (no constraints)', () => {
      ff.set('open', { enabled: true });
      expect(ff.isEnabledFor('open', 'any-user')).toBe(true);
    });

    it('percentage=100 includes everyone', () => {
      ff.set('all', { enabled: true, percentage: 100 });
      expect(ff.isEnabledFor('all', 'user-xyz')).toBe(true);
    });

    it('percentage=0 excludes everyone (unless in allowList)', () => {
      ff.set('none', { enabled: true, percentage: 0 });
      expect(ff.isEnabledFor('none', 'user-xyz')).toBe(false);
    });

    it('is deterministic — same entity always maps to same bucket', () => {
      ff.set('partial', { enabled: true, percentage: 50 });
      const resultA = ff.isEnabledFor('partial', 'entity-stable');
      const resultB = ff.isEnabledFor('partial', 'entity-stable');
      expect(resultA).toBe(resultB);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete()', () => {
    it('removes a flag', () => {
      ff.set('temp', true);
      ff.delete('temp');
      expect(ff.isEnabled('temp')).toBe(false);
    });

    it('is a no-op for a non-existent key', () => {
      expect(() => ff.delete('ghost')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // all
  // -------------------------------------------------------------------------

  describe('all()', () => {
    it('returns all registered flags', () => {
      ff.set('a', true);
      ff.set('b', { enabled: false, percentage: 10 });
      const all = ff.all();
      expect(all['a']).toEqual({ enabled: true });
      expect(all['b']).toEqual({ enabled: false, percentage: 10 });
    });

    it('returns empty object when no flags', () => {
      expect(ff.all()).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // fromEnv
  // -------------------------------------------------------------------------

  describe('fromEnv()', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    afterEach(() => {
      process.env = ORIGINAL_ENV;
    });

    it('reads boolean flags from environment', () => {
      process.env['FEATURE_DARK_MODE'] = 'true';
      process.env['FEATURE_BETA_UI'] = 'false';
      const flags = FeatureFlags.fromEnv();
      expect(flags.isEnabled('dark_mode')).toBe(true);
      expect(flags.isEnabled('beta_ui')).toBe(false);
    });

    it('recognises "1" and "yes" as truthy', () => {
      process.env['FEATURE_OPT_A'] = '1';
      process.env['FEATURE_OPT_B'] = 'yes';
      const flags = FeatureFlags.fromEnv();
      expect(flags.isEnabled('opt_a')).toBe(true);
      expect(flags.isEnabled('opt_b')).toBe(true);
    });

    it('uses a custom prefix', () => {
      process.env['FF_TURBO'] = 'true';
      const flags = FeatureFlags.fromEnv('FF');
      expect(flags.isEnabled('turbo')).toBe(true);
    });

    it('ignores vars that do not match the prefix', () => {
      process.env['OTHER_THING'] = 'true';
      const flags = FeatureFlags.fromEnv();
      expect(flags.isEnabled('thing')).toBe(false);
    });
  });
});
