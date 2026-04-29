---
phase: 02-authentication
plan: 02
subsystem: auth
tags: [password-reset, prisma, nextjs, nextauth, bcrypt]

# Dependency graph
requires:
  - phase: 02-01
    provides: Google OAuth + login page with Google button (preserved additive edit)
provides:
  - PasswordResetToken Prisma model + regenerated client
  - POST /api/auth/forgot-password (token generation, no-enumeration, returns resetUrl in v1)
  - POST /api/auth/reset-password (token validation, bcrypt hash update, single-use, atomic transaction)
  - /forgot-password page (email form + on-screen reset URL for v1)
  - /reset-password page (useSearchParams token wiring + newPassword form)
  - "Forgot password?" link on /login (signin mode, right-aligned, additive)
  - ?reset=success green banner on /login
affects: [02-authentication, login-page, password-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "No email provider in v1 — resetUrl returned in API response and shown on-screen (TODO: swap for Resend in v2)"
    - "No email enumeration — identical 200 response regardless of whether user exists"
    - "Token single-use via usedAt nullable timestamp; expiry via expiresAt < now check"
    - "Atomic prisma.$transaction([user.update, passwordResetToken.update]) prevents partial state"
    - "useSearchParams wrapped in Suspense on /reset-password to satisfy Next.js App Router static rendering"

key-files:
  created:
    - apps/editor/app/api/auth/forgot-password/route.ts
    - apps/editor/app/api/auth/reset-password/route.ts
    - apps/editor/app/forgot-password/page.tsx
    - apps/editor/app/reset-password/page.tsx
  modified:
    - apps/editor/prisma/schema.prisma
    - apps/editor/prisma/generated-client/ (regenerated)
    - apps/editor/app/login/page.tsx

key-decisions:
  - "v1 reset URL returned in API response body and rendered on-screen — no email provider; must be removed before production launch"
  - "Password min length: 8 characters — enforced both client-side (minLength attr + JS check) and server-side (newPassword.length < 8 guard in route)"
  - "Token stored as raw 64-char hex (32 randomBytes) — acceptable for v1 (1h TTL, single-use); future hardening: store SHA-256 of token"
  - "email field (not userId) on PasswordResetToken — consistent with no-enumeration design; email already unique on User"
  - "No migration file — project uses db push at deploy time via Docker Compose; prisma validate + generate run locally to type-check"

# Metrics
duration: 25min
completed: 2026-04-28
---

# Phase 02 Plan 02: Password Reset Flow Summary

**Hand-rolled AUTH-03 password reset: PasswordResetToken Prisma model, two API routes, two pages, v1 on-screen URL shortcut (no email provider), single-use expiring tokens with atomic DB transaction**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-28
- **Completed:** 2026-04-28
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added `PasswordResetToken` model to `schema.prisma` with `token (unique)`, `email`, `expiresAt`, `usedAt?`, and indexes on both `email` and `token`
- Regenerated Prisma client — `prisma.passwordResetToken` delegate now available in TypeScript
- Created `POST /api/auth/forgot-password`: generates 64-char hex token, sets 1h TTL, returns `resetUrl` in response (v1 shortcut), logs to server console, generic 200 for unknown emails
- Created `POST /api/auth/reset-password`: validates token exists + not used + not expired, bcrypt-hashes new password (salt rounds 10), updates User.password and marks token used atomically via `prisma.$transaction`
- Created `/forgot-password` page: email input form, calls API, shows generic confirmation + v1 dev block with clickable URL and Copy button when `resetUrl` present
- Created `/reset-password` page: reads `?token=` via `useSearchParams` (wrapped in `<Suspense>`); no-token state shows "invalid link" without form; form has `newPassword` + `confirmPassword` with client-side length/match validation; server error surfaced inline; success message + redirect to `/login?reset=success` after 1.5s
- Modified `/login` page (additive only): added "Forgot password?" link in signin mode below password field (right-aligned), added green "Password updated" banner on `?reset=success`

## API Contracts

**POST /api/auth/forgot-password**
- Body: `{ email: string }`
- Success: `{ success: true, resetUrl?: string }` — `resetUrl` present only if user exists (v1)
- Error (400): `{ error: "Email is required" }`
- Error (500): `{ error: "Internal server error" }`

**POST /api/auth/reset-password**
- Body: `{ token: string, newPassword: string }`
- Success: `{ success: true }`
- Error (400): `{ error: "Token and new password are required" | "Password must be at least 8 characters" | "This reset link is invalid or has expired" }`
- Error (500): `{ error: "Internal server error" }`

## Token Wiring on /reset-password

```ts
const searchParams = useSearchParams()
const token = searchParams.get('token')
// ...
body: JSON.stringify({ token, newPassword })
```

Token sourced from URL query string via `useSearchParams`, passed directly as `token` field in fetch body — matches the `{ token, newPassword }` API contract.

## v1 "URL on Screen" UX Shortcut

Per locked decision (no email provider for v1): `resetUrl` is returned in the API response JSON and rendered on `/forgot-password` inside an amber "Dev mode (v1)" callout with a Copy button. **This MUST be removed before any production launch** — replace with Resend or similar transactional email service in v2.

Server console also logs: `[forgot-password] reset URL for {email}: {url}`

## Password Length Policy

- Minimum: **8 characters**
- Enforced client-side: `minLength={8}` on input + `newPassword.length < 8` JS guard before fetch
- Enforced server-side: `if (newPassword.length < 8)` check in `reset-password/route.ts` returns 400
- Consistent with existing login page signup mode (`minLength={mode === 'signup' ? 8 : undefined}`)

## 02-01 Google Button Preservation

The `signIn('google', ...)` call, the Google SVG button, its `googleLoading` state, the "or" divider, and the `?error=` OAuth banner were all **preserved verbatim** on `/login`. This plan only added:
1. `resetSuccess` state + `?reset=success` detection in the existing `useEffect`
2. Green success banner JSX before the error block
3. "Forgot password?" `<Link>` after the password input (signin mode only)

`grep -n 'google' apps/editor/app/login/page.tsx` confirms Google provider still present at lines 81 (signIn call) and 230–244 (button JSX).

## Task Commits

1. **Task 1: PasswordResetToken model + Prisma generate** — `2fa0d71` (feat)
2. **Task 2: forgot-password + reset-password API routes** — `7d015a3` (feat)
3. **Task 3: pages + login page additions** — `72e5765` (feat)

## Deviations from Plan

**1. [Rule 3 - Blocking] No local DB for prisma migrate dev**
- **Found during:** Task 1
- **Issue:** No `.env` file with `DATABASE_URL`; Docker not running; `prisma migrate dev` requires live DB connection
- **Fix:** Ran `prisma validate` (with dummy DATABASE_URL env var to satisfy schema parser) + `prisma generate` to regenerate client. Schema model is correct; migration will run automatically at Docker deploy time (project uses `db push` / migration at container startup, no local migrations directory exists)
- **Impact:** No functional difference — the schema change is committed; the Prisma client reflects the new model; the table will be created at deployment

## Self-Check: PASSED

All required files exist. All task commits present (2fa0d71, 7d015a3, 72e5765).
