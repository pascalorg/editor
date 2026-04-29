# Pitfalls Research

**Domain:** Figma-like SaaS platform layer — dashboard, team RBAC, marketplace, onboarding, designer profiles
**Researched:** 2026-04-28
**Confidence:** HIGH (most pitfalls verified against live codebase + official documentation)

---

## Critical Pitfalls

### Pitfall 1: Server Actions Treated as Internal Functions, Not Public API Endpoints

**What goes wrong:**
Server Actions in Next.js App Router are callable directly by any HTTP client — they are not protected by page-level middleware or route guards. The current codebase already has this gap: `createTeam`, `createProject`, and `inviteMember` in `dashboard/actions.ts` check authentication but do NOT verify that the caller is an OWNER or ADMIN of the target organization before mutating data. Any authenticated user who knows an `organizationId` can create teams in or invite members to an org they do not belong to.

**Why it happens:**
Developers treat `"use server"` as a signal of server-side safety and assume the page-level layout auth guard covers the action. It does not — actions are separate HTTP endpoints.

**How to avoid:**
Every Server Action that modifies data must independently verify: (1) session exists, (2) the acting user is a member of the target resource, (3) the user holds the minimum required role for that operation. Extract a reusable `assertOrgRole(userId, orgId, minRole)` helper that throws `Unauthorized` and call it at the top of every mutating action before any Prisma write.

**Warning signs:**
- Server Actions that call `getServerSession` but do not then verify membership in the target entity
- Any action that accepts an `organizationId`, `teamId`, or `projectId` as a parameter without a subsequent authorization check against session user
- The pattern `if (!session?.user?.email) throw new Error("Unauthorized")` followed immediately by a Prisma write with a user-supplied ID

**Phase to address:** RBAC / Dashboard phase — before any invite or create flow ships

---

### Pitfall 2: Google OAuth + Credentials Provider Account Collision

**What goes wrong:**
When a user registers with email/password, then later signs in with Google using the same email address, NextAuth v4 throws `OAuthAccountNotLinked` and blocks the sign-in entirely. Alternatively, if you enable `allowDangerousEmailAccountLinking`, you open an account hijacking vector: an attacker creates a Google account with a victim's email to take over their credentials account. The current schema and `authOptions` only configure `CredentialsProvider` — adding Google will hit this immediately on the first real user who tries both paths.

**Why it happens:**
NextAuth v4 has no built-in merge flow for credentials-to-OAuth account linking. The Prisma adapter stores separate `Account` rows per provider, but the `Credentials` provider deliberately does not create an `Account` row, making automatic linking impossible without a database adapter.

**How to avoid:**
1. Add the Prisma adapter (`@auth/prisma-adapter`) when introducing Google OAuth. Without it, NextAuth cannot persist OAuth accounts at all in v4.
2. Implement an explicit account linking screen: after Google sign-in, if the email already exists as a credentials account, present a "Link accounts" prompt requiring the user to confirm their password first.
3. Never enable `allowDangerousEmailAccountLinking` without email verification on the credentials side. Since the current signup flow has no email verification, enabling this flag is an account hijacking vulnerability.
4. Show a clear error message: "An account with this email exists. Sign in with email/password to link your Google account."

**Warning signs:**
- No Prisma Adapter configured alongside GoogleProvider
- Signup route creates users without setting `emailVerified`
- `allowDangerousEmailAccountLinking: true` appears in provider config without a corresponding email verification check

**Phase to address:** Authentication phase — before Google OAuth is added

---

### Pitfall 3: Missing Tenant Scope on Every Prisma Query (Data Leakage Between Organizations)

**What goes wrong:**
The current `getDashboardData()` fetches the user's organizations and returns all nested data. However, any action that accepts a raw `teamId` or `projectId` and queries by it directly (without also asserting `WHERE organizationId = userOrgId`) can return data belonging to a different tenant if a user submits an ID they do not own. The marketplace clone route already demonstrates this partially: it finds the cloner's first team by OWNER/ADMIN role, but does not prevent a non-owner from supplying a `teamId` from a different org (since team lookup is by session membership, it is safe today — but this assumption breaks the moment team selection becomes user-supplied).

**Why it happens:**
Prisma does not auto-scope queries to a tenant. Developers rely on "the user can only see their data" UI assumption, but Server Actions accept raw IDs from the client.

**How to avoid:**
Every `prisma.project.findUnique({ where: { id } })` used in an action with a user-supplied ID must be followed by: verify the result's `team.organizationId` matches the session user's org before proceeding. Consider a Prisma extension or middleware layer that auto-injects organization scope. Add composite `@@index` on `(teamId, organizationId)` and `(projectId, teamId)` to make scoped lookups fast.

**Warning signs:**
- Any action that does `prisma.project.findUnique({ where: { id: userSuppliedId } })` without a membership check on the result
- Dashboard queries that load an unbounded amount of nested data without pagination (also a performance problem as orgs grow)

**Phase to address:** RBAC / Dashboard phase — establish the scoping pattern before building any per-resource endpoints

---

### Pitfall 4: Onboarding Completion State Not Persisted — Users Loop Back

**What goes wrong:**
The current onboarding `actions.ts` checks `if (existing) return { success: true }` to prevent duplicate org creation, but there is no `onboardingCompletedAt` field on the User model and no middleware guard that redirects incomplete users to onboarding. Result: a user who partially completes onboarding and navigates away lands directly on the dashboard with an empty state, or a post-signup user can skip onboarding by typing `/dashboard` manually.

**Why it happens:**
Onboarding is built as a standalone page without a state machine or completion flag. Multi-step flows that store progress only in React state lose it on any reload, back-navigation, or tab close.

**How to avoid:**
1. Add `onboardingCompletedAt DateTime?` to the User schema immediately.
2. In `middleware.ts`, redirect any authenticated user where `onboardingCompletedAt IS NULL` to `/onboarding` for all `/dashboard/*` routes.
3. Store step progress in the URL (`/onboarding?step=2`) not in React state — makes back/forward work and survives refreshes.
4. The final onboarding step's Server Action sets `onboardingCompletedAt` atomically with org creation.

**Warning signs:**
- No `onboardingCompletedAt` column or equivalent in the User model
- No middleware rule redirecting users without org membership away from `/dashboard`
- Onboarding multi-step state held only in `useState`

**Phase to address:** Onboarding phase — before multi-step flow is built

---

### Pitfall 5: Invite Flow Creates Ghost Accounts Without a Pending State

**What goes wrong:**
The current `inviteMember` action does `prisma.user.upsert({ where: { email }, create: { email, name } })` — it creates a real User record for someone who has never visited the platform. This ghost account has no password, cannot log in via credentials, and will collide with a future self-signup by that email (the signup route checks for existence and returns "account already exists"). When they sign up normally, they hit a confusing "email already taken" error even though they never registered.

**Why it happens:**
Building invite-by-email without an invitation token system is the fastest path: just create the user record and membership. The cost appears later.

**How to avoid:**
Implement a proper `Invitation` model: `{ id, email, orgId, role, token, expiresAt, acceptedAt }`. Send the invite email with a signed token URL. The invite acceptance flow either links to an existing account or completes signup. Do NOT create User records speculatively. The invitee's User record is only created when they click the accept link and authenticate.

**Warning signs:**
- `prisma.user.upsert` called from an invite action
- Users in the database with `password: null` and no linked OAuth account and no `emailVerified`
- Signup route returning "email already exists" for never-registered addresses

**Phase to address:** Team RBAC / Invite phase — design the Invitation model before building invite UI

---

## Moderate Pitfalls

### Pitfall 6: RBAC Role Checks Missing the "Commenter" Role in UI Gate Logic

**What goes wrong:**
The `ProjectRole` enum has `OWNER`, `EDITOR`, `VIEWER`, `COMMENTER`. The schema is correct. But when building UI components or Server Actions that gate on "can edit," developers commonly write `role === 'EDITOR'` instead of `role === 'EDITOR' || role === 'OWNER'`. Similarly, "can comment" checks miss `COMMENTER`. This produces silent permission gaps where OWNERs cannot edit their own projects through UI gates, or COMMENTERs see edit controls they cannot use.

**How to avoid:**
Define a capability matrix as a single source of truth:
```typescript
const CAN_EDIT: ProjectRole[] = ['OWNER', 'EDITOR']
const CAN_COMMENT: ProjectRole[] = ['OWNER', 'EDITOR', 'COMMENTER']
const CAN_VIEW: ProjectRole[] = ['OWNER', 'EDITOR', 'COMMENTER', 'VIEWER']

function hasProjectPermission(role: ProjectRole, capability: 'edit' | 'comment' | 'view') { ... }
```
Import this from a shared `lib/permissions.ts` in both Server Actions (for enforcement) and UI components (for rendering gates).

**Warning signs:**
- `role === 'EDITOR'` comparisons scattered across multiple files
- Separate permission logic in API routes vs. components

**Phase to address:** RBAC phase

---

### Pitfall 7: Marketplace Clone Silently Succeeds With No Scene State

**What goes wrong:**
The clone route in `api/marketplace/clone/route.ts` marks state copy failure as "non-fatal — project still created." A user clones an asset, gets redirected to their new project, opens the editor, and finds an empty canvas. There is no user-facing indication that the scene data failed to copy. The user has a project named "X (Clone)" with zero content and no way to know why.

**How to avoid:**
The state copy should be attempted before committing the project record. If R2 copy fails, the entire transaction should roll back (delete the orphaned project). Return a clear error: "Clone failed — source scene unavailable. Try again." Only if state copy succeeds should the project record be committed and the clone count incremented. Use Prisma's `$transaction` to make project creation + clone record atomic.

**Warning signs:**
- `try/catch` around R2 copy that swallows the error and proceeds
- `cloneCount` incremented even when state copy failed
- Project records in the database with `stateUrl: null` that originated from a clone operation

**Phase to address:** Marketplace phase

---

### Pitfall 8: Dashboard N+1 Query Pattern Baked Into the Data Layer

**What goes wrong:**
`getDashboardData()` fetches the full user with all organizations, all teams per org (with all members per team), and all projects per team in a single deeply nested `include`. As an org grows to 10 teams with 50 projects each, this returns 500+ project rows plus all member rows on every dashboard load. The `recentProjects` list takes the last 9 — so 491 projects are fetched and discarded.

**How to avoid:**
Split into separate targeted queries instead of one mega-include:
- Fetch user's org memberships (just IDs and roles)
- Fetch stat counts with `_count` aggregations (not full records)
- Fetch recent 9 projects directly with `orderBy: { updatedAt: 'desc' }, take: 9` scoped to user's org
This eliminates the over-fetch immediately and stays fast as the dataset grows.

**Warning signs:**
- `include` chains more than 2 levels deep in dashboard actions
- `allProjects = org.teams.flatMap(...)` computed in application code from a fully-loaded result set
- Response time increases linearly with org size

**Phase to address:** Dashboard phase — before the dashboard is considered production-ready

---

### Pitfall 9: TeamMember Has No Role Column

**What goes wrong:**
The current `TeamMember` model has only `teamId` and `userId` — no role. The schema supports org-level roles (`OrgRole`) and project-level roles (`ProjectRole`) but team-level roles are absent. Figma-style RBAC requires "team admin" vs. "team member" to control who can create/delete projects within a team, and who can invite new team members. Without a team role, every member has identical team-level capabilities and there is no way to delegate team administration without making someone an org admin.

**How to avoid:**
Add `role TeamRole @default(MEMBER)` to `TeamMember` with enum `TeamRole { ADMIN MEMBER }`. Plan the migration before any team invite UI is built, since adding the column after invite flows are live requires backfilling roles for existing members.

**Warning signs:**
- `TeamMember` model with no `role` field
- All team permission checks falling back to org-level role checks instead

**Phase to address:** RBAC / Schema design phase — add before building team management UI

---

### Pitfall 10: Public Designer Profiles Without Access Control on Contact Intent

**What goes wrong:**
A "contact for work" button on a public profile that simply shows an email address or opens a mailto link will attract spam at scale. Alternatively, building a full in-platform messaging system to handle contact is weeks of work that blocks the profile feature shipping. The middle path (a contact form that emails the designer) requires transactional email infrastructure and rate-limiting.

**How to avoid:**
Ship designer profiles in two stages: Stage 1 — profile is display-only with a social link (Behance, LinkedIn URL stored as `portfolioUrl` on the User model). Stage 2 — add a rate-limited contact form backed by a transactional email service (Resend or Postmark) in a later iteration. Do not block profile launch on contact infrastructure.

**Warning signs:**
- `contactEmail` exposed directly in page HTML (scrapers will harvest it)
- No rate limiting on any contact/message submission endpoint
- Designer profile design mocking a full inbox UI that is not planned in scope

**Phase to address:** Designer Profiles phase

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `getDashboardData()` mega-include | Single action, simple code | Full table load on every dashboard hit; slow as org grows | Never — split before launch |
| Ghost accounts via `user.upsert` on invite | No invitation model needed | Signup collisions, orphaned accounts, confused users | Never |
| Skipping `onboardingCompletedAt` flag | Simpler schema | Users bypass onboarding, empty-state dashboard, confused first-run | Never |
| Hardcoding `POPULAR_TAGS` in marketplace | No tag management needed | Tags become stale, cannot reflect actual published content | Acceptable for MVP; replace with dynamic tag aggregation later |
| No `TeamMember.role` column | Simpler schema | Cannot implement team-level permission delegation without org-level escalation | Acceptable only if shipping team invite is not in scope |
| `try/catch` silent R2 copy failure in clone | Clone always "succeeds" | Users get empty project clones with no feedback | Never |
| No Invitation model, direct upsert | Faster invite feature | Ghost accounts, signup collisions | Never |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Google OAuth + NextAuth v4 | Adding `GoogleProvider` without Prisma adapter | Configure `@auth/prisma-adapter` first; add `Account`, `Session`, `VerificationToken` models to schema before adding any OAuth provider |
| NextAuth v4 Prisma adapter | Using the adapter with `strategy: "jwt"` | JWT strategy bypasses the adapter's session table; use `strategy: "database"` when using the adapter, or keep JWT and manage account linking manually |
| Cloudflare R2 clone | Using public URL string-parsing to derive the S3 key (`stateUrl.replace(...)`) | Store the raw R2 key on the Project record (`stateKey String?`) separately from the public URL; URL parsing is fragile if CDN domain changes |
| NextAuth session in Server Actions | `getServerSession(authOptions)` called once per action | Safe, but adds a DB/JWT round-trip per action; use `auth()` from a shared cached helper with Next.js `cache()` to deduplicate within a request |
| Prisma in Next.js dev mode | New PrismaClient instantiated on every hot reload | Use the global singleton pattern: `global.__prisma ?? new PrismaClient()`; already done in this codebase — verify it stays in place |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded nested `include` in dashboard | Dashboard latency grows with org size | Targeted queries with `_count` aggregations and explicit `take` limits | ~20 teams with ~30 projects each (~600 rows) |
| Marketplace page `take: 60` with no cursor | First page load fast; no way to paginate; growing query cost | Implement cursor-based pagination from day one | ~500 published assets |
| `cloneCount: { increment: 1 }` without atomicity guard | Correct for PostgreSQL (atomic increment) | Already correct — no change needed | N/A |
| `unique()` slug check in a loop (`uniqueSlug` function) | Race condition: two simultaneous signups with same org name both pass the loop check | Replace loop with `INSERT ... ON CONFLICT` or add a DB-level unique constraint and catch the conflict error | Two simultaneous signups |
| Marketplace page fetches all 60 assets including author+project on every page hit with no caching | Cold page load latency | Add `export const revalidate = 60` to marketplace page or wrap query in `unstable_cache` | Any sustained traffic |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `inviteMember` does not verify caller is OWNER/ADMIN of `organizationId` | Any authenticated user can add arbitrary users to any org | Add `assertOrgRole(userId, organizationId, ['OWNER', 'ADMIN'])` check before upsert |
| Signup route has no email verification | Fake email registrations; downstream invite collision with unverified addresses | Add email verification step before account activation, or at minimum before RBAC-sensitive actions |
| Marketplace asset publish has no review gate | Low-quality, duplicate, or inappropriate 3D scenes pollute the public marketplace | Add a `status: 'PENDING' | 'PUBLISHED' | 'REJECTED'` field; require admin approval before `isPublished: true` for early stage |
| Public profile page directly renders `bio` from database | XSS if bio is ever rendered as `dangerouslySetInnerHTML` (currently it is not, but a future rich-text bio field could be) | Sanitize user-supplied rich text through DOMPurify or a server-side sanitizer before storing/rendering |
| No rate limit on clone endpoint | Abuse: a bot clones an asset thousands of times inflating `cloneCount` | Add Upstash `@upstash/ratelimit` per userId on the clone endpoint: max 10 clones per minute |
| `TeamMember` and `ProjectMember` records are never deleted when a user leaves an org | Former members retain team/project membership grants after org removal | Add cascading delete: when an `OrganizationMember` is removed, delete all `TeamMember` and `ProjectMember` records for that user within that org |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Dashboard shows "No organization found" for new users without routing them to onboarding | User is stuck with a dead end screen and no CTA | Middleware check: authenticated + no org = redirect to `/onboarding` |
| Multi-step onboarding state in React `useState` only | Back button clears progress; refresh loses step | URL-based step (`?step=N`) + server-side progress flag |
| Empty marketplace with no sample content at launch | First visitors see "No assets found. Be the first to publish!" — feels abandoned | Seed 5-10 first-party showcase assets before making marketplace public |
| Clone redirects to project but editor requires separate navigation | User clones an asset and lands at dashboard projects list, then has to find and click into the new project | After successful clone, redirect to `/editor/[newProjectId]` directly |
| Onboarding creates "General" team invisibly without showing the user | Users don't know a team was created; discover it later and it feels like a system artifact | Show the created team in the final onboarding success screen with an option to rename it immediately |
| Invite by email adds user to org but not to any team or project | Invited member arrives at the dashboard with org access but no projects visible | Invite flow should optionally select which team(s) to add the new member to |

---

## "Looks Done But Isn't" Checklist

- [ ] **RBAC enforcement:** Server Actions check session but NOT org/team/project membership — verify every mutating action has an authorization check, not just an authentication check
- [ ] **Onboarding completion gate:** Middleware redirects unauthenticated users to login, but does NOT redirect authenticated users with no org to `/onboarding` — verify this redirect exists before dashboard ships
- [ ] **Invite flow:** Invite adds user to org but the invited user has no password and cannot log in — verify an Invitation model (with token + expiry) replaces the direct-upsert pattern
- [ ] **Google OAuth:** GoogleProvider config present in `authOptions` but Prisma Adapter not configured — verify `@auth/prisma-adapter` and required schema models (`Account`, `Session`) are added first
- [ ] **Marketplace clone atomicity:** Clone succeeds even if R2 state copy fails — verify the entire clone operation rolls back on storage failure
- [ ] **TeamMember role:** Schema has `TeamMember` with no `role` column — verify team-level delegation is possible before team management UI ships
- [ ] **Designer profile contact:** Contact button exposes raw email or has no rate limiting — verify contact flow is rate-limited before profiles are public

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Server Action IDOR discovered post-launch | HIGH | Audit all actions, add authorization checks, rotate any exposed data, notify affected users |
| Ghost accounts accumulate and block signups | MEDIUM | Identify ghost users (password null, no OAuth account, never logged in), send activation emails or delete after 30-day notice |
| Onboarding skippable and many users have no org | MEDIUM | Run a migration script to detect users with no org, re-route them to onboarding on next login via middleware check |
| Marketplace polluted with low-quality assets | MEDIUM | Add moderation status retroactively, audit existing assets, add admin review queue |
| Clone created orphaned project with no state | LOW | Query `projects WHERE stateUrl IS NULL AND description LIKE '% (Clone)'`, delete orphans or present recovery UI |
| Google OAuth breaks existing credentials users | HIGH | Implement account linking screen immediately; cannot auto-merge without password re-verification |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Server Actions missing authorization checks | RBAC / Dashboard (Phase 1 of new milestone) | Code review checklist: every Server Action has both `getServerSession` AND a membership assertion |
| Google OAuth account collision | Authentication phase (before Google OAuth ships) | Test: register with email, sign in with Google same email — should prompt link flow, not error |
| Missing tenant scope on Prisma queries | RBAC / Dashboard (Phase 1) | Integration test: user A attempts to create a project in user B's org using a known teamId |
| Onboarding state not persisted | Onboarding phase | Test: partially complete onboarding, close tab, reopen — should resume at last step |
| Ghost accounts from invite upsert | Team RBAC / Invite phase | Schema review: no `user.upsert` in invite path; `Invitation` model exists with token + expiry |
| Commenter/Editor role capability matrix | RBAC phase | Unit tests on `hasProjectPermission()` covering all role/capability combinations |
| Marketplace clone non-atomic | Marketplace phase | Test: simulate R2 copy failure — project record must not be created |
| Dashboard N+1 mega-include | Dashboard phase | Query count assertion: dashboard load must not exceed 5 DB queries |
| TeamMember has no role | Schema / RBAC phase | Schema review before team management UI ships |
| Public profiles without rate-limited contact | Designer Profiles phase | Load test the contact endpoint before going live |

---

## Sources

- Live codebase analysis: `apps/editor/app/dashboard/actions.ts`, `apps/editor/app/onboarding/actions.ts`, `apps/editor/app/api/marketplace/clone/route.ts`, `apps/editor/prisma/schema.prisma` — HIGH confidence (direct code review)
- `SYSTEM_AUDIT.md` in project root — security and architecture issues documented by prior audit — HIGH confidence
- Next.js official docs on Server Actions security: https://nextjs.org/docs/app/guides/data-security — HIGH confidence
- NextAuth v4 `OAuthAccountNotLinked` issue: https://github.com/nextauthjs/next-auth/issues/10062 — HIGH confidence (official GitHub, multiple confirmations)
- Figma permission model: https://help.figma.com/hc/en-us/articles/1500007609322-Guide-to-sharing-and-permissions — HIGH confidence (official docs)
- Multi-tenant Prisma data isolation: https://dev.to/whoffagents/multi-tenant-saas-data-isolation-row-level-security-tenant-scoping-and-plan-enforcement-with-1gd4 — MEDIUM confidence (community, multiple sources agree)
- RBAC frontend-only check danger (CVE-2025-29927): https://www.averagedevs.com/blog/rbac-zero-trust-architecture-nextjs — MEDIUM confidence (multiple sources agree on pattern)
- Onboarding state persistence: https://medium.com/@rtsekov/designing-a-secure-multi-step-sign-up-flow-in-next-js-9475a0567b7e — MEDIUM confidence

---
*Pitfalls research for: Figma-like SaaS platform layer (PascalEditor / Archly.Cloud)*
*Researched: 2026-04-28*
