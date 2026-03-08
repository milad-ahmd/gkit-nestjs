/**
 * Config module — loads typed configuration from environment variables.
 *
 * Mirrors the Go gkit/pkg/config package.
 *
 * Usage:
 *   class AppConfig {
 *     @EnvVar('PORT', { default: '3000' })
 *     port!: string;
 *
 *     @EnvVar('DATABASE_URL', { required: true })
 *     databaseUrl!: string;
 *   }
 *
 *   const cfg = loadConfig(AppConfig);
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// ConfigError

export class ConfigError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`config: validation failed:\n  ${fields.join('\n  ')}`);
    this.name = 'ConfigError';
    this.fields = fields;
  }
}

// ---------------------------------------------------------------------------
// EnvVar decorator metadata

interface EnvVarMeta {
  name: string;
  default?: string;
  required?: boolean;
  transform?: (raw: string) => unknown;
}

const ENV_META_KEY = 'gkit:envvar';

/**
 * Field decorator that marks a config property as sourced from an env var.
 *
 * @param name      Environment variable name (e.g. 'DATABASE_URL')
 * @param options   Optional configuration: default value, required flag, transform fn
 */
export function EnvVar(
  name: string,
  options?: { default?: string; required?: boolean; transform?: (raw: string) => unknown },
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const existing: Record<string, EnvVarMeta> =
      Reflect.getOwnMetadata(ENV_META_KEY, target.constructor) ?? {};
    existing[String(propertyKey)] = { name, ...options };
    Reflect.defineMetadata(ENV_META_KEY, existing, target.constructor);
  };
}

// ---------------------------------------------------------------------------
// loadConfig<T>

/**
 * Instantiates cls, reads process.env for each @EnvVar field, validates
 * required fields, and returns the populated instance.
 *
 * Throws ConfigError if required variables are missing.
 */
export function loadConfig<T extends object>(cls: new () => T): T {
  const instance = new cls();
  const meta: Record<string, EnvVarMeta> =
    Reflect.getOwnMetadata(ENV_META_KEY, cls) ?? {};

  const errors: string[] = [];

  for (const [prop, opts] of Object.entries(meta)) {
    let raw = process.env[opts.name];

    if (raw === undefined || raw === '') {
      if (opts.default !== undefined) {
        raw = opts.default;
      } else if (opts.required) {
        errors.push(`required env var "${opts.name}" is not set`);
        continue;
      } else {
        continue;
      }
    }

    try {
      const value = opts.transform ? opts.transform(raw) : coerce(raw, instance, prop);
      (instance as Record<string, unknown>)[prop] = value;
    } catch (err) {
      errors.push(
        `env var "${opts.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(errors);
  }

  return instance;
}

// ---------------------------------------------------------------------------
// Type coercion based on existing value type

function coerce(raw: string, target: object, prop: string): unknown {
  const existing = (target as Record<string, unknown>)[prop];

  if (typeof existing === 'number') {
    const n = Number(raw);
    if (isNaN(n)) throw new Error(`invalid number "${raw}"`);
    return n;
  }

  if (typeof existing === 'boolean') {
    const lower = raw.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
    throw new Error(`invalid boolean "${raw}"`);
  }

  if (Array.isArray(existing)) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Default: string
  return raw;
}

// ---------------------------------------------------------------------------
// Convenience type helpers for decorated configs

/** Marks a config field as a comma-separated string array. */
export function toStringArray(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Coerces a string to integer; throws on invalid input. */
export function toInt(raw: string): number {
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`invalid integer "${raw}"`);
  return n;
}

/** Coerces a string to float; throws on invalid input. */
export function toFloat(raw: string): number {
  const n = parseFloat(raw);
  if (isNaN(n)) throw new Error(`invalid float "${raw}"`);
  return n;
}

/** Coerces a string to boolean. */
export function toBool(raw: string): boolean {
  const lower = raw.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw new Error(`invalid boolean "${raw}"`);
}
