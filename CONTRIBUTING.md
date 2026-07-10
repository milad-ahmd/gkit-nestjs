# Contributing to gkit-nestjs

Thank you for considering a contribution to **gkit-nestjs**!

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Running Tests](#running-tests)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Package Design Guidelines](#package-design-guidelines)

---

## Code of Conduct

Be kind and respectful. We follow the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

---

## Getting Started

1. **Fork** the repo and clone your fork:
   ```bash
   git clone https://github.com/<your-handle>/gkit-nestjs.git
   cd gkit-nestjs
   ```
2. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/milad-ahmd/gkit-nestjs.git
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feat/my-feature
   ```

---

## Development Setup

**Prerequisites:**

| Tool | Version |
|---|---|
| Node.js | ≥ 20 LTS |
| npm | ≥ 10 |
| Docker | ≥ 24 (for integration tests) |

```bash
npm ci
```

---

## Running Tests

```bash
# Unit tests
npm test

# Unit tests with coverage
npm run test:cov

# Watch mode
npm run test:watch

# Integration tests (requires Docker)
npm run test:integration

# Lint
npm run lint:check

# Build
npm run build
```

---

## Commit Messages

We use **Conventional Commits**:

```
feat(retry): add jitter backoff strategy
fix(cache): fix TTL not applied on replace
test(pool): add drain under-load test
docs(readme): update auth usage example
chore(deps): bump ioredis to 5.4
```

Rules:
- Use the module name as scope: `feat(ratelimit):`, `fix(saga):`
- Imperative mood: "add", "fix", "remove"
- Subject line ≤ 72 characters

---

## Pull Request Process

1. `npm test` must pass
2. `npm run lint:check` must pass
3. `npm run build` must succeed
4. Add or update tests for changed behaviour
5. Update TSDoc if public API changes
6. Fill in the PR template
7. Request review from `@milad-ahmd`

New modules must include:
- `src/<module>/index.ts` with exported types and implementations
- `src/<module>/<module>.spec.ts` with ≥ 80% coverage
- Entry in `src/index.ts` barrel and in `README.md`

---

## Package Design Guidelines

- **No global state** — every factory function returns a new instance
- **TypeScript strict** — `strict: true` is enforced; no `any` without a comment
- **Dependency injection friendly** — classes should work as NestJS `@Injectable()` providers
- **Async/await everywhere** — no callback APIs in public interfaces
- **Errors as values where possible** — use typed error classes, not string throws
- **Tree-shakeable** — avoid side-effect imports at module level
