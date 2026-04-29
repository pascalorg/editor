# Phase 3: Onboarding - Research

**Researched:** 2026-04-29
**Domain:** Next.js App Router multi-step onboarding flow with DB-persisted progress, JWT sessions, Prisma
**Confidence:** HIGH

---

## Summary

The codebase already has a stub `/onboarding` route that immediately redirects to `/dashboard`. A partial onboarding UX exists as `WorkspaceSetupModal` — a 2-step client component rendered inside the dashboard layout when the user has no org. This modal must be replaced by a proper multi-step `/onboarding` flow at a dedicated route with step persistence, back-navigation, and first-time user gating.

The key architectural decision is **where onboarding state lives**. Given the requirement to survive page refreshes (ONBD-07), state must be persisted to the database. A new `OnboardingProgress` Prisma model (storing `currentStep` + `selections` as JSON) is the right approach. The middleware intercept pattern (checking `onboardingComplete` on the User model) is the standard way to gate first-time users in Next.js App Router — it runs before any page renders.

The existing codebase has no `onboardingComplete` flag on the `User` model and no `OnboardingProgress` model. Both must be added via a Prisma migration. The existing `createWorkspace` server action in `onboarding/actions.ts` can be reused for Step 3 (team creation). The existing `createProject` server action in `dashboard/actions.ts` can be reused for Step 4 (first project).

**Primary recommendation:** Add `onboardingComplete Boolean @default(false)` to the User model and a new `OnboardingProgress` model. Implement middleware-based redirect for new users. Build the `/onboarding` page as a single client component with step state driven by DB-persisted progress loaded via a server action.

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.2.1 | App Router, server actions, middleware | Already in use |
| next-auth | ^4.24.14 | JWT session, `getServerSession` | Already in use |
| Prisma | 5.10.0 | ORM for OnboardingProgress model | Already in use |
| Framer Motion | 11 | Step transition animations | Already in use — WorkspaceSetupModal uses it |
| React | ^19.2.4 | `useTransition` for server action calls | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | ^4.3.6 | Validate selections shape stored as JSON | Already in use |
| lucide-react | ^1.8.0 | Icons for role/use-case cards | Already in use |

### Not Needed
- Radix UI is listed in the phase context but is **not installed** in `package.json`. Do not use Radix components — the existing UI is custom with Tailwind classes.
- No email library (Resend not configured) — confirmed, team invites use URL tokens only.

---

## Architecture Patterns

### Recommended Project Structure

```
apps/editor/app/onboarding/
├── page.tsx               # server component: loads progress, renders <OnboardingFlow />
├── actions.ts             # server actions: saveProgress, completeOnboarding, createWorkspace (existing)
└── _components/
    ├── OnboardingFlow.tsx  # client component: step machine, navigation
    ├── StepRole.tsx        # ONBD-02: role selection cards
    ├── StepUseCase.tsx     # ONBD-03: use case selection cards
    ├── StepTeam.tsx        # ONBD-04: create team / join via invite / skip
    └── StepProject.tsx     # ONBD-05: start project or skip

apps/editor/app/api/auth/invite/
└── route.ts               # GET: validate invite token → redirect to /onboarding?invite=TOKEN or /dashboard
```

### Pattern 1: DB-Persisted Step State

**What:** `OnboardingProgress` model stores `currentStep` (int) and `selections` (Json). On page load the server component reads this row and passes it as initial props to the client component. Each "Next" click calls a server action that upserts the row before transitioning the local step state.

**When to use:** Required by ONBD-07 — refresh must restore step, not restart.

```typescript
// prisma/schema.prisma addition
model OnboardingProgress {
  userId      String   @id
  currentStep Int      @default(0)
  selections  Json     @default("{}")
  completedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Add to User model:
// onboardingComplete  Boolean            @default(false)
// onboardingProgress  OnboardingProgress?
```

```typescript
// app/onboarding/actions.ts — add:
'use server'
export async function saveProgress(step: number, selections: Record<string, string>) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { success: false }
  const userId = (session.user as { id: string }).id
  await prisma.onboardingProgress.upsert({
    where: { userId },
    update: { currentStep: step, selections },
    create: { userId, currentStep: step, selections },
  })
  return { success: true }
}

export async function completeOnboarding() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { success: false }
  const userId = (session.user as { id: string }).id
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { onboardingComplete: true } }),
    prisma.onboardingProgress.update({ where: { userId }, data: { completedAt: new Date() } }),
  ])
  return { success: true }
}
```

### Pattern 2: Middleware Onboarding Gate

**What:** `middleware.ts` at the app root checks `onboardingComplete` on the session/DB for authenticated users hitting `/dashboard`. Redirects them to `/onboarding` if false.

**Critical constraint:** Next.js middleware cannot use Prisma directly (Edge Runtime). The middleware must work from the JWT token. Solution: encode `onboardingComplete` into the JWT token in `authOptions.callbacks.jwt`.

```typescript
// middleware.ts (place at apps/editor/middleware.ts)
import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const { pathname } = req.nextUrl

  // Not logged in — let auth pages handle it
  if (!token) return NextResponse.next()

  const onboardingComplete = token.onboardingComplete as boolean | undefined

  // Authenticated user hitting dashboard → gate
  if (pathname.startsWith('/dashboard') && !onboardingComplete) {
    return NextResponse.redirect(new URL('/onboarding', req.url))
  }

  // Authenticated user hitting onboarding after completing → send to dashboard
  if (pathname.startsWith('/onboarding') && onboardingComplete) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/onboarding/:path*'],
}
```

```typescript
// lib/auth.ts — extend jwt callback:
async jwt({ token, user, trigger }) {
  if (user) {
    token.id = user.id
    // On first sign-in, fetch onboardingComplete from DB
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id as string },
      select: { onboardingComplete: true },
    })
    token.onboardingComplete = dbUser?.onboardingComplete ?? false
  }
  // Allow forced refresh of token (call update() from client)
  if (trigger === 'update') {
    const dbUser = await prisma.user.findUnique({
      where: { id: token.id as string },
      select: { onboardingComplete: true },
    })
    token.onboardingComplete = dbUser?.onboardingComplete ?? false
  }
  return token
},
```

**Note:** After `completeOnboarding()` server action runs, the client must call `update()` from `useSession()` to refresh the JWT so middleware sees the new flag. Then `router.push('/dashboard')`.

### Pattern 3: Step Navigation with Back-Support (ONBD-06)

**What:** Local React state holds current step index and the selections object. Both are initialized from server-loaded `OnboardingProgress`. Navigating "Next" calls `saveProgress()` then increments local step. Navigating "Back" only changes local step (no DB write needed — progress row already has the advanced step, and selections are already saved).

```typescript
// _components/OnboardingFlow.tsx
'use client'
import { useState, useTransition } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { saveProgress, completeOnboarding } from '../actions'

type Selections = {
  role?: string
  useCase?: string
  teamAction?: 'create' | 'join' | 'skip'
  teamId?: string
  projectAction?: 'blank' | 'template' | 'skip'
  projectId?: string
}

const STEP_COUNT = 4

export function OnboardingFlow({
  initialStep,
  initialSelections,
}: {
  initialStep: number
  initialSelections: Selections
}) {
  const [step, setStep] = useState(initialStep)
  const [selections, setSelections] = useState<Selections>(initialSelections)
  const [isPending, startTransition] = useTransition()
  const { update } = useSession()
  const router = useRouter()

  const goNext = (newSelections: Selections) => {
    const merged = { ...selections, ...newSelections }
    setSelections(merged)
    startTransition(async () => {
      await saveProgress(step + 1, merged as Record<string, string>)
      if (step + 1 >= STEP_COUNT) {
        await completeOnboarding()
        await update() // refreshes JWT so middleware sees onboardingComplete=true
        router.push(merged.projectId ? `/editor/${merged.projectId}` : '/dashboard')
      } else {
        setStep(step + 1)
      }
    })
  }

  const goBack = () => setStep((s) => Math.max(0, s - 1))

  // Render current step component...
}
```

### Pattern 4: URL-Based Team Invites (ONBD-04)

**What:** Step 3 offers three paths: create a new team/org, paste/enter an invite URL/token, or skip. No email is sent. The invite token must already be generated by an existing member from the dashboard.

**Schema addition needed:**

```prisma
model OrganizationInviteToken {
  id             String    @id @default(cuid())
  organizationId String
  token          String    @unique @default(cuid())
  createdByUserId String
  expiresAt      DateTime
  usedAt         DateTime?
  usedByUserId   String?

  organization   Organization @relation(fields: [organizationId], references: [id])

  createdAt      DateTime  @default(now())

  @@index([token])
}
```

The invite token URL format: `https://archly.cloud/invite/[token]`

An `/invite/[token]` route validates the token, adds the user as an `OrganizationMember`, then redirects to `/onboarding?step=3&joined=true` (or `/dashboard` if onboarding is already complete).

### Pattern 5: Signup → Onboarding Redirect

**What:** After `signIn('credentials')` returns `ok` in the login page, check if it's a new signup (track via a local flag) and redirect to `/onboarding` instead of `/dashboard`. The middleware will also catch `/dashboard` attempts if `onboardingComplete` is false.

The simplest implementation: change the `router.push('/dashboard')` after `signIn()` in `login/page.tsx` to `router.push('/onboarding')` for the signup mode. The middleware will redirect away from `/onboarding` for users who already completed it.

```typescript
// login/page.tsx — in handleSubmit after res?.ok:
} else if (res?.ok) {
  router.push(mode === 'signup' ? '/onboarding' : '/dashboard')
  router.refresh()
}
```

Google OAuth users: change `callbackUrl` to `/onboarding` — same middleware gating applies.

### Anti-Patterns to Avoid

- **Reading Prisma in middleware:** Edge Runtime doesn't support Prisma. Always encode flags into the JWT and read from `getToken()` in middleware.
- **Using URL search params as the sole step tracker:** `?step=2` is bookmarkable but can be manipulated. The DB is truth; URL params are optional UI hints only.
- **Saving progress only on "Complete":** If user closes tab mid-flow, nothing is saved. Save on every "Next" press.
- **Calling `router.refresh()` instead of `update()` to refresh JWT:** `router.refresh()` re-renders the page but doesn't update the JWT token. Use `useSession().update()` to trigger a JWT refresh.
- **Blocking the onboarding page for unauthenticated users via middleware without a login redirect:** Make the `/onboarding` server component also call `getServerSession` and redirect to `/login` if no session exists (defense in depth).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT token refresh after server-side DB change | Custom polling or cookie tricks | `useSession().update()` from next-auth | Official API, triggers token re-fetch |
| Invite token generation | Custom UUID logic | `cuid()` via Prisma `@default(cuid())` | Already pattern used throughout schema |
| Step transition animations | Custom CSS keyframes | Framer Motion `AnimatePresence` + `motion.div` | Already used in WorkspaceSetupModal with same patterns |
| Org/workspace creation | New server action | Reuse existing `createWorkspace` from `app/onboarding/actions.ts` | Already handles slug uniqueness, org + team creation |
| Project creation | New server action | Reuse existing `createProject` from `app/dashboard/actions.ts` | Already handles project + member setup |

**Key insight:** The majority of server-side logic already exists. This phase is primarily UI routing + schema additions.

---

## Common Pitfalls

### Pitfall 1: Middleware reads Prisma — breaks Edge Runtime

**What goes wrong:** `middleware.ts` imports `prisma` and crashes at runtime with "PrismaClient is not supported in the Edge Runtime."
**Why it happens:** Next.js middleware runs in the Edge Runtime by default; Prisma requires Node.js runtime.
**How to avoid:** Only use `getToken()` from `next-auth/jwt` in middleware. Store `onboardingComplete` in the JWT payload via `authOptions.callbacks.jwt`.
**Warning signs:** Build succeeds but middleware throws at request time; error mentions "Dynamic Code Evaluation."

### Pitfall 2: JWT not updated after `completeOnboarding()`

**What goes wrong:** User completes onboarding, server marks `onboardingComplete = true` in DB, but middleware still redirects them back to `/onboarding` because the JWT token still has `false`.
**Why it happens:** JWT is stateless — server DB changes don't automatically propagate to the client token.
**How to avoid:** After `completeOnboarding()` resolves, call `await update()` from `useSession()` before `router.push('/dashboard')`. This triggers a token refresh request to `/api/auth/session`.
**Warning signs:** Infinite redirect loop between `/onboarding` and `/dashboard` after completing the flow.

### Pitfall 3: `getServerSession` called inside a Server Action that runs in middleware-gated route

**What goes wrong:** Server Action returns "Not authenticated" even though user is logged in.
**Why it happens:** `getServerSession(authOptions)` requires the `authOptions` to match the exact configuration used to sign the token. If `authOptions` import path is wrong or has mismatch, session parsing fails.
**How to avoid:** Always import `authOptions` from `@/lib/auth`. Confirm `NEXTAUTH_SECRET` env var is set in all environments. Test with `console.log(await getServerSession(authOptions))` in actions.

### Pitfall 4: Onboarding step state resets on refresh if only stored in React state

**What goes wrong:** User gets to step 3, refreshes, lands back on step 0.
**Why it happens:** `useState` is ephemeral. Without DB persistence, the initial state is always step 0.
**How to avoid:** The `page.tsx` (server component) must fetch `OnboardingProgress` from DB and pass `initialStep` and `initialSelections` as props to `<OnboardingFlow />`. Every "Next" press saves to DB before advancing local state.
**Warning signs:** Refresh always shows step 0 despite DB having `currentStep: 2`.

### Pitfall 5: Creating duplicate organizations for the same user

**What goes wrong:** If a user hits Step 3 "create team" twice (e.g., back-button then resubmit), a second organization is created.
**Why it happens:** The existing `createWorkspace` action does guard against this (`if (existing) return { success: true }`), but only checks by userId. Ensure the guard remains in place.
**How to avoid:** Always check `organizationMember.findFirst({ where: { userId } })` before creating. The existing action already does this — preserve it.

### Pitfall 6: `onboardingComplete` flag missing for existing users

**What goes wrong:** After migration, all existing users have `onboardingComplete = false`, causing them to be redirected to `/onboarding` on next login.
**Why it happens:** New boolean column with `@default(false)` applies `false` to all rows.
**How to avoid:** Write a migration that sets `onboardingComplete = true` for all users who already have an `OrganizationMember` row (i.e., they already completed the old workspace setup modal).

```sql
-- In migration file after ALTER TABLE:
UPDATE "User" u
SET "onboardingComplete" = true
WHERE EXISTS (
  SELECT 1 FROM "OrganizationMember" om WHERE om."userId" = u.id
);
```

---

## Code Examples

### Server component: load progress and render flow

```typescript
// app/onboarding/page.tsx
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { OnboardingFlow } from './_components/OnboardingFlow'

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const userId = (session.user as { id: string }).id

  const progress = await prisma.onboardingProgress.findUnique({
    where: { userId },
  })

  return (
    <OnboardingFlow
      initialStep={progress?.currentStep ?? 0}
      initialSelections={(progress?.selections as Record<string, string>) ?? {}}
    />
  )
}
```

### Prisma migration data backfill

```sql
-- Run as part of the migration that adds onboardingComplete to User
UPDATE "User" u
SET "onboardingComplete" = true
WHERE EXISTS (
  SELECT 1 FROM "OrganizationMember" om WHERE om."userId" = u.id
);
```

### Invite token route

```typescript
// app/invite/[token]/route.ts (or page.tsx)
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

export default async function InvitePage({ params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect(`/login?callbackUrl=/invite/${params.token}`)

  const userId = (session.user as { id: string }).id
  const invite = await prisma.organizationInviteToken.findUnique({
    where: { token: params.token },
  })

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    redirect('/onboarding?invite=invalid')
  }

  await prisma.$transaction([
    prisma.organizationMember.create({
      data: { organizationId: invite.organizationId, userId, role: 'MEMBER' },
    }),
    prisma.organizationInviteToken.update({
      where: { token: params.token },
      data: { usedAt: new Date(), usedByUserId: userId },
    }),
  ])

  redirect('/dashboard')
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| WorkspaceSetupModal inside dashboard layout | Dedicated /onboarding route with middleware gate | Proper separation, survives refresh, supports 4+ steps |
| Onboarding state in React state only | DB-persisted OnboardingProgress model | Satisfies ONBD-07 |
| Redirect to /dashboard after signup | Redirect to /onboarding after signup | Satisfies ONBD-01 |
| No onboardingComplete flag | onboardingComplete Boolean on User | Enables middleware gate |

**Existing code to DELETE/REPLACE:**
- `app/onboarding/page.tsx`: currently just `redirect('/dashboard')` — replace entirely
- `WorkspaceSetupModal`: the workspace creation modal shown inside the dashboard layout — remove once onboarding flow captures this. The `hasOrg` check in `dashboard/layout.tsx` and the `WorkspaceSetupModal` render can be removed after the middleware gate is in place.

---

## Open Questions

1. **Does Step 4 "first project" need a template picker, or just a name input?**
   - What we know: ONBD-05 says "blank scene or template" — but no marketplace templates are guaranteed to exist at this point.
   - What's unclear: Whether templates refer to marketplace assets or hardcoded starter scenes.
   - Recommendation: Ship "blank scene" (name input only) for v1 with a "skip" option. Template picker can be added later when marketplace has content.

2. **Does the `role` field from ONBD-02 (architect/designer/homeowner/student) need to be stored on the User model, or only in OnboardingProgress.selections?**
   - What we know: The existing `User` model has no `role` field (it was listed in phase context as existing, but the actual schema doesn't have it).
   - What's unclear: Whether role should be a top-level User field for future personalization, or just an onboarding signal.
   - Recommendation: Store role in `OnboardingProgress.selections` for now. If personalization is needed later, add `role` to User. Adding it to User now requires another migration.

3. **Should the invite token route be `/invite/[token]` (a page) or `/api/invite/[token]` (an API route)?**
   - What we know: Both work. Pages allow server component logic; API routes return JSON.
   - Recommendation: Use a server page (`/invite/[token]/page.tsx`) since it needs session + DB + redirect — cleaner in App Router.

---

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection — `apps/editor/app/onboarding/`, `lib/auth.ts`, `prisma/schema.prisma`, `app/dashboard/_components/WorkspaceSetupModal.tsx`, `app/login/page.tsx`, `package.json`
- next-auth v4 official docs on `getToken` in middleware: https://next-auth.js.org/configuration/nextjs#middleware
- next-auth v4 JWT callback `trigger: 'update'` for forced refresh: https://next-auth.js.org/configuration/callbacks#jwt-callback

### Secondary (MEDIUM confidence)
- Next.js App Router middleware docs: https://nextjs.org/docs/app/building-your-application/routing/middleware — Edge Runtime constraint on Prisma confirmed by official Next.js docs
- Prisma `$transaction` for atomic multi-table updates — standard documented pattern

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from package.json
- Architecture: HIGH — verified from codebase structure and next-auth/Next.js official docs
- Pitfalls: HIGH — Edge Runtime / JWT staleness are well-documented constraints; duplicate org pitfall verified from reading existing action code
- Schema changes: HIGH — verified against actual schema.prisma

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (next-auth v4 is stable; Next.js 16 App Router patterns are stable)
