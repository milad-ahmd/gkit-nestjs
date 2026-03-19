# Changelog

All notable changes to **gkit-nestjs** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

---

## [Unreleased]

### Added
- Integration tests with Testcontainers for `store`, `rediscache`, `lock`, `queue`, `outbox`, `eventstore`
- Community health files: `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`
- GitHub issue and PR templates

---

## [1.0.0] — 2024-03-19

### Added

**Core concurrency**
- `retry` — generic retry with fixed, exponential, and jitter backoff; `StopError` escape hatch
- `pool` — bounded worker pool with `Semaphore`-based backpressure and `drain()`
- `cache` — generic in-memory LRU cache with optional per-entry TTL
- `async` — `Future<T>`, `Semaphore`, `Stream<T>`, `fanOut`, `fanIn`, `debounce`, `throttle`
- `pipeline` — concurrent fan-out pipeline with stage chaining and composition

**Reliability**
- `circuitbreaker` — Closed/Open/HalfOpen state machine with configurable thresholds
- `ratelimit` — token-bucket rate limiter with per-key variant and NestJS guard factories
- `graceful` — LIFO shutdown coordinator with per-hook timeout and signal handling
- `health` — concurrent health-check registry with aggregated status reporting
- `saga` — saga orchestrator with LIFO compensation and structured `SagaError`
- `pubsub` — typed in-process publish/subscribe event bus

**Infrastructure**
- `store` — pg-backed data layer with typed queries, transactions, and migration runner
- `rediscache` — ioredis-backed cache with JSON support and `getOrSet`
- `lock` — Redis distributed lock with Lua-based release, renewal, and retry
- `queue` — Postgres job queue with `SKIP LOCKED`, exponential backoff, dead-letter
- `outbox` — transactional outbox pattern with polling relay
- `eventstore` — append-only Postgres event store with version-checked appends

**Cross-cutting**
- `auth` — JWT sign/verify with RBAC role guard and parameter decorators
- `metrics` — prom-client registry with typed counter, gauge, histogram
- `middleware` — NestJS middleware: request ID, structured logging, recovery, timeout
- `config` — environment-variable config loader with type coercion and validation
- `feature` — feature flags with percentage rollout, allowlist, env-var loading
- `sched` — interval and one-shot job scheduler with error handler
- `validation` — fluent field-level validator with built-in rules

[Unreleased]: https://github.com/miladhzz/gkit-nestjs/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/miladhzz/gkit-nestjs/releases/tag/v1.0.0
