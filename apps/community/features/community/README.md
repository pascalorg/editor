# Community Feature

This directory contains the **optional** community features (cloud synchronization and authentication) for the Pascal Editor. This feature is specific to the Pascal platform and can be safely removed if you're using the editor standalone.

## What This Does

The community feature provides:

- **Authentication** - Sign in with magic link via Better Auth
- **Property Management** - Create and manage properties with Google Maps address search
- **Scene Loading** - Automatically load property scenes from the database when a property is selected
- **Auto-Save** - Automatically save scene changes to the database (2-second debounce)
- **Database Sync** - Save and load editor state from a PostgreSQL database via Supabase

## Architecture

```
features/community/
├── lib/
│   ├── auth/
│   │   ├── client.ts          # Re-exports from @pascal-app/auth
│   │   ├── server.ts          # Server-side session handling
│   │   └── hooks.ts           # useAuth React hook
│   ├── properties/
│   │   ├── actions.ts         # Server actions for CRUD operations
│   │   ├── types.ts           # TypeScript types for properties
│   │   ├── hooks.ts           # Property React hooks
│   │   └── store.ts           # Zustand store for property state
│   ├── models/
│   │   ├── actions.ts         # Scene model CRUD operations
│   │   └── hooks.ts           # Scene loading and auto-save hooks
│   ├── database/
│   │   └── server.ts          # Re-exports from @pascal-app/db
│   └── utils/
│       └── id-generator.ts    # nanoid-based ID generation
├── components/
│   ├── cloud-save-button.tsx  # Main UI entry point (top-right button)
│   ├── sign-in-dialog.tsx     # Magic link sign-in dialog
│   ├── profile-dropdown.tsx   # User profile menu
│   ├── property-dropdown.tsx  # Property selector dropdown
│   ├── new-property-dialog.tsx # Create new property dialog
│   └── google-address-search.tsx # Google Maps autocomplete
└── README.md                   # This file
```

## How It Works

### Authentication Flow
1. User clicks "Save to cloud" button
2. Signs in with magic link (email-based, no password)
3. Better Auth session is stored in cookies
4. Server actions validate session using Better Auth API

### Property Management
1. User creates a property with a real-world address (Google Maps)
2. Address and property are saved to PostgreSQL via Supabase
3. Properties are associated with the authenticated user
4. User can switch between properties

### Scene Management
1. When a property is selected, its scene is loaded from `properties_models` table
2. If no scene exists, loads default empty scene
3. Scene changes are auto-saved every 2 seconds (debounced)
4. Updates existing model (highest version) instead of creating new ones
5. Scene graph includes all nodes and hierarchy

### Database Integration
- Uses Supabase (PostgreSQL) for database access
- Better Auth manages authentication tables directly
- Server actions use service role key to bypass RLS
- Permissions enforced by filtering on `owner_id`
- Tables: `users`, `sessions`, `properties`, `properties_addresses`, `properties_models`

## Required Environment Variables

```bash
# Database Connection
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Better Auth
BETTER_AUTH_SECRET=<generate_with_openssl_rand_base64_32>
BETTER_AUTH_URL=http://localhost:3000

# Google Maps API Key (for address search)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key_here
```

Generate `BETTER_AUTH_SECRET`:
```bash
openssl rand -base64 32
```

## Dependencies

The community feature requires these packages:

```json
{
  "better-auth": "^1.4.18",
  "@supabase/supabase-js": "^2.95.3",
  "@react-google-maps/api": "^2.20.8",
  "nanoid": "^5.1.6"
}
```

## How to Remove (For Open Source Users)

If you want to use the editor without community features:

### 1. Delete this directory
```bash
rm -rf features/community
```

### 2. Remove the CloudSaveButton from the editor
Edit `components/editor/index.tsx`:
```diff
- import { CloudSaveButton } from '@/features/community/components/cloud-save-button'

  export default function Editor() {
    return (
      <div className="w-full h-full">
        <ActionMenu />
        <PanelManager />
-       <CloudSaveButton />
```

### 3. Remove dependencies (optional)
Edit `package.json`:
```diff
- "better-auth": "^1.4.18",
- "@supabase/supabase-js": "^2.95.3",
- "@react-google-maps/api": "^2.20.8",
- "nanoid": "^5.1.6"
```

### 4. Remove environment variables
Delete from `.env.local` and `.env.example`:
```diff
- NEXT_PUBLIC_API_URL=...
- NEXT_PUBLIC_SUPABASE_URL=...
- NEXT_PUBLIC_SUPABASE_ANON_KEY=...
- SUPABASE_SERVICE_ROLE_KEY=...
- NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
```

That's it! The editor will work as a standalone application without any cloud features.

## Backend Requirements

This feature requires:
- Supabase local development instance
- PostgreSQL database with the following tables:
  - `users` - User accounts (Better Auth)
  - `sessions` - Authentication sessions (Better Auth)
  - `verification_tokens` - Magic link tokens (Better Auth)
  - `properties` - Property records
  - `properties_addresses` - Property addresses
  - `properties_models` - Scene graph models
- Database migrations are managed in `supabase/migrations/`

## Development

To work on this feature:

1. Install dependencies:
   ```bash
   bun install
   ```
2. Start Supabase local development:
   ```bash
   bun db:start
   ```
3. Run database migrations:
   ```bash
   bun db:reset
   ```
4. Configure all environment variables in `apps/editor/.env.local`
5. Run the editor: `bun dev`

The editor will be available at `http://localhost:3000`.

For detailed setup instructions, see [SETUP.md](../../../SETUP.md) in the root directory.

## Notes

- This feature uses **server actions** (Next.js App Router) for all database operations
- Authentication is handled by **Better Auth** with magic link support
- Better Auth server is configured in `packages/auth` and mounted at `/api/auth/*`
- The editor queries the database directly using Supabase with service role key
- IDs are generated using nanoid with custom alphabet
- Scene state is managed with a **Zustand store** for reliable property switching
- Scene changes are auto-saved with 2-second debouncing to the currently selected property
