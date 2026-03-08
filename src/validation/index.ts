export type Rule<T = unknown> = (value: T) => string | null;

export interface ValidationErrors {
  [field: string]: string[];
}

export class ValidationError extends Error {
  constructor(public readonly errors: ValidationErrors) {
    super('Validation failed: ' + JSON.stringify(errors));
    this.name = 'ValidationError';
  }
}

export class Validator {
  private readonly errors: ValidationErrors = {};

  field<T>(name: string, value: T, ...rules: Rule<T>[]): this {
    const fieldErrors: string[] = [];
    for (const rule of rules) {
      const msg = rule(value);
      if (msg !== null) fieldErrors.push(msg);
    }
    if (fieldErrors.length > 0) this.errors[name] = fieldErrors;
    return this;
  }

  validate(): void {
    if (Object.keys(this.errors).length > 0) {
      throw new ValidationError({ ...this.errors });
    }
  }

  getErrors(): ValidationErrors { return { ...this.errors }; }
  hasErrors(): boolean { return Object.keys(this.errors).length > 0; }
}

// Built-in rules
export const required = (): Rule<unknown> => value => {
  if (value === null || value === undefined) return 'is required';
  if (typeof value === 'string' && value.trim() === '') return 'is required';
  if (Array.isArray(value) && value.length === 0) return 'is required';
  return null;
};

export const minLength = (n: number): Rule<string> => value => {
  if (!value) return null;
  return value.length >= n ? null : `must be at least ${n} characters`;
};

export const maxLength = (n: number): Rule<string> => value => {
  if (!value) return null;
  return value.length <= n ? null : `must be at most ${n} characters`;
};

export const min = (n: number): Rule<number> => value => {
  if (value === null || value === undefined) return null;
  return value >= n ? null : `must be >= ${n}`;
};

export const max = (n: number): Rule<number> => value => {
  if (value === null || value === undefined) return null;
  return value <= n ? null : `must be <= ${n}`;
};

export const email = (): Rule<string> => value => {
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at < 1) return 'must be a valid email address';
  const domain = value.substring(at + 1);
  return domain.includes('.') ? null : 'must be a valid email address';
};

export const pattern = (regex: RegExp | string): Rule<string> => {
  const re = typeof regex === 'string' ? new RegExp(regex) : regex;
  return value => (!value || re.test(value)) ? null : `must match pattern ${re.source}`;
};

export const oneOf = (...options: string[]): Rule<string> => value => {
  if (!value) return null;
  return options.includes(value) ? null : `must be one of [${options.join(', ')}]`;
};

export const url = (): Rule<string> => value => {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol && u.host ? null : 'must be a valid URL';
  } catch {
    return 'must be a valid URL';
  }
};
