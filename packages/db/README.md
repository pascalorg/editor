# @pascal-app/db

Database package for Pascal Editor with Supabase.

## Setup

### 1. Install Dependencies

From the monorepo root:

```bash
bun install
```

This installs Supabase CLI as a dev dependency.

### 2. Start Supabase locally

From the monorepo root:

```bash
bun db:start
```

This will start a local Supabase instance with PostgreSQL, PostgREST, and Studio.

### 3. Check Supabase status

```bash
bun db:status
```

You'll see output like:

```
API URL: http://127.0.0.1:54321
DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL: http://127.0.0.1:54323
Anon key: eyJh...
Service role key: eyJh...
```

### 4. Configure environment variables

Add these to `apps/editor/.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>

# Better Auth
BETTER_AUTH_SECRET=<generate_with_openssl_rand_base64_32>
BETTER_AUTH_URL=http://localhost:3000
```

Generate a secret for `BETTER_AUTH_SECRET`:

```bash
openssl rand -base64 32
```

## Migrations

Migrations are located in `supabase/migrations/`.

### Apply migrations

```bash
bun db:reset  # Resets and applies all migrations
```

### Create a new migration

```bash
cd packages/db
bunx supabase migration new <migration_name>
```

## Database Schema

### Auth Tables (Better Auth)

- `users` - User accounts
- `sessions` - Active sessions
- `accounts` - OAuth provider accounts
- `verification_tokens` - Magic link tokens

### Application Tables

- `properties` - User properties
- `properties_addresses` - Property addresses with Google Maps data
- `properties_models` - Scene graph models (versions)

## Usage

### Client-side (with RLS)

```typescript
import { supabase } from '@pascal-app/db/client'

// RLS policies automatically filter by authenticated user
const { data } = await supabase.from('properties').select('*')
```

### Server-side (service role)

```typescript
import { supabaseAdmin } from '@pascal-app/db/server'

// Bypasses RLS - you must manually filter by user_id
const { data } = await supabaseAdmin
  .from('properties')
  .select('*')
  .eq('owner_id', userId)
```

## Supabase Studio

Access the local Supabase Studio at: http://127.0.0.1:54323

Use this to:
- Browse tables and data
- Run SQL queries
- View logs
- Manage RLS policies
