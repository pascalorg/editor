# Architecture Research

**Domain:** Figma-style SaaS platform layer — dashboard, teamspaces, marketplace, designer profiles
**Researched:** 2026-04-28
**Confidence:** HIGH (based on direct codebase inspection + verified Next.js App Router patterns)

---

## Standard Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     Next.js App Router                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  (public)   │  │ (auth-wall)  │  │      (editor)          │ │
│  │  /          │  │  /dashboard  │  │  /editor/[id]          │ │
│  │  /marketplace│  │  /onboarding│  │                        │ │
│  │  /profile/  │  │  /apply     │  │                        │ │
│  │  [userId]   │  │             │  │                        │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬─────────────┘ │
│         │               │                     │               │
├─────────┴───────────────┴─────────────────────┴───────────────┤
│                    Server Actions + Route Handlers              │
│  dashboard/actions.ts   api/marketplace/clone   api/projects   │
├────────────────────────────────────────────────────────────────┤
│                         Data Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │   Prisma +   │  │  Cloudflare  │  │  Redis (Socket.IO  │   │
│  │  PostgreSQL  │  │      R2      │  │   pub/sub, cache)  │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
└────────────────────────────────────────────────────────────────┘

Monorepo Packages consumed by apps/editor:
  @pascal-app/viewer   — read-only 3D canvas, no editor controls
  @pascal-app/editor   — full editor UI (R3F + Yjs + Zustand)
  @pascal-app/core     — shared 3D primitives and data types
  @pascal-app/ui       — shared Tailwind/Radix UI design system
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `/dashboard` layout | Auth gate, sidebar, org context injection | NextAuth session, Prisma (org memberships) |
| `/dashboard/page.tsx` | Overview: stats + recent projects | `getDashboardData()` Server Action |
| `/dashboard/teams` | Team CRUD within org scope | Server Actions → Prisma |
| `/dashboard/members` | Org member invite, role display | `inviteMember()` Server Action → Prisma upsert |
| `/dashboard/projects` | Project creation, list | Server Action → Prisma, revalidatePath |
| `/dashboard/settings` | Org profile, user profile, invite tokens | Prisma, R2 (avatar upload) |
| `/marketplace` | Public asset grid, tag/search filter | Prisma `findMany` (no auth required) |
| `/marketplace/[assetId]` | Asset detail, clone CTA, author card | Prisma, `@pascal-app/viewer` embed |
| `/api/marketplace/clone` | Deep-copy Yjs binary from R2, create Project+Clone records | R2, Prisma, NextAuth session |
| `/profile/[userId]` | Public designer profile page | Prisma `findUnique` (published assets) |
| `/onboarding` | Post-signup flow for workspace setup | Server Action → org + team creation |
| `/editor/[id]` | Full 3D editor, real-time collab | `@pascal-app/editor`, Socket.IO, Yjs, R2 |
| `DashboardSidebar` | Org switcher, nav, user widget | Client component — receives orgs from layout |
| `WorkspaceSetupModal` | First-run setup modal shown when no org | Server Action creates org + default team |
| `@pascal-app/viewer` | Read-only 3D scene renderer | `@pascal-app/core`, R3F, three.js, Zustand store |
| `@pascal-app/editor` | Full editor panel + 3D canvas | `@pascal-app/viewer`, Yjs, `@pascal-app/core` |
| `lib/rbac.ts` | Role capability helpers (`canEdit`, `toAccessLevel`) | Imported in editor page, invite UI |
| `lib/auth.ts` | NextAuth config, JWT/session callbacks | Next-auth, Prisma, bcrypt |

---

## Recommended Project Structure

The current structure is already well-shaped. The additions needed for the platform layer fit cleanly inside the existing convention:

```
apps/editor/app/
├── (public)/                   # Route group — no auth middleware, fully SSR-cacheable
│   ├── marketplace/            # Already exists — move here or keep as-is
│   └── profile/
│       └── [userId]/
│           └── page.tsx        # Public designer profile (Server Component, no session needed)
│
├── dashboard/                  # Auth-gated route group (layout.tsx already guards)
│   ├── layout.tsx              # Auth guard + sidebar injection (already exists)
│   ├── page.tsx                # Overview stats (already exists)
│   ├── teams/                  # Team management (already exists, needs CRUD modals)
│   ├── members/                # Org member list + invite (already exists, needs email tokens)
│   ├── projects/               # Project list + creation (already exists)
│   └── settings/               # NEW: org settings, user profile, danger zone
│       ├── page.tsx
│       └── _components/
│
├── onboarding/                 # Redirects to dashboard now — needs real multi-step flow
│   ├── page.tsx
│   └── _components/            # StepIndicator, OrgSetupStep, TeamSetupStep
│
├── invite/
│   └── [token]/
│       └── page.tsx            # Accept-invite page — validates token, creates membership
│
└── api/
    ├── marketplace/clone/      # Already exists — deep-copy Yjs + Prisma records
    ├── invites/                # NEW: POST /api/invites (create token, send email)
    │   └── route.ts
    └── upload/                 # Presigned URL generation for R2 (already exists)

apps/editor/lib/
├── auth.ts                     # Already exists — credentials provider
├── rbac.ts                     # Already exists — extend with OrgRole helpers
├── prisma.ts                   # Already exists
├── invites.ts                  # NEW: token generation, email dispatch (Resend/nodemailer)
└── permissions.ts              # NEW: composable permission check (org + team + project)
```

### Structure Rationale

- **`(public)/profile/[userId]`:** Route group ensures no session fetch overhead on public pages. Server Component fetches user + published assets; fully indexable by search engines.
- **`invite/[token]`:** Separate from `/dashboard` because unauthenticated users land here to accept an invite before they have a session. The page checks token validity then redirects to signup or immediately activates membership.
- **`dashboard/settings`:** Keeps all destructive/privileged operations (org rename, member removal, personal profile) in one guarded subtree.
- **`lib/permissions.ts`:** The existing `lib/rbac.ts` only handles project-level roles. A new permissions utility needs to compose org-level + team-level + project-level roles so a single `checkPermission(userId, resource, action)` call works everywhere.

---

## Architectural Patterns

### Pattern 1: Layout-Level Auth Gate (already in use, extend this)

**What:** `dashboard/layout.tsx` is an async Server Component. It calls `getServerSession()`, redirects unauthenticated users, and passes org context down as props to the sidebar. Child pages get session implicitly via Server Actions.

**When to use:** All `/dashboard/*` routes. The layout fetch also pre-loads the user's org memberships, so child pages do not need to re-fetch this.

**Trade-offs:** One extra Prisma query per dashboard navigation. Acceptable at this scale. At 10K+ users, cache the org memberships in Redis with a short TTL.

**Example (already implemented):**
```typescript
// apps/editor/app/dashboard/layout.tsx
export default async function DashboardLayout({ children }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: (session.user as any).id },
    include: { organization: { select: { id, name, slug, logoUrl } } },
  })

  // Pass orgs to sidebar; children fetch their own data via Server Actions
  return <DashboardSidebar orgs={...} />
}
```

### Pattern 2: Server Actions as the Mutation Layer

**What:** All mutations (create team, invite member, clone asset, create project) use `"use server"` functions defined in co-located `actions.ts` files. No REST endpoint is needed for these — the Next.js Server Action transport handles it.

**When to use:** Any form submission or button action that writes to the database from the dashboard.

**Trade-offs:** Server Actions run on the server, are strongly typed end-to-end, and co-locate with the pages that use them. The downside is that they cannot be called from external clients (use Route Handlers for that). The marketplace clone endpoint correctly uses a Route Handler (`/api/marketplace/clone/route.ts`) because it may be called programmatically.

**Example (invite — currently direct upsert, should be token-gated):**
```typescript
// apps/editor/app/dashboard/actions.ts
"use server"
export async function inviteMember(orgId: string, email: string) {
  const session = await getServerSession(authOptions)
  // 1. Generate token, store in InviteToken table with expiry
  // 2. Send email via Resend: `Accept invite → /invite/${token}`
  // 3. Do NOT create OrganizationMember yet — create on accept
  revalidatePath('/dashboard/members')
}
```

### Pattern 3: Two-Phase Invite Flow (pending → accepted)

**What:** Current implementation directly upserts the invited user into `OrganizationMember`. This creates ghost accounts for emails that have never signed up. The correct pattern:

1. POST to `/api/invites` or Server Action → create `InviteToken` record (email, orgId, role, token, expiresAt, status: PENDING)
2. Send email with link to `/invite/[token]`
3. User lands on `/invite/[token]` — page validates token, shows org name + inviter
4. If user has no account: redirect to `/signup?invite=[token]` which pre-fills email
5. After auth: re-check token and create `OrganizationMember`, mark token USED

**Schema addition needed:**
```prisma
model InviteToken {
  id        String   @id @default(cuid())
  email     String
  orgId     String
  role      OrgRole  @default(MEMBER)
  token     String   @unique
  status    InviteStatus @default(PENDING)
  expiresAt DateTime
  createdAt DateTime @default(now())

  organization Organization @relation(...)
  @@index([email])
  @@index([token])
}

enum InviteStatus { PENDING ACCEPTED EXPIRED }
```

### Pattern 4: Viewer Package Embed in Marketplace (no editor controls)

**What:** The marketplace detail page (`/marketplace/[assetId]`) needs a live 3D preview without the full editor toolbar. `@pascal-app/viewer` exports a `<Viewer />` component that is the read-only R3F canvas, entirely separate from `@pascal-app/editor`.

**When to use:** Marketplace asset cards (thumbnail still from R2 image), asset detail page (live interactive viewer), designer profile cards.

**How to embed:**
```tsx
// apps/editor/app/marketplace/[assetId]/_components/ScenePreview.tsx
"use client"
import { Viewer } from "@pascal-app/viewer"

export function ScenePreview({ stateUrl }: { stateUrl: string }) {
  // Viewer accepts a stateUrl pointing to the Yjs binary in R2
  // It renders the scene read-only — no toolbar, no mutation
  return (
    <div className="aspect-[16/10] rounded-2xl overflow-hidden">
      <Viewer stateUrl={stateUrl} interactive={false} />
    </div>
  )
}
```

**Trade-offs:** The `@pascal-app/viewer` package is an ESM module with R3F peer deps. It must be rendered client-side (Canvas cannot run in SSR). Wrap with `dynamic(() => import(...), { ssr: false })` at the page level. The thumbnail image (from R2) is the SSR fallback for Suspense.

**Important boundary:** `@pascal-app/viewer` has NO dependency on `@pascal-app/editor`. The marketplace page imports only `@pascal-app/viewer`. This boundary must be preserved — importing `@pascal-app/editor` on the marketplace page would bundle the entire editor (multi-MB) unnecessarily.

### Pattern 5: Public Profile Page (Server Component, no auth)

**What:** `/profile/[userId]` fetches user name, bio, avatar, and published assets via Prisma server-side. No `getServerSession()` call — this page is intentionally public and SSR-cached.

**When to use:** Designer profile linked from marketplace asset cards, shareable URLs.

```typescript
// apps/editor/app/profile/[userId]/page.tsx
export default async function ProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true, bio: true, image: true,
      publishedAssets: {
        where: { isPublished: true },
        orderBy: { cloneCount: 'desc' },
        take: 24,
      },
    },
  })
  if (!user) notFound()
  // Render without any session check
}
```

**SEO:** Generate `metadata` export with `{ title: user.name, description: user.bio }`. Pages are statically cacheable via `generateStaticParams` for known users, or dynamically rendered for new users.

### Pattern 6: Marketplace Clone — Deep-Copy Flow

**What:** The existing `/api/marketplace/clone/route.ts` already implements the correct deep-copy pattern. It must not use references — each clone gets its own Yjs binary in R2.

**Current flow (already correct — verify this is complete):**
```
POST /api/marketplace/clone { assetId }
  ↓ auth check (session required)
  ↓ validate asset isPublished
  ↓ find cloner's first team (from OWNER/ADMIN org membership)
  ↓ prisma.project.create (new record)
  ↓ R2 GetObject(sourceKey) → R2 PutObject(destKey = projects/{newProjectId}/state.bin)
  ↓ prisma.project.update { stateUrl: destKey }
  ↓ prisma.projectMember.create { role: OWNER }
  ↓ prisma.projectClone.create { sourceAssetId, clonedProjectId }
  ↓ prisma.marketplaceAsset.update { cloneCount: increment(1) }
  ↓ return { projectId }
```

**Gap to address:** If the cloner has no OWNER/ADMIN org membership (pure MEMBER role), the clone endpoint returns 422. The onboarding flow must ensure every new user is set up as OWNER of their personal workspace team before they can clone. Add a check: if no OWNER org found, create a personal workspace inline and retry.

---

## Data Flow

### Dashboard Data Flow

```
Browser Request → /dashboard
    ↓
DashboardLayout (Server Component)
    ↓ getServerSession() → JWT decode (no DB hit)
    ↓ prisma.organizationMember.findMany → orgs list
    ↓ render DashboardSidebar (Client Component, receives orgs as props)
    ↓ render <main>{children}</main>

DashboardPage (child Server Component)
    ↓ getDashboardData() Server Action
    ↓ prisma.user.findUnique { include: organizations → teams → projects }
    ↓ return data → render stats + recent project cards
```

### Invite Flow Data Flow

```
ADMIN clicks "Invite" → inviteMember('email@x.com', 'EDITOR')
    ↓ Server Action validates ADMIN/OWNER role
    ↓ prisma.inviteToken.create { email, orgId, token: nanoid(), expiresAt: +7d }
    ↓ Resend/nodemailer.send({ to: email, link: /invite/${token} })
    ↓ revalidatePath('/dashboard/members')

Invited user clicks email link → /invite/[token]
    ↓ Server Component: prisma.inviteToken.findUnique { where: { token } }
    ↓ validate: not expired, status=PENDING
    ↓ if (no session) → redirect to /login?callbackUrl=/invite/${token}
    ↓ if (session exists) → Server Action: acceptInvite(token)
        ↓ prisma.organizationMember.create { userId, orgId, role }
        ↓ prisma.inviteToken.update { status: ACCEPTED }
        ↓ redirect('/dashboard')
```

### Marketplace Clone Data Flow

```
User clicks "Clone" → CloneButton (Client Component)
    ↓ fetch('POST /api/marketplace/clone', { assetId })

/api/marketplace/clone (Route Handler)
    ↓ getServerSession() → userId
    ↓ prisma.marketplaceAsset.findUnique (verify isPublished)
    ↓ prisma.organizationMember.findFirst { role: OWNER|ADMIN } → teamId
    ↓ prisma.project.create → newProjectId
    ↓ s3.GetObject(source stateUrl key)
    ↓ s3.PutObject(projects/${newProjectId}/state.bin)
    ↓ Promise.all([
        project.update { stateUrl },
        projectMember.create { OWNER },
        projectClone.create,
        marketplaceAsset.update { cloneCount++ }
      ])
    ↓ return { projectId } → CloneButton redirects to /editor/${projectId}
```

### Viewer Embed Data Flow (marketplace detail)

```
/marketplace/[assetId] (Server Component)
    ↓ prisma.marketplaceAsset.findUnique { include: project, author }
    ↓ render page HTML (thumbnail img, metadata — all SSR)
    ↓ dynamic(() => import('./ScenePreview'), { ssr: false })
        ↓ <Viewer stateUrl={asset.project.stateUrl} />
            ↓ fetch(stateUrl) → Yjs binary from R2
            ↓ deserialize scene state
            ↓ R3F Canvas renders read-only scene
```

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–1K users | Current monolith is fine. SQLite → Postgres already done. No changes needed. |
| 1K–20K users | Add Redis caching for `getDashboardData` (5s TTL per userId). Move email sending to a background queue (use BullMQ + Redis, already have Redis via socket.io). R2 clone operation can be async — return projectId immediately, populate stateUrl via webhook/callback. |
| 20K–100K users | PostgreSQL read replica for marketplace queries (no auth needed). CDN-cache the public marketplace and profile pages at edge. Separate the socket.io collaboration server from the Next.js app (already partially done via `server.ts`). |
| 100K+ users | Evaluate splitting marketplace into its own Next.js app in the monorepo. The `@pascal-app/viewer` package makes this clean — marketplace app only imports viewer, not editor. |

### Scaling Priorities

1. **First bottleneck:** `getDashboardData()` fetches deeply nested org → teams → projects on every dashboard load. Add Redis TTL cache keyed by `userId`. Invalidate on `revalidatePath` calls.
2. **Second bottleneck:** R2 clone operation is synchronous and blocks the API response. At high clone volume, move to: create project record immediately, return projectId, clone R2 binary in a background job, update `stateUrl` when done. Show "Processing..." state in the editor until stateUrl is set.

---

## Anti-Patterns

### Anti-Pattern 1: Import `@pascal-app/editor` on marketplace pages

**What people do:** Reuse the editor's `<EditorCanvas />` component on the marketplace detail page for the 3D preview.

**Why it's wrong:** `@pascal-app/editor` bundles the full editor UI (Radix dialogs, command palette, Yjs provider, socket.io client, heavy Zustand stores). This adds ~800KB+ to the marketplace bundle unnecessarily.

**Do this instead:** Use `@pascal-app/viewer` exclusively on marketplace and profile pages. The viewer is the correct read-only primitive — it has no editor UI in its dep tree.

### Anti-Pattern 2: Direct upsert invite (current implementation)

**What people do:** `prisma.user.upsert` + `prisma.organizationMember.create` immediately on invite submission (current `inviteMember` in `dashboard/actions.ts`).

**Why it's wrong:** Creates ghost user records for emails that never sign up. If the email changes provider, the ghost account is orphaned. No expiry, no acceptance step, no way to revoke before accept.

**Do this instead:** Implement the two-phase InviteToken flow (Pattern 3 above). The current `inviteMember` function must be refactored before the members UI goes to production.

### Anti-Pattern 3: Checking org membership inside every server action individually

**What people do:** Each Server Action does its own `prisma.organizationMember.findFirst` to confirm the caller is an ADMIN/OWNER before proceeding.

**Why it's wrong:** Permission logic scattered across dozens of files. One missing check = privilege escalation vulnerability.

**Do this instead:** Build `lib/permissions.ts` with composable guards:
```typescript
export async function requireOrgRole(userId: string, orgId: string, minRole: OrgRole) {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  })
  if (!membership || roleRank(membership.role) < roleRank(minRole)) {
    throw new Error('Forbidden')
  }
  return membership
}
```
Every Server Action and Route Handler calls this at the top.

### Anti-Pattern 4: Using the dashboard layout's org list for permission checks

**What people do:** Pass the org list from `DashboardLayout` to child Server Actions as a parameter and trust it as the authoritative roles list.

**Why it's wrong:** Client-passed data can be forged. The org list in the layout is for UI rendering only — never for security decisions.

**Do this instead:** Always re-fetch from DB inside the Server Action using the session `userId`. The layout's org list is display-only.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Cloudflare R2 | `@aws-sdk/client-s3` with R2 endpoint in `lib/s3.ts` | Already implemented. Clone route uses GetObject + PutObject directly. Add presigned URL generation for avatar uploads via `/api/upload`. |
| NextAuth v4 | JWT strategy, credentials provider in `lib/auth.ts` | JWT carries only `userId`. Org roles always fetched from DB — never stored in JWT. |
| Socket.IO + Redis | `server.ts` custom HTTP server, `@socket.io/redis-adapter` for horizontal scaling | Editor collaboration only. Dashboard and marketplace have no real-time needs — use `revalidatePath` + SWR polling if needed. |
| Email provider (Resend recommended) | Call from Server Action or `/api/invites` Route Handler | Resend has a Node.js SDK that works in Next.js Server Actions without extra config. Use BullMQ at scale to queue sends. |
| PostHog | Already integrated via `lib/posthog-server.ts` and `lib/posthog.tsx` | Track: clone events, publish events, invite sent/accepted. Use server-side capture for accurate funnel data. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `apps/editor` ↔ `@pascal-app/viewer` | Direct import (ESM package, peer deps on R3F + three) | Viewer renders read-only scenes. Must be wrapped in `dynamic(..., { ssr: false })` in Next.js pages. |
| `apps/editor` ↔ `@pascal-app/editor` | Direct import — editor pages only | Editor package carries Yjs, socket.io-client, full Radix UI. Never import on marketplace or profile routes. |
| `apps/editor` ↔ `@pascal-app/core` | Direct import — shared 3D primitives | Core has no React dependency. Safe to import in Server Components if needed for type-checking scene data. |
| `apps/editor` ↔ `@pascal-app/ui` | Direct import — shared Tailwind + Radix components | Use for buttons, modals, form fields across dashboard. Prevents style drift between dashboard and editor UI. |
| `dashboard/` → `Server Actions` | "use server" functions, called from Client Components | Type-safe, no fetch boilerplate. Never call Server Actions from API routes or external services. |
| `marketplace/clone` → `api/marketplace/clone` | Route Handler (POST) | Route Handler used here (not Server Action) because it needs explicit request validation (zod) and may be called from the editor or mobile in future. |

---

## Build Order Implications

The component graph has clear dependencies that dictate the suggested phase order:

```
[Auth + Session] → already complete
       ↓
[Org/Team/Project CRUD] → already complete (basic version)
       ↓
[InviteToken schema + accept flow] ─────────────────────────────┐
       ↓                                                         │
[Dashboard settings + user profile] ◄───────────────────────────┘
       ↓
[Onboarding multi-step] (depends on: org creation, team creation, first-run detection)
       ↓
[Marketplace viewer embed] (depends on: @pascal-app/viewer boundary verified)
       ↓
[Designer profile page] (depends on: marketplace published assets, user bio field)
       ↓
[Publish flow] (depends on: marketplace exists, project thumbnails working)
```

**Rationale:** Invite tokens must ship before any team invitation UI goes to production (current direct-upsert approach creates ghost accounts). Onboarding depends on org+team creation being robust. Profile pages depend on users actually having published assets. The viewer embed is self-contained and can be built in parallel with invite flow once the boundary decision is validated.

---

## Sources

- Next.js App Router route groups: https://nextjs.org/docs/app/api-reference/file-conventions/route-groups (official docs — HIGH confidence)
- Next.js App Router RBAC patterns 2026: https://www.averagedevs.com/blog/rbac-zero-trust-architecture-nextjs (MEDIUM confidence — multi-source verified)
- Middleware RBAC in Next.js 15: https://www.jigz.dev/blogs/how-to-use-middleware-for-role-based-access-control-in-next-js-15-app-router (MEDIUM confidence)
- Multi-tenant SaaS architecture Next.js: https://dev.to/whoffagents/multi-tenant-saas-architecture-in-nextjs-organizations-roles-and-resource-isolation-1n91 (MEDIUM confidence)
- Invite token pattern: https://github.com/nextauthjs/next-auth/discussions/4106 (MEDIUM confidence — community-verified pattern)
- Architecture patterns for SaaS (Billing, RBAC, Onboarding): https://medium.com/appfoster/architecture-patterns-for-saas-platforms-billing-rbac-and-onboarding-964ea071f571 (MEDIUM confidence)
- Codebase direct inspection: `apps/editor/` — prisma schema, actions, route handlers, lib/ (HIGH confidence — ground truth)

---
*Architecture research for: PascalEditor platform layer (dashboard, teamspaces, marketplace, profiles)*
*Researched: 2026-04-28*
