# Archly.Cloud — System Audit

**Date:** 2026-04-28
**Version:** 0.6.0
**Audited by:** Claude Code (automated analysis)
**Scope:** Full-stack — security, architecture, testing, infrastructure, code quality, real-time collaboration

---

## Executive Summary

Archly.cloud is a collaborative 3D architectural design tool built as a Turborepo monorepo. It delivers a browser-based editor with real-time multi-user collaboration, full building-geometry systems (walls, doors, windows, stairs, roofs), and a SaaS organisational model. The core technical choices — Yjs CRDT, Socket.io, Three.js, Next.js App Router — are well-suited to the problem.

The system is **early-stage but functionally rich**. Several pillars of production readiness are absent or broken: the deploy pipeline is corrupted, there is zero test coverage, and live cloud credentials are exposed in the repository.

### Maturity At a Glance

| Category | Status | Rating |
|---|---|---|
| 3D Engine & Features | Implemented | GOOD |
| Real-Time Collaboration | Implemented | GOOD |
| Database & Storage | Implemented | GOOD |
| Authentication | Basic | FAIR |
| Authorization | Partial | FAIR |
| Security | Multiple gaps | AT RISK |
| Testing | None | CRITICAL |
| CI / CD | Broken | CRITICAL |
| Observability | Minimal | AT RISK |
| Scalability | Limited | FAIR |

### Top 5 Action Items

| # | Severity | Issue |
|---|---|---|
| 1 | CRITICAL | Live Cloudflare R2 credentials committed to the repo |
| 2 | CRITICAL | Deploy workflow file is corrupted — automated deploys are broken |
| 3 | HIGH | Socket.io has no authentication — anyone can join any project room |
| 4 | HIGH | `NEXTAUTH_SECRET` falls back to the literal string `"default_secret_for_development"` |
| 5 | HIGH | Zero test coverage across the entire monorepo |

---

## 1. System Overview

### Product

A browser-based collaborative 3D architectural editor. Users create projects within teams and organisations, draw buildings using parametric geometry tools, and edit in real time with teammates. The product is in controlled early access with an admin approval queue.

### Monorepo Structure

```
apps/
  editor/          Next.js 16 app (main product, port 3002)
packages/
  core/            Scene state, Yjs bindings, geometry systems (npm: @pascal-app/core)
  viewer/          Three.js renderer, camera, post-processing (npm: @pascal-app/viewer)
  editor/          Reusable editor UI components
  ui/              Shared design system
tooling/
  release/         Version bump + npm publish scripts
```

### Tech Stack Snapshot

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router, Server Actions) |
| Runtime | Node.js via Bun 1.3.0 |
| 3D Rendering | Three.js 0.184 + React Three Fiber 9.5 (WebGPU-ready) |
| State | Zustand 5 + Zundo (undo/redo) |
| Real-time | Yjs 13.6 (CRDT) + Socket.io 4.8 |
| Scale layer | Redis 7 (Socket.io adapter) |
| Auth | NextAuth 4.24 — credentials provider, JWT sessions |
| Database | PostgreSQL 15 (Docker) via Prisma 5.10 |
| Object storage | Cloudflare R2 (S3-compatible) |
| Analytics | PostHog |
| Reverse proxy | Caddy (auto SSL) |
| Build | Turborepo + Bun |

### Architecture Data Flow

```
Browser
  ↕ HTTPS / WSS
Caddy (reverse proxy, SSL termination)
  ↕
Next.js + Socket.io (single process, port 3002)
  ├── Socket.io: Yjs state sync (per-project in-memory doc)
  │     ↕ Redis pub/sub (multi-server adapter)
  ├── Next.js API / Server Actions → Prisma → PostgreSQL
  └── Server Actions → AWS SDK → Cloudflare R2

Client state sync:
  Zustand store ↔ local Yjs Y.Doc ↔ Socket.io ↔ server Yjs Y.Doc
```

---

## 2. Security Audit

### 2.1 Secrets Exposure — CRITICAL

**Finding:** `.env.production` containing live Cloudflare R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`) exists in the repository source tree. The file is referenced directly by `docker-compose.yml` and is likely in git history.

**Impact:** Anyone with read access to the repository can exfiltrate all project scene data from R2 and incur charges against the account.

**Fix:**
1. Rotate all R2 credentials immediately in the Cloudflare dashboard.
2. Add `.env.production` to `.gitignore` and run `git rm --cached .env.production`.
3. Purge the file from git history: `git filter-repo --invert-paths --path .env.production`.
4. Store secrets in GitHub Actions Secrets and inject at deploy time via the workflow.

---

### 2.2 No Socket.io Authentication — HIGH

**File:** [apps/editor/server.ts](apps/editor/server.ts#L43)

```ts
io.on('connection', (socket) => {
  // No token validation here — any client can connect
  socket.on('join-project', (projectId) => {
    socket.join(`project:${projectId}`)  // joins without authorization check
```

**Impact:** Any unauthenticated actor can open a WebSocket to the server, join any project room by guessing a project ID, and receive or inject scene updates.

**Fix:** Add a Socket.io `auth` middleware that validates the NextAuth JWT before allowing a connection. The token should encode the user ID. On `join-project`, verify that the user is a member of the project's team before joining the room.

---

### 2.3 Hardcoded Fallback Auth Secret — HIGH

**File:** [apps/editor/lib/auth.ts](apps/editor/lib/auth.ts#L59)

```ts
secret: process.env.NEXTAUTH_SECRET || "default_secret_for_development",
```

**Impact:** If `NEXTAUTH_SECRET` is missing from the environment (misconfiguration, accidental omission), sessions are signed with a known, public constant. Any attacker can forge valid session tokens.

**Fix:** Remove the fallback. Let NextAuth throw on missing secret so the misconfiguration is caught at startup rather than silently degraded.

---

### 2.4 No Rate Limiting — HIGH

**Finding:** Neither the Next.js API routes / Server Actions nor the Socket.io event handlers implement any rate limiting.

**Impact:** Login endpoints are brute-forceable. Socket.io `yjs-update` events can be flooded (100 MB max buffer means a single malicious client could exhaust server memory quickly). Early-access application endpoint is spammable.

**Fix:** Add rate limiting at the Caddy layer (basic) and at the application layer using `@upstash/ratelimit` (Redis-backed, works in Next.js Server Actions) or `socket.io-rate-limiter`.

---

### 2.5 No Input Validation on Yjs Updates — HIGH

**File:** [apps/editor/server.ts](apps/editor/server.ts#L77-L92)

```ts
socket.on('yjs-update', (update: Uint8Array) => {
  Y.applyUpdate(doc, new Uint8Array(update), 'remote')  // no schema check
  socket.to(`project:${currentProjectId}`).emit('yjs-update', update)
```

**Impact:** A malicious client can send a crafted Yjs update that applies arbitrary data to the shared document. This can corrupt project state for all users in the room.

**Fix:** Define a Zod schema for scene entities and validate decoded Yjs map values before broadcasting. Reject updates that don't conform.

---

### 2.6 Weak PostgreSQL Credentials — MEDIUM

**File:** [docker-compose.yml](docker-compose.yml#L34-L39)

```yaml
POSTGRES_USER=pascal
POSTGRES_PASSWORD=pascal
```

**Impact:** Trivially guessable. If the database port is ever inadvertently exposed, access is immediate.

**Fix:** Generate a strong random password and store it in `.env.production` (which itself should not be in source control — see 2.1).

---

### 2.7 Overly Permissive Image Remote Patterns — MEDIUM

**File:** [apps/editor/next.config.ts](apps/editor/next.config.ts#L23-L31)

```ts
remotePatterns: [
  { protocol: 'https', hostname: '**' },
  { protocol: 'http',  hostname: '**' },
],
```

**Impact:** Next.js Image Optimisation will proxy and optimise images from any URL, which can be abused for SSRF or to incur bandwidth costs.

**Fix:** Lock `remotePatterns` to specific trusted hostnames (your R2 bucket domain, your CDN).

---

### 2.8 Missing Auth Flows — MEDIUM

- No email verification on signup — anyone can register with a fake address.
- No password reset flow — users are permanently locked out if they forget their password.
- No session revocation UI.
- No MFA support.

---

### 2.9 No Audit Log — LOW

There is no record of who changed what in a project or when. This is expected at this stage but will be needed for enterprise customers and compliance.

---

## 3. Architecture & Scalability Audit

### 3.1 Yjs Documents Stored in Server Memory — HIGH

**File:** [apps/editor/server.ts](apps/editor/server.ts#L20)

```ts
const docs = new Map<string, Y.Doc>()
```

**Impact:**
- A process restart (deploy, crash, OOM kill) discards all in-flight collaboration state. Users lose unsaved changes.
- Memory grows unboundedly as more projects are opened. There is no eviction policy.
- A single large project can consume hundreds of MB.

**Fix:** Persist Yjs documents to Redis using `y-redis` (the purpose-built Yjs persistence adapter for Redis). This also makes horizontal scaling safe — multiple app instances all share the same canonical doc.

---

### 3.2 No Database Indexes — HIGH

**File:** [apps/editor/prisma/schema.prisma](apps/editor/prisma/schema.prisma)

The schema defines foreign keys (`organizationId`, `userId`, `teamId`) on junction tables but has no `@@index` directives. Prisma does not create indexes on foreign key columns automatically (unlike some ORMs).

**Impact:** Queries like "find all projects for team X" or "find all members of org Y" do full table scans. This degrades noticeably at a few thousand rows.

**Fix:** Add `@@index` on every FK column used in `where` clauses:

```prisma
model OrganizationMember {
  @@index([organizationId])
  @@index([userId])
}
model TeamMember {
  @@index([teamId])
  @@index([userId])
}
model Project {
  @@index([teamId])
}
```

---

### 3.3 100 MB Unbounded Transfers — MEDIUM

**Files:** [apps/editor/server.ts](apps/editor/server.ts#L33), [apps/editor/next.config.ts](apps/editor/next.config.ts#L18)

Both the Socket.io buffer and the Server Action body limit are set to 100 MB. There is no streaming or chunked transfer for large scenes. A cold join on a large project sends the entire scene graph as a single synchronous buffer.

**Fix:** Stream the initial scene load in chunks. Use Yjs's incremental sync protocol (sub-document ranges) rather than full state dumps for large scenes. Lower the Socket.io `maxHttpBufferSize` and add a server-side scene size limit.

---

### 3.4 No Pagination — MEDIUM

Project and team list queries are unbounded. As the dataset grows these queries will slow and eventually timeout.

**Fix:** Add cursor-based or offset pagination to all list Server Actions. Use Prisma's `take` / `skip` or `cursor` options.

---

### 3.5 R2 Reads Not Cached — MEDIUM

Scene state is fetched from Cloudflare R2 on every project open with no CDN or in-process cache. Cold reads add latency proportional to scene size.

**Fix:** Set a `Cache-Control` header on R2 objects and route reads through the Cloudflare CDN. Alternatively, cache the last-fetched state in Redis with a short TTL keyed by project ID + `updatedAt`.

---

### 3.6 Single App Server — MEDIUM

Docker Compose runs one Next.js + Socket.io process. The Redis adapter is configured, meaning the code is ready for horizontal scaling, but there is no load balancer and no replicas defined.

**Fix:** When traffic demands it, add `replicas: N` in the Compose file and put a load balancer in front with sticky sessions (or switch to stateless Socket.io via the Redis adapter alone).

---

### 3.7 No Soft Delete or Data Recovery — LOW

Deleting a project, team, or organisation is permanent. There is no trash / soft-delete mechanism and no point-in-time recovery for user data.

---

### 3.8 No Scene Versioning — LOW

Each save overwrites `stateUrl` in PostgreSQL and replaces the R2 object. There is no history of previous scene states, making rollback impossible.

---

## 4. Testing & Code Quality Audit

### 4.1 Zero Test Coverage — HIGH

There are no test files anywhere in the monorepo. No unit tests, no integration tests, no E2E tests. No test runner is configured (Vitest, Jest, Playwright, Cypress).

**Impact:** Regressions in critical geometry code (wall mitering, CSG operations, Yjs sync) go undetected until users report them. Refactoring is high-risk.

**Recommended test pyramid:**
1. **Unit** — geometry algorithms in `packages/core` (wall intersection, polygon clipping, BVH queries). These are pure functions and easy to test.
2. **Integration** — Yjs + Socket.io sync round-trips. Spin up the server, connect two clients, assert convergence.
3. **E2E** — Playwright for the collaboration flow: two users editing the same project, seeing each other's cursors and changes.

---

### 4.2 TypeScript Build Errors Suppressed — HIGH

**File:** [apps/editor/next.config.ts](apps/editor/next.config.ts#L4-L6)

```ts
typescript: {
  ignoreBuildErrors: true,
}
```

**Impact:** The production build silently ships type errors. Type errors in TypeScript are often real bugs — undefined access, wrong argument types, missing null checks.

**Fix:** Remove this flag. Fix the underlying type errors. Accept that the build will fail when types are wrong — that is the correct behaviour.

---

### 4.3 Biome Lint Rules Disabled — HIGH

**File:** [biome.json](biome.json)

Key safety rules are disabled: `noConsole`, `noExplicitAny`, `noUnusedVariables` (and others). The `any` type is widespread in Yjs update handlers, removing type safety at the exact boundary where untrusted data enters.

**Fix:** Re-enable rules incrementally. Start with `noExplicitAny` in the packages that are published to npm — these have public APIs that should be typed correctly.

---

### 4.4 No Pre-commit Hooks — MEDIUM

There are no pre-commit hooks (Husky / lint-staged). Formatting, linting, and type-checking are not enforced before commits reach the repository.

**Fix:** Add Husky with lint-staged. Run `biome check` and `tsc --noEmit` on staged files before each commit.

---

### 4.5 No React Error Boundaries — MEDIUM

The Three.js canvas and main editor view have no React error boundaries. A runtime error in any 3D component propagates upward and crashes the entire page.

**Fix:** Wrap the `<Canvas>` and major editor sections in error boundaries that show a recovery UI rather than a white screen.

---

### 4.6 No Socket Reconnect Logic — MEDIUM

If the Socket.io connection drops (network blip, server restart), there is no automatic reconnect-and-resync flow. Users must reload the page to resume collaboration.

**Fix:** Implement the Socket.io `reconnect` event handler to re-join the project room and re-run the Yjs sync handshake.

---

## 5. Infrastructure & Deployment Audit

### 5.1 Deploy Workflow Corrupted — CRITICAL

**File:** [.github/workflows/deploy.yml](.github/workflows/deploy.yml)

The file is ~10,700 lines long, the vast majority being random keystrokes (thousands of repeated characters). Only the last ~20 lines contain valid YAML. The workflow will fail to parse and automated deployments will not run.

**Fix:** Delete the file and rewrite it cleanly:

```yaml
name: Deploy to VPS
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Copy to VPS
        uses: appleboy/scp-action@master
        with:
          host: ${{ secrets.VPS_IP }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          source: "."
          target: ${{ secrets.DEPLOY_PATH }}
          exclude: "node_modules,.git,.next,dist,.env,*.log"
      - name: Build and start
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_IP }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd ${{ secrets.DEPLOY_PATH }}
            docker-compose up --build -d
            docker image prune -f
```

---

### 5.2 No Database Backups — HIGH

`docker-compose.yml` defines a `pgdata` volume for PostgreSQL but no backup service. A disk failure, accidental `docker volume rm`, or botched migration permanently destroys all user data.

**Fix:** Add a scheduled `pg_dump` container (e.g., `prodrigesf/postgres-backup-s3`) that writes daily backups to Cloudflare R2 or another remote store.

---

### 5.3 No Health Check on App Container — HIGH

**File:** [docker-compose.yml](docker-compose.yml)

`db` and `redis` have `healthcheck` directives. The `app` container does not. Docker has no signal when the Next.js process crashes internally, so it will not restart and dependent containers won't know about the failure.

**Fix:** Add a health check to the `app` service:

```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:3002/api/health || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
```

And add a `/api/health` route that returns `200 OK`.

---

### 5.4 No Zero-Downtime Deploy — MEDIUM

`docker-compose up --build -d` rebuilds and restarts all containers simultaneously. During the build and startup period (which can take several minutes) the service is unavailable.

**Fix:** For a single-VPS setup, use a blue/green swap with two Compose service definitions and a Caddy upstream swap. For a more formal setup, migrate to Docker Swarm or Kubernetes.

---

### 5.5 No Error Tracking — MEDIUM

PostHog is integrated for product analytics. There is no error tracking (Sentry or equivalent). Runtime exceptions in production are invisible unless a user reports them.

**Fix:** Add `@sentry/nextjs`. Sentry's Next.js SDK instruments both client and server automatically. Configure source maps so stack traces point to original TypeScript.

---

### 5.6 No Structured Logging — MEDIUM

The server uses `console.log` and `console.error` throughout. There is no log levels, no structured JSON output, and no log aggregation.

**Fix:** Replace `console.log` calls in `server.ts` with a structured logger (pino is the standard for Node.js). Ship logs to a service (Logtail, Axiom, Datadog) for querying and alerting.

---

### 5.7 Redis Has No Persistence — MEDIUM

Redis 7-alpine has no persistence configuration in `docker-compose.yml`. By default, Redis uses no AOF and RDB snapshots only every 15 minutes. A crash loses up to 15 minutes of Socket.io session state.

If Yjs documents are migrated to Redis (see §3.1), this becomes more serious — a Redis restart without persistence would also lose all in-flight scene state.

**Fix:** Enable AOF persistence: add `command: redis-server --appendonly yes` to the Redis service.

---

### 5.8 No Staging Environment — LOW

All deployments go directly to production. There is no staging environment to validate changes before they reach users.

---

## 6. Real-Time Collaboration Audit

### What Is Working Well

| Item | Notes |
|---|---|
| Yjs CRDT | Correct choice for collaborative editing. Eventual consistency, merge-free conflict resolution, offline-capable. |
| Three-step sync handshake | State vector exchange on join ([server.ts:60-75](apps/editor/server.ts#L60-L75)) follows the Yjs protocol correctly. |
| Redis adapter | Socket.io Redis adapter is wired up, enabling horizontal scaling when the app is replicated. |
| Throttled presence | Presence/cursor updates are throttled — good bandwidth hygiene. |
| LERP interpolation | Smooth cursor movement via linear interpolation on the client. |

### Gaps

**Unauthenticated join (HIGH):** Covered in §2.2 — any client can join any room.

**No Yjs update validation (HIGH):** Covered in §2.5 — malformed updates are applied directly to the shared doc.

**No reconnect flow (MEDIUM):** Covered in §4.6.

**Silent merges (MEDIUM):** When two users edit the same wall concurrently, Yjs silently merges the changes. Users have no indication a merge occurred, and the result may be surprising. Consider surfacing a merge notification in the UI.

**No session history (LOW):** Awareness data (who was present, when) is not persisted. There is no activity log at the project level.

---

## 7. Priority Action Matrix

| Priority | Issue | Est. Effort |
|---|---|---|
| CRITICAL | Rotate R2 credentials; remove `.env.production` from repo and git history | 1 hour |
| CRITICAL | Rewrite corrupted `deploy.yml` (see §5.1) | 1 hour |
| HIGH | Add Socket.io authentication middleware | 2–4 hours |
| HIGH | Remove hardcoded `NEXTAUTH_SECRET` fallback | 30 min |
| HIGH | Validate Yjs updates with Zod schema | 1–2 days |
| HIGH | Add database indexes to Prisma schema (4 `@@index` lines) | 30 min |
| HIGH | Persist Yjs docs to Redis (`y-redis`) | 2–3 days |
| HIGH | Add database backup service | 2 hours |
| HIGH | Add health check to app Docker service | 1 hour |
| HIGH | Add rate limiting to auth endpoints + Socket.io | 4–6 hours |
| HIGH | Remove `ignoreBuildErrors: true`; fix type errors | 1–3 days |
| MEDIUM | Set up Vitest for unit tests (`packages/core` geometry) | 3–5 days |
| MEDIUM | Add Sentry for error tracking | 2–4 hours |
| MEDIUM | Add structured logging (pino) | 1 day |
| MEDIUM | Enable Redis AOF persistence | 30 min |
| MEDIUM | Implement Socket.io reconnect + resync | 1 day |
| MEDIUM | Add React error boundaries | 2–4 hours |
| MEDIUM | Add Husky pre-commit hooks | 1 hour |
| MEDIUM | Add pagination to list queries | 2–4 hours |
| MEDIUM | Lock `next.config.ts` remote image patterns | 30 min |
| MEDIUM | Fix weak PostgreSQL credentials | 30 min |
| LOW | Add email verification and password reset | 3–5 days |
| LOW | Add staging environment | 1–2 days |
| LOW | Scene versioning / history | 5+ days |
| LOW | Audit log (who changed what) | 3–5 days |
| LOW | MFA support | 3–5 days |

---

## 8. What Is Already Good

This section documents strengths to preserve as the system matures.

- **Turborepo monorepo structure** is well-organised with clean package boundaries. `packages/core` and `packages/viewer` are already published to npm, making future white-labelling or embedding straightforward.
- **Yjs + Socket.io** is the right collaboration stack. The three-step state vector handshake is implemented correctly.
- **Hybrid storage** (PostgreSQL for relational data + R2 for large scene graphs) is the correct architectural split.
- **Spatial indexing** (BVH, spatial grids) for 3D queries shows thoughtful performance design.
- **Bcryptjs** for password hashing is correct.
- **CORS** in production mode is locked to `archly.cloud`.
- **Caddy** provides automatic HTTPS — no manual certificate management.
- **PostHog** gives early product analytics.
- **Early access queue** with admin approval is a sensible beta onboarding pattern.
- **Zundo** for undo/redo is a clean integration.
- **Throttled presence broadcasting** shows bandwidth awareness.

---

*End of audit. Last updated: 2026-04-28.*
