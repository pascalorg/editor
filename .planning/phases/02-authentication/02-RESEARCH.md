# Phase 02: Authentication - Research

**Researched:** 2026-04-28
**Domain:** NextAuth v4, Google OAuth, Token-Based Password Reset, Next.js App Router
**Confidence:** HIGH (codebase inspected directly, official docs verified)

---

## Summary

The existing codebase has a solid foundation: NextAuth v4 with a CredentialsProvider, JWT session strategy, bcryptjs hashing, a custom `/api/auth/signup` route, and a polished login/signup UI at `/login`. The Prisma `User` model already has `emailVerified`, `image`, and `password` (nullable) — exactly what OAuth providers expect.

Phase 2 has two distinct workstreams. First, adding Google OAuth: this is additive — one import, one extra entry in the `providers` array in `lib/auth.ts`, plus `allowDangerousEmailAccountLinking: true` so users who signed up with email/password can also sign in via Google using the same email. Second, password reset: NextAuth v4 does NOT provide this out of the box. It requires a custom `PasswordResetToken` Prisma model, a `/api/auth/forgot-password` route to generate tokens, a `/api/auth/reset-password` route to validate and apply them, and two new pages. Because Resend is not configured for v1, the reset URL will be logged to the console in development and the UI will display the link directly (developer/admin shares it manually).

**Primary recommendation:** Add GoogleProvider to `authOptions` with `allowDangerousEmailAccountLinking: true`, add a Google sign-in button to the existing login page, implement token-based password reset entirely with custom routes + Prisma model, and surface the reset URL in the UI (no email delivery for v1).

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| next-auth | ^4.24.14 | Auth session, providers, callbacks | Installed, configured |
| @prisma/client | 5.10.0 | DB access for token storage | Installed, schema ready |
| bcryptjs | ^3.0.3 | Password hashing for reset | Installed |

### What needs adding
| Item | Purpose |
|------|---------|
| `GOOGLE_CLIENT_ID` env var | Google OAuth credential |
| `GOOGLE_CLIENT_SECRET` env var | Google OAuth credential |
| `PasswordResetToken` Prisma model | Store reset tokens with expiry |
| New Prisma migration | Apply schema change |

### Nothing to install
No new npm packages are needed. `crypto` (Node built-in) generates secure tokens. `bcryptjs` already hashes passwords. NextAuth v4 is already wired up.

---

## Architecture Patterns

### Existing Structure (do not change)
```
apps/editor/
├── lib/auth.ts                           # authOptions — add GoogleProvider here
├── app/api/auth/
│   ├── [...nextauth]/route.ts            # NextAuth handler — no changes needed
│   └── signup/route.ts                  # Custom signup — no changes needed
├── app/login/page.tsx                   # Add Google button here
└── app/signup/page.tsx                  # Exists, scaffolded
```

### New files for password reset
```
apps/editor/
├── app/api/auth/
│   ├── forgot-password/route.ts         # POST: generate token, log/display URL
│   └── reset-password/route.ts          # POST: validate token, hash + save new password
├── app/forgot-password/page.tsx         # Email input form
└── app/reset-password/page.tsx          # New password form (reads ?token= from URL)
```

### Pattern 1: Adding GoogleProvider to authOptions
**What:** Import and add `GoogleProvider` to the `providers` array in `lib/auth.ts`. Set `allowDangerousEmailAccountLinking: true` so a user who previously signed up with email/password can also authenticate via Google without creating a second account.
**When to use:** Any time an OAuth provider is added alongside CredentialsProvider with a shared user table.

```typescript
// Source: https://next-auth.js.org/providers/google
import GoogleProvider from "next-auth/providers/google";

// Inside authOptions.providers:
GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  allowDangerousEmailAccountLinking: true,
}),
```

**Important:** `allowDangerousEmailAccountLinking` is safe here because Google verifies emails. It is the standard approach when mixing credentials + OAuth on the same user table.

### Pattern 2: JWT callback for Google sign-in
**What:** When a user signs in via Google for the first time, NextAuth creates a new User record using the JWT session strategy. The `jwt` callback receives `account` and `profile` on first sign-in. The existing callback already propagates `token.id`. No changes needed to callbacks unless `user.id` is missing for OAuth users (check: NextAuth populates `user.id` from DB for OAuth with JWT strategy when using Prisma adapter — but this project does NOT use a Prisma adapter).

**Critical gap — no Prisma adapter:** The current setup uses JWT strategy with NO database adapter. This means:
- Google sign-in via NextAuth's built-in flow will NOT persist the user to the `User` table automatically.
- The `authorize` function in CredentialsProvider manually reads from DB, but GoogleProvider has no such hook.
- **Solution:** Use the `signIn` callback in `authOptions` to upsert the user into the DB when provider is `"google"`.

```typescript
// Source: https://next-auth.js.org/configuration/callbacks#sign-in-callback
callbacks: {
  async signIn({ user, account, profile }) {
    if (account?.provider === "google") {
      // Upsert user record so Google users exist in our DB
      await prisma.user.upsert({
        where: { email: user.email! },
        update: { name: user.name, image: user.image },
        create: {
          email: user.email!,
          name: user.name,
          image: user.image,
          emailVerified: new Date(),
        },
      });
    }
    return true;
  },
  async jwt({ token, user, account }) {
    if (user) {
      // For credentials sign-in, user.id is set by authorize()
      // For Google sign-in, look up id from DB
      if (account?.provider === "google") {
        const dbUser = await prisma.user.findUnique({ where: { email: token.email! } });
        token.id = dbUser?.id;
      } else {
        token.id = user.id;
      }
    }
    return token;
  },
  // session callback unchanged
}
```

### Pattern 3: PasswordResetToken model
**What:** A custom Prisma model storing a cryptographically random token, the user's email, and an expiry timestamp. No NextAuth involvement — entirely custom routes.

```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  email     String
  token     String   @unique
  expiresAt DateTime

  createdAt DateTime @default(now())

  @@index([email])
}
```

Token generation (in `/api/auth/forgot-password`):
```typescript
import crypto from "crypto";

const token = crypto.randomBytes(32).toString("hex");
const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
```

### Pattern 4: Password reset flow (no email for v1)
**What:** Generate token, store in DB, log URL to console, AND return the URL in the API response so the UI can display it. Document that wiring a real email provider (Resend) replaces the console.log.

```
POST /api/auth/forgot-password
  body: { email }
  → find user by email (silently succeed if not found, security)
  → delete any existing tokens for this email
  → create new PasswordResetToken
  → console.log(`[DEV] Reset URL: /reset-password?token=${token}`)
  → return { success: true, devResetUrl: `/reset-password?token=${token}` }
    (devResetUrl only included in dev or when no email provider)

POST /api/auth/reset-password  
  body: { token, password }
  → find PasswordResetToken by token
  → check expiresAt > now()
  → hash new password with bcrypt
  → update User.password
  → delete the used token
  → return { success: true }
```

### Pattern 5: Google sign-in button in existing login page
**What:** Call `signIn("google")` from `next-auth/react`. NextAuth handles the redirect automatically.

```typescript
import { signIn } from "next-auth/react";

<button onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
  Continue with Google
</button>
```

The button goes in the existing `/login/page.tsx` below the credentials form, separated by an "or" divider.

### Anti-Patterns to Avoid
- **Using a Prisma adapter to solve the OAuth persistence problem:** Do NOT add `@auth/prisma-adapter` — this changes the session strategy requirements and breaks the existing JWT setup. The `signIn` callback upsert is the correct approach for this project.
- **Exposing devResetUrl in production:** Gate the `devResetUrl` response field behind `process.env.NODE_ENV === "development"` or a `EMAIL_ENABLED` flag.
- **Not deleting used/expired tokens:** Always delete the token after a successful reset and purge expired tokens on new token creation to avoid DB growth.
- **Skipping token expiry check:** Always check `token.expiresAt > new Date()` before allowing the reset.
- **Reusing the same token format as NextAuth's VerificationToken:** Keep `PasswordResetToken` as a separate model to avoid confusion with any future email magic link setup.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secure token generation | Custom UUID/Math.random | `crypto.randomBytes(32).toString("hex")` | Node built-in, cryptographically secure |
| Password hashing | Custom hash | `bcrypt.hash(password, 10)` | Already in project, correct rounds |
| OAuth redirect flow | Custom OAuth dance | `signIn("google")` from next-auth/react | NextAuth handles PKCE, state, callback |
| Session persistence (AUTH-04) | Custom cookie/localStorage | NextAuth JWT strategy (already configured) | Already works — `session.strategy: "jwt"` means HttpOnly cookie, survives refresh and tab reopen |

**Key insight:** AUTH-04 (session persistence) is already solved. JWT strategy with `strategy: "jwt"` stores the session in an HttpOnly cookie that persists across refresh and tab close/reopen. No additional work needed — just verify it works.

---

## Common Pitfalls

### Pitfall 1: OAuth user not persisted to DB (no adapter)
**What goes wrong:** User signs in with Google, NextAuth creates an in-memory JWT, but no `User` row is created. The rest of the app (organizations, projects, etc.) tries to `findUnique` by `user.id` from session and finds nothing.
**Why it happens:** Without a Prisma adapter, NextAuth does not manage DB records for OAuth users.
**How to avoid:** Implement the `signIn` callback upsert (see Pattern 2 above). This creates/updates the User row before the JWT is issued.
**Warning signs:** Dashboard loads but org/project queries return null; `session.user.id` is undefined in server components.

### Pitfall 2: Google OAuth callback URL mismatch
**What goes wrong:** Google returns `redirect_uri_mismatch` error.
**Why it happens:** The Google Cloud Console OAuth app's "Authorized redirect URIs" does not include the exact callback URL NextAuth uses.
**How to avoid:** Add `http://localhost:3000/api/auth/callback/google` (dev) and the production URL to the Google Cloud Console. The exact path must be `/api/auth/callback/google`.
**Warning signs:** Error page after Google consent screen.

### Pitfall 3: `allowDangerousEmailAccountLinking` not set
**What goes wrong:** User who signed up with email/password tries Google sign-in with the same email — NextAuth silently blocks the sign-in (returns false from signIn callback) with no clear error.
**Why it happens:** Default NextAuth behavior prevents automatic account linking.
**How to avoid:** Set `allowDangerousEmailAccountLinking: true` in GoogleProvider config.

### Pitfall 4: `NEXTAUTH_URL` not set in production
**What goes wrong:** OAuth redirect URLs are malformed in production.
**Why it happens:** NextAuth uses `NEXTAUTH_URL` to construct callback URLs. In dev it auto-detects, in production it must be set.
**How to avoid:** Set `NEXTAUTH_URL=https://yourdomain.com` in production env.

### Pitfall 5: Reset token not deleted after use
**What goes wrong:** The same token can be used multiple times.
**How to avoid:** Always `prisma.passwordResetToken.delete({ where: { token } })` immediately after a successful password update.

### Pitfall 6: Showing "email not found" on forgot-password
**What goes wrong:** Attacker can enumerate which emails are registered.
**How to avoid:** Always return `{ success: true }` from `/api/auth/forgot-password` regardless of whether the email exists. Only generate/store a token if the user was found.

---

## Code Examples

### Google OAuth env vars needed
```bash
# .env.local
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<existing>
```

### Prisma migration for PasswordResetToken
```bash
# After adding model to schema.prisma:
npx prisma migrate dev --name add-password-reset-token
```

### Full updated authOptions (lib/auth.ts)
```typescript
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    CredentialsProvider({
      // ... existing config unchanged
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.email) {
        await prisma.user.upsert({
          where: { email: user.email },
          update: { name: user.name ?? undefined, image: user.image ?? undefined },
          create: {
            email: user.email,
            name: user.name,
            image: user.image,
            emailVerified: new Date(),
          },
        });
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google") {
          const dbUser = await prisma.user.findUnique({ where: { email: token.email! } });
          token.id = dbUser?.id;
        } else {
          token.id = user.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
};
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| NextAuth v5 (Auth.js) different API | This project uses v4 — correct, don't upgrade | v5 has breaking config changes; v4 patterns apply |
| Prisma adapter for OAuth | signIn callback upsert (JWT strategy) | Adapter would break JWT strategy; upsert is the right v4 pattern without adapter |
| Nodemailer for email | Resend (not for v1) | console.log URL for v1, wire Resend later |

---

## Open Questions

1. **Google Cloud Console setup**
   - What we know: Needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - What's unclear: Whether the developer has a GCP project set up or needs to create one
   - Recommendation: Document the GCP Console steps in the plan (create OAuth 2.0 app, add authorized redirect URIs). This is a pre-task prerequisite.

2. **devResetUrl exposure**
   - What we know: For v1, no email is sent; token URL must be surfaced somehow
   - What's unclear: Whether showing the reset URL in the UI is acceptable UX (vs. a dev-only console.log)
   - Recommendation: Show the URL in the UI in `NODE_ENV === "development"` with a note "Email delivery not configured — share this link". In production, show "Check your email" (even though nothing sends — the production deployment should have Resend wired before go-live).

3. **Existing `/app/signup/page.tsx`**
   - What we know: It exists (scaffolded) but its content is unknown
   - What's unclear: Whether it duplicates logic from `/login/page.tsx` or is empty
   - Recommendation: The plan should read it and consolidate if needed; the login page already handles both modes.

---

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `apps/editor/lib/auth.ts`, `apps/editor/app/api/auth/[...nextauth]/route.ts`, `apps/editor/app/api/auth/signup/route.ts`, `apps/editor/app/login/page.tsx`, `apps/editor/prisma/schema.prisma` — read directly
- [NextAuth.js Google Provider docs](https://next-auth.js.org/providers/google) — verified GoogleProvider config
- [NextAuth.js OAuth Provider docs](https://next-auth.js.org/configuration/providers/oauth) — verified `allowDangerousEmailAccountLinking`

### Secondary (MEDIUM confidence)
- [NextAuth GitHub Discussion #2808](https://github.com/nextauthjs/next-auth/discussions/2808) — multiple accounts same email handling
- [NextAuth GitHub Issue #1915](https://github.com/nextauthjs/next-auth/issues/1915) — credentials + OAuth linking pattern
- [HackerNoon: Password reset with NextAuth](https://hackernoon.com/enhancing-password-security-and-recovery-with-nextjs-14-and-nextauthjs) — token-based reset pattern (verified against Node crypto docs)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in package.json, versions confirmed
- Google OAuth pattern: HIGH — official docs verified, `allowDangerousEmailAccountLinking` confirmed
- No-adapter signIn callback upsert: MEDIUM — widely used community pattern, consistent with NextAuth v4 JWT behavior
- Password reset token pattern: HIGH — standard web pattern, uses only Node built-ins and existing Prisma
- AUTH-04 session persistence: HIGH — JWT strategy already configured, HttpOnly cookie behavior is default

**Research date:** 2026-04-28
**Valid until:** 2026-05-28 (NextAuth v4 is stable/maintenance mode, unlikely to change)
