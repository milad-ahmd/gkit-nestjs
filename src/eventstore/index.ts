/**
 * Event Store — append-only event log for event sourcing.
 *
 * Mirrors the Go gkit/pkg/eventstore package.
 * Provides an in-memory implementation suitable for testing and small-scale use.
 * For production, wire to a Postgres-backed implementation.
 */

// ---------------------------------------------------------------------------
// Constants

/** Signals the stream must not yet exist (optimistic concurrency). */
export const EXPECTED_VERSION_NEW = -1;
/** Skips optimistic concurrency checking. */
export const EXPECTED_VERSION_ANY = -2;

// ---------------------------------------------------------------------------
// Errors

export class VersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export class StreamNotFoundError extends Error {
  constructor(streamId: string) {
    super(`eventstore: stream not found: "${streamId}"`);
    this.name = 'StreamNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Types

export interface Event {
  /** Unique event id. */
  id: string;
  /** Event type name (e.g. 'OrderPlaced'). */
  type: string;
  /** Owning aggregate id / stream id. */
  aggregateId: string;
  /** Aggregate type (e.g. 'Order'). */
  aggregateType: string;
  /** Arbitrary JSON payload. */
  payload: unknown;
  /** Wall-clock time the event occurred. */
  occurredAt: Date;
  /** Monotonically increasing version within the stream (starts at 0). */
  version: number;
  /** Optional arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

export interface EventData {
  type: string;
  aggregateType: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// EventStore interface

export interface EventStore {
  /**
   * Appends events to the stream identified by aggregateId.
   *
   * @param aggregateId      Stream / aggregate identifier.
   * @param events           Events to append.
   * @param expectedVersion  EXPECTED_VERSION_NEW, EXPECTED_VERSION_ANY, or the
   *                         current version of the stream.
   */
  append(aggregateId: string, events: EventData[], expectedVersion: number): Promise<void>;

  /**
   * Returns all events for aggregateId with version >= fromVersion.
   * Pass fromVersion = 0 to load the full stream.
   */
  load(aggregateId: string, fromVersion?: number): Promise<Event[]>;

  /**
   * Returns all events for aggregateId with version > sinceVersion.
   */
  loadSince(aggregateId: string, sinceVersion: number): Promise<Event[]>;
}

// ---------------------------------------------------------------------------
// InMemoryEventStore

export class InMemoryEventStore implements EventStore {
  /** streams[aggregateId] = ordered array of events (index = version). */
  private readonly streams = new Map<string, Event[]>();
  private idCounter = 0;

  async append(
    aggregateId: string,
    events: EventData[],
    expectedVersion: number,
  ): Promise<void> {
    if (events.length === 0) return;

    const stream = this.streams.get(aggregateId) ?? [];
    const currentVersion = stream.length - 1; // -1 when empty

    // Optimistic concurrency check.
    if (expectedVersion === EXPECTED_VERSION_NEW) {
      if (stream.length > 0) {
        throw new VersionConflictError(
          `eventstore: stream "${aggregateId}" already exists at version ${currentVersion}`,
        );
      }
    } else if (expectedVersion !== EXPECTED_VERSION_ANY) {
      if (currentVersion !== expectedVersion) {
        throw new VersionConflictError(
          `eventstore: stream "${aggregateId}" at version ${currentVersion}, expected ${expectedVersion}`,
        );
      }
    }

    let nextVersion = stream.length;
    for (const ed of events) {
      stream.push({
        id: String(++this.idCounter),
        type: ed.type,
        aggregateId,
        aggregateType: ed.aggregateType,
        payload: ed.payload,
        occurredAt: new Date(),
        version: nextVersion,
        metadata: ed.metadata,
      });
      nextVersion++;
    }

    this.streams.set(aggregateId, stream);
  }

  async load(aggregateId: string, fromVersion = 0): Promise<Event[]> {
    const stream = this.streams.get(aggregateId);

    if (!stream || stream.length === 0) {
      if (fromVersion === 0) {
        throw new StreamNotFoundError(aggregateId);
      }
      return [];
    }

    return stream.filter((e) => e.version >= fromVersion);
  }

  async loadSince(aggregateId: string, sinceVersion: number): Promise<Event[]> {
    const stream = this.streams.get(aggregateId);
    if (!stream) return [];
    return stream.filter((e) => e.version > sinceVersion);
  }

  /** Returns the current version of a stream, or -1 if it doesn't exist. */
  currentVersion(aggregateId: string): number {
    const stream = this.streams.get(aggregateId);
    return stream && stream.length > 0 ? stream.length - 1 : -1;
  }

  /** Removes all stored events (useful in tests). */
  clear(): void {
    this.streams.clear();
  }
}
