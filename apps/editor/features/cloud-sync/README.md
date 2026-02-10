# Cloud Sync Feature

This directory contains the **optional** cloud synchronization and authentication features for the Pascal Editor. This feature is specific to the Pascal platform and can be safely removed if you're using the editor standalone.

## What This Does

The cloud sync feature provides:

- **Authentication** - Sign in with magic link via Better Auth
- **Property Management** - Create and manage properties with Google Maps address search
- **Database Sync** - Save and load editor state from a PostgreSQL database via Supabase

## Architecture

```
features/cloud-sync/
├── lib/
│   ├── auth/
│   │   ├── client.ts          # Better Auth client configuration
│   │   ├── server.ts          # Server-side session handling
│   │   └── hooks.ts           # useAuth React hook
│   ├── properties/
│   │   ├── actions.ts         # Server actions for CRUD operations
│   │   ├── types.ts           # TypeScript types for properties
│   │   └── hooks.ts           # useProperties and useActiveProperty hooks
│   ├── database/
│   │   └── server.ts          # Supabase server client with service role
│   └── utils/
│       └── id-generator.ts    # nanoid-based ID generation (matches backend)
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
4. Server actions validate session by calling the monorepo backend

### Property Management
1. User creates a property with a real-world address (Google Maps)
2. Address and property are saved to PostgreSQL via Supabase
3. Properties are associated with the authenticated user
4. User can switch between properties

### Database Integration
- Uses Supabase (PostgreSQL) for database access
- Server actions use service role key to bypass RLS
- Permissions enforced by filtering on `owner_id`
- Table names: `properties`, `properties_addresses`, `auth_sessions`

## Required Environment Variables

```bash
# Backend API URL (Pascal monorepo - for better-auth only)
NEXT_PUBLIC_API_URL=http://localhost:3000

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Google Maps API Key (for address search)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key_here
```

## Dependencies

The cloud sync feature requires these packages:

```json
{
  "better-auth": "^1.4.18",
  "@supabase/supabase-js": "^2.95.3",
  "@react-google-maps/api": "^2.20.8",
  "nanoid": "^5.1.6"
}
```

## How to Remove (For Open Source Users)

If you want to use the editor without cloud sync:

### 1. Delete this directory
```bash
rm -rf features/cloud-sync
```

### 2. Remove the CloudSaveButton from the editor
Edit `components/editor/index.tsx`:
```diff
- import { CloudSaveButton } from '@/features/cloud-sync/components/cloud-save-button'

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

This feature requires the Pascal monorepo backend running with:
- Better Auth configured with magic link support
- PostgreSQL database with the following tables:
  - `properties` - Property records
  - `properties_addresses` - Property addresses
  - `auth_sessions` - Better Auth sessions
  - `auth_users` - Better Auth users
- Supabase local instance for database access

## Development

To work on this feature:

1. Ensure the monorepo backend is running on port 3000
2. Ensure Supabase local is running on port 54321
3. Configure all environment variables
4. Run the editor: `bun dev`

The editor will be available at `http://localhost:3002` (different port to avoid conflicts with the monorepo).

## Notes

- This feature uses **server actions** (Next.js App Router) for all database operations
- Authentication is handled by the monorepo backend via Better Auth
- The editor queries the database directly using Supabase with service role key
- IDs are generated using nanoid with custom alphabet to match the backend schema
- All table names match the monorepo's database schema exactly
