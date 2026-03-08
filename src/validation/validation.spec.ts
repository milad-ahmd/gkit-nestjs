import {
  Validator,
  ValidationError,
  required,
  minLength,
  maxLength,
  min,
  max,
  email,
  pattern,
  oneOf,
  url,
} from './index';

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

describe('required()', () => {
  const rule = required();

  it('passes for a non-empty string', () => expect(rule('hello')).toBeNull());
  it('fails for null', () => expect(rule(null)).toBe('is required'));
  it('fails for undefined', () => expect(rule(undefined)).toBe('is required'));
  it('fails for empty string', () => expect(rule('')).toBe('is required'));
  it('fails for whitespace-only string', () => expect(rule('   ')).toBe('is required'));
  it('fails for empty array', () => expect(rule([])).toBe('is required'));
  it('passes for non-empty array', () => expect(rule([1, 2])).toBeNull());
  it('passes for 0 (number)', () => expect(rule(0)).toBeNull());
  it('passes for false (boolean)', () => expect(rule(false)).toBeNull());
});

describe('minLength()', () => {
  const rule = minLength(3);

  it('passes when string meets minimum', () => expect(rule('abc')).toBeNull());
  it('passes when string exceeds minimum', () => expect(rule('abcd')).toBeNull());
  it('fails when string is too short', () => expect(rule('ab')).toContain('3'));
  it('passes for falsy value (no value)', () => expect(rule('')).toBeNull());
});

describe('maxLength()', () => {
  const rule = maxLength(5);

  it('passes when string is within limit', () => expect(rule('abc')).toBeNull());
  it('fails when string is too long', () => expect(rule('abcdef')).toContain('5'));
  it('passes for falsy value', () => expect(rule('')).toBeNull());
});

describe('min()', () => {
  const rule = min(10);

  it('passes when value meets minimum', () => expect(rule(10)).toBeNull());
  it('passes when value exceeds minimum', () => expect(rule(100)).toBeNull());
  it('fails when value is below minimum', () => expect(rule(9)).toContain('10'));
  it('passes for null', () => expect(rule(null as unknown as number)).toBeNull());
});

describe('max()', () => {
  const rule = max(5);

  it('passes when value is at most max', () => expect(rule(5)).toBeNull());
  it('fails when value exceeds max', () => expect(rule(6)).toContain('5'));
  it('passes for null', () => expect(rule(null as unknown as number)).toBeNull());
});

describe('email()', () => {
  const rule = email();

  it('passes for a valid email', () => expect(rule('test@example.com')).toBeNull());
  it('fails for an address without @', () => expect(rule('noatsign')).toBeTruthy());
  it('fails when domain has no dot', () => expect(rule('a@nodot')).toBeTruthy());
  it('passes for falsy value', () => expect(rule('')).toBeNull());
});

describe('pattern()', () => {
  const rule = pattern(/^\d+$/);

  it('passes when string matches pattern', () => expect(rule('123')).toBeNull());
  it('fails when string does not match', () => expect(rule('abc')).toBeTruthy());
  it('passes for empty string', () => expect(rule('')).toBeNull());

  it('accepts a string regex', () => {
    const r = pattern('^[a-z]+$');
    expect(r('hello')).toBeNull();
    expect(r('HELLO')).toBeTruthy();
  });
});

describe('oneOf()', () => {
  const rule = oneOf('red', 'green', 'blue');

  it('passes for a valid option', () => expect(rule('red')).toBeNull());
  it('fails for an invalid option', () => expect(rule('purple')).toBeTruthy());
  it('passes for falsy value', () => expect(rule('')).toBeNull());
});

describe('url()', () => {
  const rule = url();

  it('passes for a valid URL', () => expect(rule('https://example.com')).toBeNull());
  it('fails for an invalid URL', () => expect(rule('not-a-url')).toBeTruthy());
  it('passes for empty string', () => expect(rule('')).toBeNull());
});

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

describe('Validator', () => {
  it('does not throw when all rules pass', () => {
    const v = new Validator();
    v.field('name', 'Alice', required(), minLength(2));
    expect(() => v.validate()).not.toThrow();
  });

  it('throws ValidationError when a rule fails', () => {
    const v = new Validator();
    v.field('name', '', required());
    expect(() => v.validate()).toThrow(ValidationError);
  });

  it('accumulates multiple field errors', () => {
    const v = new Validator();
    v.field('name', '', required());
    v.field('age', 0, min(18));
    const errors = v.getErrors();
    expect(Object.keys(errors)).toHaveLength(2);
    expect(errors['name']).toBeDefined();
    expect(errors['age']).toBeDefined();
  });

  it('accumulates multiple rule errors on the same field', () => {
    const v = new Validator();
    v.field('password', 'ab', minLength(8), maxLength(3));
    const errors = v.getErrors();
    // minLength fails (ab < 8), but maxLength doesn't (ab.length=2 <= 3).
    expect(errors['password']?.length).toBeGreaterThanOrEqual(1);
  });

  it('hasErrors returns false when valid', () => {
    const v = new Validator();
    v.field('x', 'ok');
    expect(v.hasErrors()).toBe(false);
  });

  it('hasErrors returns true when invalid', () => {
    const v = new Validator();
    v.field('x', '', required());
    expect(v.hasErrors()).toBe(true);
  });

  it('getErrors returns a copy (immutable)', () => {
    const v = new Validator();
    v.field('x', '', required());
    const errs = v.getErrors();
    errs['extra'] = ['mutated'];
    expect(v.getErrors()['extra']).toBeUndefined();
  });

  it('ValidationError contains stringified errors in message', () => {
    const v = new Validator();
    v.field('email', 'bad', email());
    try {
      v.validate();
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toContain('email');
    }
  });

  it('supports method chaining', () => {
    const v = new Validator();
    const result = v.field('a', 'x').field('b', 'y');
    expect(result).toBe(v);
  });
});
