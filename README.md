# gkit-nestjs

[![Node.js](https://img.shields.io/badge/Node.js-20+-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-red.svg)](https://nestjs.com/)
[![CI](https://github.com/milad-ahmd/gkit-nestjs/actions/workflows/ci.yml/badge.svg)](https://github.com/milad-ahmd/gkit-nestjs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**gkit-nestjs** is a production-grade TypeScript/NestJS toolkit for building reliable, observable services.
It is a faithful port of [gkit](https://github.com/milad-ahmd/gkit-go) (Go) to idiomatic TypeScript with NestJS integration.

Each package is independently importable and designed for composability.

---

## Packages

| Package | Export | Description |
|---------|--------|-------------|
| [`retry`](#retry) | `retry`, `Backoff` | Generic retry with fixed, exponential, and jittered backoff |
| [`pool`](#pool) | `WorkerPool` | Bounded worker pool with backpressure using Semaphore |
| [`cache`](#cache) | `LruCache` | Generic LRU in-memory cache |
| [`async`](#async) | `Future`, `Semaphore`, `Stream` | Concurrency primitives: futures, semaphores, async streams |
| [`circuitbreaker`](#circuitbreaker) | `CircuitBreaker` | Closed / Open / HalfOpen state machine |
| [`ratelimit`](#ratelimit) | `RateLimiter`, `KeyedRateLimiter` | Token-bucket rate limiter with per-key TTL eviction |
| [`pubsub`](#pubsub) | `Bus` | Typed in-process publish/subscribe event bus |
| [`graceful`](#graceful) | `GracefulShutdown` | SIGTERM/SIGINT handler with ordered, timeout-aware shutdown |
| [`health`](#health) | `HealthRegistry` | Concurrent health checks with NestJS controller |
| [`metrics`](#metrics) | `MetricsRegistry` | prom-client wrapper with `/metrics` endpoint support |
| [`middleware`](#middleware) | `LoggingMiddleware`, `RequestIdMiddleware` | NestJS middleware: request ID, logging, recovery, timeout |
| [`auth`](#auth) | `JwtGuard`, `issueToken` | JWT guard, claims decorator, RBAC helpers for NestJS |
| [`lock`](#lock) | `RedisLock` | Redis-backed distributed lock (SET NX + Lua release) |
| [`rediscache`](#rediscache) | `RedisCache` | Generic ioredis cache with JSON serialization and TTL |
| [`feature`](#feature) | `FeatureFlags` | Feature flags: global, percentage rollout, allow-list |
| [`eventstore`](#eventstore) | `InMemoryEventStore` | Append-only in-memory event store |
| [`outbox`](#outbox) | `OutboxRelay`, `storeOutboxEvent` | Transactional outbox pattern with PostgreSQL |
| [`pipeline`](#pipeline) | `process`, `chain`, `compose` | Concurrent fan-out processing and stage composition |
| [`saga`](#saga) | `Saga` | Distributed saga with automatic LIFO compensation |
| [`queue`](#queue) | `JobQueue` | PostgreSQL-backed job queue with retry + dead-letter |
| [`sched`](#sched) | `Scheduler` | Job scheduler with periodic and one-shot execution |
| [`store`](#store) | `Store`, `migrate` | PostgreSQL pool wrapper with transaction helpers |
| [`validation`](#validation) | `Validator`, rule functions | Fluent validation with composable rules and typed errors |
| [`config`](#config) | `loadConfig` | Environment-variable config loader with decorator support |

---

## Requirements

- Node.js 20+
- TypeScript 5.3+
- NestJS 10+ (optional — most packages work standalone)

---

## Installation

```bash
npm install github:milad-ahmd/gkit-nestjs
# or
pnpm add github:milad-ahmd/gkit-nestjs
```

Also published to [GitHub Packages](https://github.com/milad-ahmd/gkit-nestjs/packages) as `@milad-ahmd/gkit-nestjs` on each release.

---

## Usage

### retry

```typescript
import { retry, Backoff, StopError } from '@milad-ahmd/gkit-nestjs/retry';

const result = await retry(
  async () => {
    const res = await fetch('https://api.example.com/data');
    if (res.status === 400) throw new StopError('bad request'); // don't retry
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  {
    maxAttempts: 5,
    backoff: Backoff.exponential(100, 2, 10_000),
    onRetry: (attempt, err) => console.warn(`Attempt ${attempt}: ${err.message}`),
  },
);
```

### pool

```typescript
import { WorkerPool } from '@milad-ahmd/gkit-nestjs/pool';

const pool = new WorkerPool(16);

const result = await pool.submit(() => processItem(item));
await pool.drain(); // wait for all pending tasks
```

### cache

```typescript
import { LruCache } from '@milad-ahmd/gkit-nestjs/cache';

const cache = new LruCache<string, Product>(1000);
cache.set('prod-1', product);
const p = cache.get('prod-1'); // Product | undefined
```

### async

```typescript
import { Future, Semaphore, Stream } from '@milad-ahmd/gkit-nestjs/async';

// Parallel futures
const [a, b, c] = await Future.all([fetchA(), fetchB(), fetchC()]);

// Semaphore
const sem = new Semaphore(10);
await sem.acquire();
try { await doWork(); } finally { sem.release(); }

// Typed stream processing
const results = await Stream.fromArray(urls)
  .map(url => downloadImage(url))
  .filter(img => img.size < 1_000_000)
  .collect();
```

### circuitbreaker

```typescript
import { CircuitBreaker, CircuitBreakerState } from '@milad-ahmd/gkit-nestjs/circuitbreaker';

const cb = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  openTimeoutMs: 30_000,
  onStateChange: (from, to) => console.log(`CB ${from} → ${to}`),
});

const result = await cb.execute(() => externalService.call());
```

### ratelimit

```typescript
import { RateLimiter, KeyedRateLimiter, createRateLimitGuard } from '@milad-ahmd/gkit-nestjs/ratelimit';

// Global: 100 req/s, burst 20
const limiter = new RateLimiter(100, 20);
if (!limiter.allow()) throw new Error('rate limited');

// Per-IP: 10 req/s per key
const keyed = new KeyedRateLimiter<string>(10, 5);
const Guard = createKeyedRateLimitGuard(keyed, req => req.ip);

// NestJS guard
@UseGuards(Guard)
@Get('/api/data')
getData() { ... }
```

### pubsub

```typescript
import { Bus } from '@milad-ahmd/gkit-nestjs/pubsub';

const bus = new Bus();

const unsubscribe = bus.subscribe<OrderPlaced>('orders.placed', async (event) => {
  await processOrder(event);
});

await bus.publish('orders.placed', { orderId: '123', amount: 99.99 });

unsubscribe(); // remove subscription
```

### graceful

```typescript
import { GracefulShutdown } from '@milad-ahmd/gkit-nestjs/graceful';

const shutdown = new GracefulShutdown({ timeoutMs: 30_000 });

shutdown.register('http-server', async () => app.close());
shutdown.register('worker-pool', async () => pool.drain());

// Installs SIGTERM + SIGINT handlers automatically
shutdown.listen();
```

### health

```typescript
import { HealthRegistry } from '@milad-ahmd/gkit-nestjs/health';

const health = new HealthRegistry();

health.register({
  name: 'database',
  check: async () => {
    await db.query('SELECT 1');
    return { status: 'healthy' };
  },
});

const report = await health.checkAll();
// { database: { status: 'healthy' } }
```

### auth

```typescript
import { JwtGuard, issueToken, GetClaims } from '@milad-ahmd/gkit-nestjs/auth';

// Issue a token
const token = issueToken({ userId: 'u1', roles: ['admin'] }, process.env.JWT_SECRET!, 86400);

// NestJS guard
@UseGuards(JwtGuard)
@Get('/profile')
getProfile(@GetClaims() claims: JwtClaims) {
  return { userId: claims.userId, roles: claims.roles };
}
```

### lock

```typescript
import { RedisLock, withLock } from '@milad-ahmd/gkit-nestjs/lock';

const lock = new RedisLock(redis);

await withLock(lock, 'billing:invoice:123', 30_000, async () => {
  await processInvoice(invoiceId);
});
```

### saga

```typescript
import { Saga, SagaError } from '@milad-ahmd/gkit-nestjs/saga';

const saga = new Saga<OrderContext>('place-order');

saga
  .addStep({
    name: 'reserve-inventory',
    execute: async (ctx) => { await inventory.reserve(ctx.item); return ctx; },
    compensate: async (ctx) => { await inventory.release(ctx.item); },
  })
  .addStep({
    name: 'charge-payment',
    execute: async (ctx) => { await payments.charge(ctx.amount); return ctx; },
    compensate: async (ctx) => { await payments.refund(ctx.amount); },
  });

try {
  const result = await saga.run({ item, amount });
} catch (err) {
  if (err instanceof SagaError) {
    console.error(`Failed at step '${err.failedStep}':`, err.cause);
  }
}
```

### validation

```typescript
import { Validator, required, minLength, email, min, max, oneOf } from '@milad-ahmd/gkit-nestjs/validation';

new Validator()
  .field('email',    userInput.email,    required(), email())
  .field('quantity', userInput.quantity, min(1), max(1000))
  .field('status',   userInput.status,   oneOf('pending', 'active', 'cancelled'))
  .validate(); // throws ValidationError with field-level details
```

### sched

```typescript
import { Scheduler } from '@milad-ahmd/gkit-nestjs/sched';

const sched = new Scheduler(4, (job, err) => console.error(`${job.name} failed:`, err));

sched
  .every(60_000,   'cleanup',  async () => db.deleteOldRecords())
  .every(21600000, 'report',   async () => reports.generate())
  .after(5_000,    'warmup',   async () => cache.warm());

sched.start();
// sched.stop() on shutdown
```

### store

```typescript
import { Store, migrate } from '@milad-ahmd/gkit-nestjs/store';

const store = new Store({
  host: 'localhost', port: 5432,
  database: 'mydb', user: 'app', password: 'secret',
});

const rows = await store.query<Order>('SELECT * FROM orders WHERE status = $1', ['pending']);

await store.transaction(async (client) => {
  await client.query('INSERT INTO orders (id) VALUES ($1)', [id]);
  await client.query('INSERT INTO events (order_id) VALUES ($1)', [id]);
});

await migrate(store, './migrations');
```

---

## Project Structure

```
src/
├── async/          # Future, Semaphore, Stream, fanOut, fanIn, debounce, throttle
├── auth/           # JWT guard, issueToken, verifyToken, GetClaims decorator
├── cache/          # LruCache
├── circuitbreaker/ # CircuitBreaker with state machine
├── config/         # Environment variable config loader
├── eventstore/     # In-memory append-only event store
├── feature/        # Feature flags with rollout support
├── graceful/       # Graceful shutdown coordinator
├── health/         # Health check registry and controller
├── lock/           # Redis distributed lock
├── metrics/        # prom-client wrapper and /metrics handler
├── middleware/      # NestJS middleware (logging, request ID, timeout, recovery)
├── outbox/         # Transactional outbox pattern
├── pipeline/       # Concurrent pipeline and stage composition
├── pool/           # Worker pool with semaphore-based concurrency
├── pubsub/         # In-process typed event bus
├── queue/          # Postgres job queue with retry
├── ratelimit/      # Token bucket rate limiter and NestJS guard
├── rediscache/     # Redis cache with ioredis
├── retry/          # Retry with backoff strategies
├── saga/           # Distributed saga with compensation
├── sched/          # Job scheduler
├── store/          # PostgreSQL pool wrapper
└── validation/     # Fluent validation with rule functions
```

---

## Building

```bash
npm install
npm run build
npm test
```

---

## License

MIT — see [LICENSE](LICENSE).
