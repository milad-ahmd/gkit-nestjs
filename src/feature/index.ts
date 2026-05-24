/**
 * Feature flags — runtime on/off switches, percentage rollouts, and allow-lists.
 *
 * Mirrors the Go gkit/pkg/feature package.
 * The default implementation reads from process.env for simple boolean flags.
 */

// ---------------------------------------------------------------------------
// Flag definition

export interface Flag {
  /** Globally enables or disables the flag. */
  enabled: boolean;
  /**
   * Optional percentage (0-100) rollout. A value of 0 means allow-list only;
   * 100 means everyone. Hash-stable — same entity always maps to same bucket.
   */
  percentage?: number;
  /** List of entity IDs for which the flag is always enabled. */
  allowList?: string[];
}

// ---------------------------------------------------------------------------
// FeatureFlags class

export class FeatureFlags {
  private readonly flags = new Map<string, Flag>();

  /** Returns true if the named flag is globally enabled. */
  isEnabled(key: string): boolean {
    const flag = this.flags.get(key);
    if (!flag || !flag.enabled) return false;
    // No percentage or allow-list constraints → globally enabled.
    if (!flag.percentage && (!flag.allowList || flag.allowList.length === 0)) return true;
    // Percentage == 100 → everyone.
    if (flag.percentage !== undefined && flag.percentage >= 100) return true;
    return false;
  }

  /**
   * Returns true if the named flag is enabled for the given entity.
   * Evaluation order:
   *  1. Flag not found or globally disabled → false
   *  2. Entity in allowList → true
   *  3. Percentage > 0 → hash-bucket check
   *  4. Otherwise → true (if enabled and no constraints)
   */
  isEnabledFor(key: string, entityId: string): boolean {
    const flag = this.flags.get(key);
    if (!flag || !flag.enabled) return false;

    // Allow-list check.
    if (flag.allowList?.includes(entityId)) return true;

    // Percentage rollout (0 means disabled for everyone except allow-list).
    if (flag.percentage !== undefined) {
      if (flag.percentage <= 0) return false;
      const bucket = hashBucket(`${key}:${entityId}`, 100);
      return bucket < flag.percentage;
    }

    // Allow-list only: entity not in list.
    if (flag.allowList && flag.allowList.length > 0) return false;

    // Globally enabled with no constraints.
    return true;
  }

  /** Sets a flag programmatically. */
  set(key: string, flag: Flag | boolean): void {
    if (typeof flag === 'boolean') {
      this.flags.set(key, { enabled: flag });
    } else {
      this.flags.set(key, flag);
    }
  }

  /** Removes a flag. */
  delete(key: string): void {
    this.flags.delete(key);
  }

  /** Returns all registered flags. */
  all(): Record<string, Flag> {
    const out: Record<string, Flag> = {};
    for (const [k, v] of this.flags) {
      out[k] = v;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Static factories

  /**
   * Creates a FeatureFlags instance populated from process.env.
   *
   * Env vars matching `{prefix}_{KEY}=true|false` are loaded as boolean flags.
   * The prefix defaults to 'FEATURE'.
   *
   * Example:
   *   FEATURE_DARK_MODE=true  →  isEnabled('dark_mode') === true
   *   FEATURE_BETA_UI=false   →  isEnabled('beta_ui') === false
   */
  static fromEnv(prefix = 'FEATURE'): FeatureFlags {
    const ff = new FeatureFlags();
    const upper = prefix.toUpperCase() + '_';

    for (const [key, value] of Object.entries(process.env)) {
      if (!key.toUpperCase().startsWith(upper)) continue;
      if (value === undefined) continue;

      const flagKey = key.slice(upper.length).toLowerCase();
      const enabled =
        value.toLowerCase() === 'true' ||
        value === '1' ||
        value.toLowerCase() === 'yes';
      ff.set(flagKey, { enabled });
    }

    return ff;
  }
}

// ---------------------------------------------------------------------------
// Hash bucket utility (FNV-1a inspired, 32-bit)
// Deterministic: same key always maps to same bucket.

function hashBucket(key: string, buckets: number): number {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = (hash * 16777619) >>> 0; // FNV prime, keep 32-bit
  }
  return hash % buckets;
}
