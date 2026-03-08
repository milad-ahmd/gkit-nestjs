import 'reflect-metadata';
import {
  EnvVar,
  loadConfig,
  ConfigError,
  toStringArray,
  toInt,
  toFloat,
  toBool,
} from './index';

// ---------------------------------------------------------------------------
// Helpers — config class factories
// ---------------------------------------------------------------------------

function makeSimpleConfig() {
  class SimpleConfig {
    @EnvVar('APP_PORT', { default: '3000' })
    port!: string;

    @EnvVar('APP_HOST', { default: 'localhost' })
    host!: string;
  }
  return SimpleConfig;
}

function makeRequiredConfig() {
  class RequiredConfig {
    @EnvVar('DB_URL', { required: true })
    dbUrl!: string;
  }
  return RequiredConfig;
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig()', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses default values when env vars are not set', () => {
    delete process.env['APP_PORT'];
    delete process.env['APP_HOST'];
    const SimpleConfig = makeSimpleConfig();
    const cfg = loadConfig(SimpleConfig);
    expect(cfg.port).toBe('3000');
    expect(cfg.host).toBe('localhost');
  });

  it('reads values from process.env', () => {
    process.env['APP_PORT'] = '8080';
    process.env['APP_HOST'] = '0.0.0.0';
    const SimpleConfig = makeSimpleConfig();
    const cfg = loadConfig(SimpleConfig);
    expect(cfg.port).toBe('8080');
    expect(cfg.host).toBe('0.0.0.0');
  });

  it('throws ConfigError when a required env var is missing', () => {
    delete process.env['DB_URL'];
    const RequiredConfig = makeRequiredConfig();
    expect(() => loadConfig(RequiredConfig)).toThrow(ConfigError);
  });

  it('ConfigError lists the missing variable name', () => {
    delete process.env['DB_URL'];
    const RequiredConfig = makeRequiredConfig();
    try {
      loadConfig(RequiredConfig);
      fail('should have thrown');
    } catch (err) {
      expect((err as ConfigError).message).toContain('DB_URL');
      expect((err as ConfigError).fields).toContain(expect.stringContaining('DB_URL'));
    }
  });

  it('uses env value over default when both are available', () => {
    process.env['APP_PORT'] = '9999';
    const SimpleConfig = makeSimpleConfig();
    const cfg = loadConfig(SimpleConfig);
    expect(cfg.port).toBe('9999');
  });

  it('applies a custom transform function', () => {
    process.env['NUMERIC_VAL'] = '42';

    class NumConfig {
      @EnvVar('NUMERIC_VAL', { transform: toInt })
      value!: number;
    }

    const cfg = loadConfig(NumConfig);
    expect(cfg.value).toBe(42);
  });

  it('throws ConfigError for an invalid transform result', () => {
    process.env['BAD_NUM'] = 'not-a-number';

    class BadConfig {
      @EnvVar('BAD_NUM', { transform: toInt })
      value!: number;
    }

    expect(() => loadConfig(BadConfig)).toThrow(ConfigError);
  });

  it('does not set a field when env var is absent and no default', () => {
    delete process.env['OPTIONAL_VAR'];

    class OptConfig {
      @EnvVar('OPTIONAL_VAR')
      optional!: string;
    }

    const cfg = loadConfig(OptConfig);
    // The field was never set, so it should remain undefined (or the class initializer).
    expect((cfg as { optional?: string }).optional).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Type coercion helpers
// ---------------------------------------------------------------------------

describe('toStringArray()', () => {
  it('splits a comma-separated string', () => {
    expect(toStringArray('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace', () => {
    expect(toStringArray(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  it('filters out empty segments', () => {
    expect(toStringArray('a,,b')).toEqual(['a', 'b']);
  });

  it('returns a single-element array for no commas', () => {
    expect(toStringArray('hello')).toEqual(['hello']);
  });
});

describe('toInt()', () => {
  it('parses a valid integer string', () => {
    expect(toInt('42')).toBe(42);
  });

  it('parses negative integers', () => {
    expect(toInt('-7')).toBe(-7);
  });

  it('throws for non-numeric input', () => {
    expect(() => toInt('abc')).toThrow('invalid integer');
  });
});

describe('toFloat()', () => {
  it('parses a valid float string', () => {
    expect(toFloat('3.14')).toBeCloseTo(3.14);
  });

  it('parses integer-like floats', () => {
    expect(toFloat('5')).toBe(5);
  });

  it('throws for non-numeric input', () => {
    expect(() => toFloat('xyz')).toThrow('invalid float');
  });
});

describe('toBool()', () => {
  it.each([['true', true], ['1', true], ['yes', true]])('"%s" → true', (raw, expected) => {
    expect(toBool(raw)).toBe(expected);
  });

  it.each([['false', false], ['0', false], ['no', false]])('"%s" → false', (raw, expected) => {
    expect(toBool(raw)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(toBool('TRUE')).toBe(true);
    expect(toBool('FALSE')).toBe(false);
  });

  it('throws for invalid boolean string', () => {
    expect(() => toBool('maybe')).toThrow('invalid boolean');
  });
});

// ---------------------------------------------------------------------------
// ConfigError
// ---------------------------------------------------------------------------

describe('ConfigError', () => {
  it('includes all field errors in message', () => {
    const err = new ConfigError(['field1 is missing', 'field2 is invalid']);
    expect(err.message).toContain('field1');
    expect(err.message).toContain('field2');
  });

  it('exposes fields array', () => {
    const fields = ['error-a', 'error-b'];
    const err = new ConfigError(fields);
    expect(err.fields).toEqual(fields);
  });

  it('name is ConfigError', () => {
    const err = new ConfigError([]);
    expect(err.name).toBe('ConfigError');
  });
});
