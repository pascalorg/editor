# Codebase Concerns

**Analysis Date:** 2026-04-28

## Tech Debt

**Suppressed TypeScript Build Errors:**
- Issue: `apps/editor/next.config.ts` sets `ignoreBuildErrors: true`, allowing type errors to ship to production
- Files: `apps/editor/next.config.ts` (lines 4-6)
- Impact: Type errors are silent but often indicate real bugs (undefined access, wrong argument types, missing null checks). Regressions go undetected until users report them
- Fix approach: Remove the `ignoreBuildErrors` flag. Fix underlying type errors systematically. Accept that builds fail when types are wrong — that is the correct behavior

**Disabled Linting Rules:**
- Issue: Key safety rules disabled in `biome.jsonc`: `noExplicitAny`, `noConsole`, `noUnusedVariables`, `noUnusedFunctionParameters`
- Files: `biome.jsonc` (lines 28-90)
- Impact: `any` type is widespread in Yjs update handlers, removing type safety at exactly the boundary where untrusted data enters. Dead code and console leaks accumulate
- Fix approach: Re-enable rules incrementally, starting with `noExplicitAny` in published packages (`@pascal-app/core`, `@pascal-app/viewer`). Use rule overrides for legacy code while fixing violations

**In-Memory Yjs Document Storage:**
- Issue: Yjs documents stored in server memory only via `const docs = new Map<string, Y.Doc>()`
- Files: `apps/editor/server.ts` (line 20)
- Impact: Process restart (deploy, crash, OOM kill) discards all in-flight collaboration state — users lose unsaved changes. Memory grows unboundedly as more projects are opened with no eviction policy. A single large project can consume hundreds of MB. Horizontal scaling is unsafe (each instance has different docs)
- Fix approach: Persist Yjs documents to Redis using `y-redis` adapter. This also enables safe horizontal scaling with multiple app instances sharing canonical state

**Missing Database Indexes on Foreign Keys:**
- Issue: Prisma schema defines foreign keys but lacks `@@index` directives on `organizationId`, `userId`, `teamId` in junction and relation tables
- Files: `apps/editor/prisma/schema.prisma` (models: OrganizationMember, TeamMember, ProjectMember, MarketplaceAsset, ProjectClone)
- Impact: Queries like "find all projects for team X" or "find all members of org Y" perform full table scans. Degradation is noticeable at several thousand rows. Already present indexes (e.g., lines 65-66, 101-102) were added but coverage is incomplete
- Fix approach: Verify all FK columns used in `where` clauses have indexes. `Team` model missing `@@index([organizationId])`. Add systematically across all models with FK queries

**No Pagination on List Queries:**
- Issue: Project and team list queries are unbounded in Server Actions
- Files: `apps/editor/app/dashboard/actions.ts` (getDashboardData includes full nested include without limits)
- Impact: As dataset grows, queries slow and eventually timeout. Response payloads grow unboundedly
- Fix approach: Add cursor-based or offset pagination to all list operations. Use Prisma's `take`/`skip` or cursor options with a default limit (e.g., 20-50 items)

**No Cache Layer for R2 Reads:**
- Issue: Scene state fetched from Cloudflare R2 on every project open with no CDN or in-process cache
- Files: `apps/editor/app/project/actions.ts` (loadProject function, implementation not inspected)
- Impact: Cold reads add latency proportional to scene size. Repeated access to same scene incurs repeated network round-trips
- Fix approach: Set `Cache-Control` headers on R2 objects. Route reads through Cloudflare CDN. Alternatively, cache last-fetched state in Redis with short TTL keyed by projectId + updatedAt timestamp

**Unbounded Transfer Limits:**
- Issue: Socket.io buffer and Server Action body limit both set to 100 MB with no streaming
- Files: `apps/editor/server.ts` (line 33), `apps/editor/next.config.ts` (line 18)
- Impact: Cold join on large project sends entire scene graph as single synchronous buffer. No chunking or incremental sync. Network timeouts on slow connections
- Fix approach: Stream initial scene load in chunks. Use Yjs incremental sync protocol (sub-document ranges) rather than full state dumps. Lower `maxHttpBufferSize` and implement server-side scene size limit

**No No Soft Delete or Data Recovery:**
- Issue: Deleting a project, team, or organization is permanent with no trash mechanism
- Files: `apps/editor/prisma/schema.prisma` (all delete operations cascade without soft-delete)
- Impact: Accidental deletion permanently destroys user data with no recovery path
- Fix approach: Add `deletedAt` field to Project, Team, Organization models. Implement soft-delete pattern. Add recovery UI in admin panel with 30-day grace period

**No Scene Versioning or History:**
- Issue: Each save overwrites `stateUrl` in PostgreSQL and replaces R2 object without retaining history
- Files: `apps/editor/app/project/actions.ts` (saveProject function)
- Impact: No rollback capability. No audit trail of scene evolution. Users cannot recover previous versions
- Fix approach: Store scene versions in R2 with versioned keys (e.g., `project/{id}/scene/{timestamp}.json`). Keep pointer to latest in database. Implement version browser UI

---

## Known Bugs

**No Socket.io Reconnect Flow:**
- Symptoms: Socket connection drops (network blip, server restart) disconnects user. Must reload page to resume collaboration
- Files: `apps/editor/server.ts`, `apps/editor/lib/socket.ts`
- Trigger: Network interruption, server process restart, client goes to sleep
- Workaround: User manually reloads page

**Silent Yjs Merges Without UI Feedback:**
- Symptoms: When two users edit same wall concurrently, Yjs silently merges changes. Users have no indication merge occurred; result may be surprising
- Files: `apps/editor/server.ts` (yjs-update handler), packages/core collaboration logic
- Trigger: Concurrent edits on same entity
- Workaround: None — behavior is silent

**No Error Boundary on Three.js Canvas:**
- Symptoms: Runtime error in any 3D component crashes entire page (white screen)
- Files: `apps/editor/app/editor/[id]/EditorClient.tsx` (Editor component with Canvas has no error boundary)
- Trigger: 3D rendering error, shader compile error, geometry parsing error
- Workaround: Hard refresh browser

---

## Security Considerations

**Unauthenticated Socket.io Access — HIGH:**
- Risk: Any unauthenticated actor can open WebSocket to server, join any project room by guessing project ID, receive or inject scene updates
- Files: `apps/editor/server.ts` (lines 43-103, no auth middleware)
- Current mitigation: None
- Recommendations: Add Socket.io `auth` middleware that validates NextAuth JWT before allowing connection. Token should encode user ID. On `join-project`, verify user is member of project's team before joining room. Check ProjectMember and TeamMember relations in database

**No Input Validation on Yjs Updates — HIGH:**
- Risk: Malicious client can send crafted Yjs update that applies arbitrary data to shared document, corrupting project state for all users in room
- Files: `apps/editor/server.ts` (lines 77-93, directly applies update without schema check)
- Current mitigation: None
- Recommendations: Define Zod schema for scene entities. Validate decoded Yjs map values after applying update. Reject updates that don't conform. Consider using `y-protocols` for safer update handling

**Hardcoded Fallback Auth Secret — HIGH:**
- Risk: If `NEXTAUTH_SECRET` missing from environment (misconfiguration, accidental omission), sessions signed with known public constant. Any attacker forges valid session tokens
- Files: `apps/editor/lib/auth.ts` (line 59 references `process.env.NEXTAUTH_SECRET` without fallback in production)
- Current mitigation: Fallback is removed in current version (checked 2026-04-28)
- Recommendations: Verify NEXTAUTH_SECRET is always set. Add startup check that throws if missing in production

**Overly Permissive Image Remote Patterns — MEDIUM:**
- Risk: `next.config.ts` allows Next.js Image Optimization to proxy and optimize images from ANY URL (`hostname: '**'`). Can be abused for SSRF or to incur bandwidth costs
- Files: `apps/editor/next.config.ts` (lines 23-31)
- Current mitigation: None
- Recommendations: Lock `remotePatterns` to specific trusted hostnames (R2 bucket domain, your CDN). Remove wildcard patterns

**Weak PostgreSQL Credentials — MEDIUM:**
- Risk: Database credentials are trivially guessable (`POSTGRES_USER=pascal`, `POSTGRES_PASSWORD=pascal`)
- Files: `docker-compose.yml` (lines 36-37)
- Current mitigation: None
- Recommendations: Generate strong random password. Store in `.env.production` (which itself should not be in source control). Rotate in Docker Compose at runtime from GitHub Secrets

**No Rate Limiting — HIGH:**
- Risk: Login endpoints are brute-forceable. Socket.io `yjs-update` events can be flooded (100 MB buffer means single malicious client exhausts server memory). Early-access application endpoint is spammable
- Files: `apps/editor/app/api/auth/signup/route.ts`, `apps/editor/server.ts`, `apps/editor/app/apply/actions.ts`
- Current mitigation: None
- Recommendations: Add rate limiting at Caddy layer (basic) and application layer using `@upstash/ratelimit` (Redis-backed, works in Next.js Server Actions) or `socket.io-rate-limiter`. Apply to login, signup, Socket.io events

**No Email Verification on Signup:**
- Risk: Anyone can register with fake email address, preventing legitimate owners from claiming account
- Files: `apps/editor/app/api/auth/signup/route.ts` (creates user without verification)
- Current mitigation: None
- Recommendations: Send verification email on signup. Disable login until email verified. Add email verification token expiry

**No Password Reset Flow — MEDIUM:**
- Risk: Users permanently locked out if they forget password. No recovery path
- Files: No password reset endpoint exists
- Current mitigation: None
- Recommendations: Implement password reset flow: email with token, token validation, password update endpoint

**No Session Revocation UI — MEDIUM:**
- Risk: User cannot manually log out all sessions or revoke specific device access
- Files: No logout endpoint
- Current mitigation: None
- Recommendations: Add logout endpoint that invalidates JWT. Add "Log out everywhere" UI. Store session list in database if needed for granular revocation

**No MFA Support — MEDIUM:**
- Risk: Account takeover via compromised password
- Files: NextAuth config only supports credentials provider
- Current mitigation: None
- Recommendations: Add TOTP support via `speakeasy` or `otplib`. Require MFA for organization admins and workspace owners

**No Audit Log — LOW:**
- Risk: No record of who changed what in a project or when. Needed for enterprise customers and compliance
- Files: No audit log model in Prisma schema
- Current mitigation: None
- Recommendations: Add AuditLog model tracking userId, action, resourceType, resourceId, timestamp, metadata. Log all CRUD operations on projects, teams, permissions

---

## Performance Bottlenecks

**Unbounded N+1 Query in getDashboardData:**
- Problem: `getDashboardData` uses nested `include` without pagination or limits. Loads entire organization, all teams, all projects, all members
- Files: `apps/editor/app/dashboard/actions.ts` (lines 8-38)
- Cause: Full nested eager loading of related data. No `take` or pagination
- Improvement path: Implement separate queries for dashboard sections. Load organizations, load user's teams separately with pagination, load projects on-demand. Use Prisma DataLoader to batch queries

**Memory Leak in Socket.io Rooms:**
- Problem: No cleanup of in-memory Yjs docs when project is no longer needed. Room persists indefinitely
- Files: `apps/editor/server.ts` (docs Map never evicts entries)
- Cause: No TTL or LRU cache eviction. No cleanup on last user disconnect
- Improvement path: Implement TTL-based eviction (e.g., 1 hour of inactivity). Add cleanup handler when last user leaves project room. Consider cron job to prune old docs

**Unoptimized 3D Scene Rendering:**
- Problem: Large floor plans with many geometry objects cause frame drops. No culling or LOD
- Files: `packages/viewer/src/components/renderers/` (all renderers load full geometry)
- Cause: All geometry loaded and rendered even if off-screen. No spatial partitioning or level-of-detail
- Improvement path: Implement frustum culling. Use LOD for distant objects. Profile with Three.js stats panel. Consider point cloud rendering for large scenes

---

## Fragile Areas

**Wall Intersection and Geometry Logic:**
- Files: `packages/core/src/systems/wall/wall-system.tsx`, `packages/core/src/lib/space-detection.ts`
- Why fragile: Complex spatial geometry operations (wall mitering, CSG, polygon clipping) with no test coverage. Easy to introduce regressions when refactoring
- Safe modification: Always add unit tests for new geometry logic before refactoring. Use property-based testing for invariants (e.g., intersection results are valid). Keep geometry functions pure
- Test coverage: Zero unit tests

**Stair Geometry Calculation:**
- Files: `packages/core/src/systems/stair/stair-system.tsx` (1122 lines), `packages/viewer/src/components/renderers/stair/stair-renderer.tsx` (1147 lines)
- Why fragile: Large monolithic components handling parametric stair generation. Any change to staircase math affects all projects using stairs
- Safe modification: Extract pure geometry functions. Add parametric tests (sweep through staircase parameters, verify output validity). Keep UI logic separate from math
- Test coverage: Zero tests

**Real-Time Collaboration State Sync:**
- Files: `apps/editor/server.ts` (Socket.io handlers), `packages/editor/src/` (YjsCollaborationProvider)
- Why fragile: Yjs document updates applied without validation. No error recovery. State divergence on malformed updates
- Safe modification: Add comprehensive logging before/after Yjs updates. Test conflict resolution with property-based testing. Add validation layer with Zod. Consider adding merkle hash verification
- Test coverage: Zero integration tests for collaboration round-trips

**Dashboard Data Loading:**
- Files: `apps/editor/app/dashboard/actions.ts` (getDashboardData function)
- Why fragile: Deeply nested data fetching with no error handling. If any level fails, entire dashboard breaks
- Safe modification: Add try-catch and return partial data. Test with missing relations (user not in org, team not in org). Implement graceful degradation
- Test coverage: Zero tests

**Project Save to R2:**
- Files: `apps/editor/app/project/actions.ts` (saveProject, not inspected but referenced)
- Why fragile: Network call to R2 can fail. No retry logic or failure notification
- Safe modification: Add retry with exponential backoff. Implement local cache as fallback. Queue saves if network fails. Add user notification on save failure
- Test coverage: Unknown (file not inspected)

---

## Scaling Limits

**Single App Server:**
- Current capacity: 1 Next.js + Socket.io process in Docker
- Limit: Single process can handle ~100-200 concurrent WebSocket connections before becoming CPU-bound. Memory limit hit with ~50-100 large projects
- Scaling path: Add `replicas: N` in docker-compose.yml. Put load balancer in front (Caddy can do this). Ensure Redis adapter for Socket.io (already configured). Session persistence via JWT means clients can reconnect to any replica

**Redis for Socket.io Adapter Only:**
- Current capacity: Pub/sub for Socket.io room broadcasts. No persistence
- Limit: A single Redis instance can handle ~10k concurrent connections
- Scaling path: Migrate Yjs documents to Redis (use `y-redis`). Enable AOF persistence. Add Redis replication or Sentinel for HA

**PostgreSQL in Docker:**
- Current capacity: Docker container with default shared memory and ulimits. Single replica
- Limit: At 5-10k projects with complex queries, starts hitting CPU/memory limits
- Scaling path: Increase container resource limits. Add read replicas for analytics/dashboard queries. Implement connection pooling (PgBouncer). Run on managed PostgreSQL (AWS RDS, Supabase)

**Cloudflare R2 for Scene Storage:**
- Current capacity: Object storage with no local cache. All reads hit R2
- Limit: R2 API has rate limits per second. Cold reads add 100-500ms latency
- Scaling path: Enable CDN caching. Implement local Redis cache layer. Compress scene JSON before storing

---

## Dependencies at Risk

**Next.js 16.2 with Deprecated App Router Patterns:**
- Risk: `ignoreBuildErrors: true` suppresses build errors that will fail in future versions
- Impact: Major version upgrades will surface many hidden type errors at once
- Migration plan: Fix type errors now. Remove error suppression. Enable strict TypeScript config incrementally

**Socket.io 4.8 with Tight Coupling to Server Process:**
- Risk: Socket.io state stored in-memory. Moving to Socket.io 5 requires Redis persistence
- Impact: Horizontal scaling currently possible but fragile. Future versions may require different approach
- Migration plan: Implement `y-redis` for Yjs document persistence (independent of Socket.io version). Plan for Socket.io 5 migration when Next.js 17 releases

**PostHog for Analytics Without Error Tracking:**
- Risk: No Sentry/Rollbar integration. Runtime errors invisible to team
- Impact: Production bugs go undetected. No alert on critical errors
- Migration plan: Add `@sentry/nextjs`. Export errors from Sentry to PostHog for cohesive observability

**Prisma 5.10 with Custom Client Output:**
- Risk: Custom `output: "./generated-client"` path non-standard
- Impact: Build tooling may not find client automatically in future versions
- Migration plan: Migrate to standard location. Update build scripts. Test with Prisma 6 when it releases

---

## Missing Critical Features

**No Test Infrastructure:**
- Problem: Zero test coverage. No unit, integration, or E2E tests anywhere in monorepo
- Blocks: Confident refactoring of critical geometry logic. Regression detection. Type safety beyond static analysis
- Fix approach: Phased rollout: (1) Set up Vitest + coverage reporting. (2) Add unit tests for geometry in `packages/core` (highest ROI). (3) Add integration tests for Socket.io + Yjs sync. (4) Add E2E tests with Playwright for collaboration flow

**No Error Tracking in Production:**
- Problem: PostHog only tracks product events, not errors. Runtime exceptions invisible unless user reports
- Blocks: Proactive debugging. Understanding error patterns. Alerting on critical failures
- Fix approach: Integrate Sentry. Configure source maps. Set up error alerts in Slack/PagerDuty

**No Structured Logging:**
- Problem: `console.log` throughout codebase. No log levels, no JSON output, no aggregation
- Blocks: Debugging production issues. Searching logs. Alerting on patterns
- Fix approach: Replace `console.log` with structured logger (pino). Ship to log aggregation service (Logtail, Axiom, Datadog)

**No Health Monitoring on App Container:**
- Problem: Docker Compose has no healthcheck on app service. Database and Redis have healthchecks
- Blocks: Docker can't detect silent failures (Next.js process crashes but container stays running). No restart on process death
- Fix approach: Add healthcheck directive. Implement `/api/health` endpoint that checks database and Redis connectivity

**No Staging Environment:**
- Problem: All deployments go directly to production
- Blocks: Validating changes before reaching users. Testing migrations. Smoke testing on production-like environment
- Fix approach: Set up staging on second VPS. Mirror production configuration. Deploy to staging before main branch merges

**No Database Backup Service:**
- Problem: `docker-compose.yml` defines `pgdata` volume but no automated backups
- Blocks: Data recovery after disk failure, accidental deletion, or corrupted migration
- Fix approach: Add `prodrigesf/postgres-backup-s3` container or similar. Run daily dumps to R2. Test restore procedure regularly

---

## Test Coverage Gaps

**Geometry Algorithms Untested:**
- What's not tested: Wall mitering, polygon clipping, CSG operations, staircase parametrics, roof generation, space detection
- Files: `packages/core/src/systems/wall/`, `packages/core/src/systems/stair/`, `packages/core/src/systems/roof/`, `packages/core/src/lib/space-detection.ts`
- Risk: Changes to core algorithms go undetected. Complex geometry bugs only discovered by users
- Priority: High

**Real-Time Collaboration Round-Trips Untested:**
- What's not tested: Yjs sync handshake, concurrent updates merging, awareness presence, Socket.io reconnect
- Files: `apps/editor/server.ts`, `packages/editor/src/lib/YjsCollaborationProvider`
- Risk: Collaboration bugs only surface in multi-user scenarios. Hard to debug in production
- Priority: High

**Authorization Checks Untested:**
- What's not tested: Project member access control, team permissions, organization role hierarchy
- Files: `apps/editor/app/dashboard/actions.ts`, `apps/editor/app/api/projects/[projectId]/members/route.ts`
- Risk: Permission bugs silently allow unauthorized access until discovered by audit
- Priority: High

**API Route Error Handling Untested:**
- What's not tested: Invalid input, missing auth, database errors, R2 timeouts
- Files: `apps/editor/app/api/auth/signup/route.ts`, `apps/editor/app/api/marketplace/clone/route.ts`, `apps/editor/app/api/upload/presign/route.ts`
- Risk: Malformed requests may crash server or leak error details
- Priority: Medium

**UI Component Error States Untested:**
- What's not tested: Loading states, error boundaries, fallback UI, timeout handling
- Files: `apps/editor/app/dashboard/_components/`, `apps/editor/app/editor/[id]/EditorClient.tsx`
- Risk: UI breaks silently on network failures or slow connections
- Priority: Medium

---

## Code Quality Observations

**Widespread use of `any` Type:**
- Files: `apps/editor/server.ts` (Yjs handlers), `apps/editor/app/editor/[id]/EditorClient.tsx` (line 39: `scene: any`)
- Impact: No type safety at data boundaries. Easy to pass wrong data structure by accident
- Recommendation: Use Zod schemas or TypeScript types. Define `type SceneGraph = ...` and validate at runtime

**No Error Context in Server Actions:**
- Files: `apps/editor/app/dashboard/actions.ts` (uses bare `throw new Error("Unauthorized")`)
- Impact: Client can't distinguish between different error types (auth vs validation vs server error). Generic error messages
- Recommendation: Use error codes or custom error classes. Example: `throw new UnauthorizedError("User not authenticated")`. Return structured error responses with codes

**Unused Variables Allowed by Linter:**
- Files: Throughout codebase (linter rule `noUnusedVariables: off`)
- Impact: Dead code accumulates. Confuses future maintainers
- Recommendation: Re-enable rule. Use underscore prefix for intentionally unused params: `const _unused = ...`

---

*Concerns audit: 2026-04-28*
