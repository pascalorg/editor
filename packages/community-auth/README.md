# @pascal-app/auth

Authentication package for Pascal Editor using Better Auth.

## Features

- **Magic Link Authentication** - Passwordless email-based authentication
- **Session Management** - Secure cookie-based sessions
- **Supabase Integration** - Uses Supabase as the database adapter
- **Type-safe** - Full TypeScript support with type inference

## Setup

### 1. Configure environment variables

Add these to `apps/editor/.env.local`:

```bash
# Better Auth
BETTER_AUTH_SECRET=<generate_with_openssl_rand_base64_32>
BETTER_AUTH_URL=http://localhost:3000
```

Generate a secret for `BETTER_AUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 2. Ensure database is running

Make sure you have Supabase running with the auth tables created. See `@pascal-app/db` package for setup.

## Usage

### Server-side (API routes, server actions)

```typescript
import { auth } from '@pascal-app/auth/server'

// Get session in server component or action
const session = await auth.api.getSession({ headers: request.headers })

if (!session) {
  return { error: 'Unauthorized' }
}

// Access user data
const userId = session.user.id
const email = session.user.email
```

### Client-side (React components)

```typescript
'use client'

import { authClient } from '@pascal-app/auth/client'

function SignInButton() {
  const { signIn } = authClient

  const handleSignIn = async (email: string) => {
    await signIn.magicLink({
      email,
      callbackURL: '/dashboard',
    })
  }

  return <button onClick={() => handleSignIn('user@example.com')}>Sign In</button>
}
```

### Using the auth hook

```typescript
'use client'

import { authClient } from '@pascal-app/auth/client'

function Profile() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return <div>Loading...</div>
  if (!session) return <div>Not signed in</div>

  return <div>Signed in as {session.user.email}</div>
}
```

## API Routes

The auth package requires an API route handler in your Next.js app:

```typescript
// app/api/auth/[...all]/route.ts
import { auth } from '@pascal-app/auth/server'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth)
```

This handles all Better Auth endpoints:
- `/api/auth/sign-in/magic-link` - Send magic link
- `/api/auth/sign-in/magic-link/verify` - Verify magic link
- `/api/auth/sign-out` - Sign out
- `/api/auth/session` - Get session
- And more...

## Email Configuration

By default, magic links are logged to the console. To send actual emails, you'll need to configure an email provider in `packages/auth/src/server.ts`:

```typescript
magicLink({
  sendMagicLink: async ({ email, url }) => {
    // Use Resend, SendGrid, or your preferred email service
    await sendEmail({
      to: email,
      subject: 'Sign in to Pascal Editor',
      html: `Click here to sign in: <a href="${url}">${url}</a>`,
    })
  },
})
```

## Database Schema

The auth package requires these tables (created by `@pascal-app/db` migrations):

- `users` - User accounts
- `sessions` - Active sessions
- `accounts` - OAuth provider accounts (for future use)
- `verification_tokens` - Magic link tokens

## Security

- Session cookies are httpOnly and secure (in production)
- Sessions expire after 7 days
- Session cache is enabled for 5 minutes to reduce database queries
- Magic link tokens expire after 15 minutes
- All sensitive operations require valid session tokens
