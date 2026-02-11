# Pascal Editor - Setup Guide

This guide will help you set up the Pascal Editor with authentication and database integration.

## Prerequisites

- Node.js 18+ or Bun 1.3+
- Docker Desktop (for running Supabase locally)

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

This installs the Supabase CLI as a dev dependency - no need for global installation!

### 2. Start Supabase Local Development

```bash
bun db:start
```

This will start a local Supabase instance. You'll see output like:

```
API URL: http://127.0.0.1:54321
DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL: http://127.0.0.1:54323
Anon key: eyJh...
Service role key: eyJh...
```

### 4. Configure Environment Variables

Create `apps/editor/.env.local` with the following variables:

```bash
# Database Connection (Supabase local)
POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU

# Better Auth (generate your own secret with: openssl rand -base64 32)
BETTER_AUTH_SECRET=<generate_with_command_below>
BETTER_AUTH_URL=http://localhost:3000

# Google Maps (optional, for address search)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<your_google_maps_key>
```

Generate a secret for `BETTER_AUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 5. Run Database Migrations

```bash
bun db:reset
```

This will create all necessary tables for authentication and properties.

### 6. Start the Development Server

```bash
bun dev
```

The editor will be available at http://localhost:3000

## Monorepo Structure

```
.
├── apps/
│   └── editor/              # Next.js editor application
│       ├── app/
│       │   └── api/auth/    # Better Auth API routes
│       ├── components/      # UI components
│       └── features/
│           └── cloud-sync/  # Cloud sync feature
├── packages/
│   ├── auth/               # @pascal-app/auth - Authentication package
│   │   ├── src/
│   │   │   ├── server.ts   # Better Auth server config
│   │   │   └── client.ts   # Better Auth client
│   │   └── README.md
│   ├── db/                 # @pascal-app/db - Database package
│   │   ├── src/
│   │   │   ├── client.ts   # Supabase client (with RLS)
│   │   │   ├── server.ts   # Supabase admin client
│   │   │   └── types.ts    # Database types
│   │   ├── supabase/
│   │   │   ├── config.toml
│   │   │   └── migrations/ # SQL migrations
│   │   └── README.md
│   ├── core/               # @pascal-app/core - Core editor logic
│   ├── viewer/             # @pascal-app/viewer - 3D viewer
│   └── ui/                 # @repo/ui - Shared UI components
└── turbo.json
```

## Database Schema

### Auth Tables (Better Auth)

- **users** - User accounts with email and profile
- **sessions** - Active authentication sessions
- **accounts** - OAuth provider accounts (for future use)
- **verification_tokens** - Magic link tokens

### Application Tables

- **properties** - User properties
  - `id`: Property ID
  - `name`: Property name
  - `owner_id`: User ID (foreign key to users)

- **properties_addresses** - Property addresses with Google Maps data
  - `id`: Address ID
  - `property_id`: Property ID (foreign key)
  - `formatted_address`: Full address
  - `latitude`, `longitude`: GPS coordinates
  - Plus detailed address components (street, city, state, etc.)

- **properties_models** - Scene graph models (versions)
  - `id`: Model ID
  - `property_id`: Property ID (foreign key)
  - `name`: Model name
  - `version`: Version number
  - `draft`: Draft status
  - `scene_graph`: JSONB scene graph data

## Features

### Authentication

- **Magic Link Sign-In**: Passwordless authentication via email
- **Session Management**: 7-day sessions with automatic refresh
- **Cookie-based**: Secure httpOnly cookies

### Property Management

- **Create Properties**: Add properties with real-world addresses
- **Google Maps Integration**: Address autocomplete and geocoding
- **Switch Properties**: Seamlessly switch between properties

### Scene Management

- **Auto-Save**: Changes saved every 2 seconds
- **Scene Loading**: Automatic scene loading when switching properties
- **Version Control**: Models are versioned for future rollback support

## Development Workflow

### Making Database Changes

1. Create a new migration:
   ```bash
   cd packages/db
   supabase migration new your_migration_name
   ```

2. Edit the migration file in `supabase/migrations/`

3. Apply the migration:
   ```bash
   supabase db reset
   ```

### Updating Database Types

After changing the database schema, regenerate TypeScript types:

1. Update `packages/db/src/types.ts` to match your new schema
2. Run `bun install` to update type checking

### Testing Authentication

1. Start the editor: `bun dev`
2. Click "Save to cloud" button
3. Enter your email
4. Check console for magic link (not sent via email in development)
5. Click the link to authenticate

## Supabase Studio

Access the local Supabase Studio at: http://127.0.0.1:54323

Use this to:
- Browse and edit tables
- Run SQL queries
- View logs
- Manage RLS policies
- Test database functions

## Production Deployment

For production deployment:

1. Create a Supabase project at https://supabase.com
2. Get your production database connection string
3. Update environment variables in your hosting platform
4. Link and push migrations:
   ```bash
   cd packages/db
   bunx supabase link --project-ref your-project-ref
   bunx supabase db push
   ```
5. Configure email provider in `packages/auth/src/server.ts`

## Troubleshooting

### "Missing POSTGRES_URL" error

Make sure you've set `POSTGRES_URL` in `apps/editor/.env.local` to your Supabase connection string.

### Supabase not starting

Try stopping and restarting:
```bash
bun db:stop
bun db:start
```

### Migration errors

Reset the database:
```bash
cd packages/db
supabase db reset
```

### Auth not working

1. Check that Better Auth API route exists at `apps/editor/app/api/auth/[...all]/route.ts`
2. Verify `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set
3. Check console for magic link URLs in development

## Next Steps

- Configure email provider for magic links
- Add OAuth providers (Google, GitHub, etc.)
- Set up production Supabase project
- Configure RLS policies for additional security
- Add more property features (sharing, collaboration, etc.)
