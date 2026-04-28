# Codebase Structure

**Analysis Date:** 2026-04-28

## Directory Layout

```
PascalEditor/
├── apps/
│   └── editor/                         # Main Next.js application
│       ├── app/                        # App Router - pages and API routes
│       │   ├── _components/            # Landing page components
│       │   ├── api/                    # HTTP API endpoints
│       │   ├── dashboard/              # User dashboard
│       │   ├── editor/[id]/            # 3D editor workspace
│       │   ├── login/                  # Auth login page
│       │   ├── signup/                 # Auth signup page
│       │   ├── marketplace/            # Asset marketplace
│       │   ├── onboarding/             # Onboarding flow
│       │   ├── admin/                  # Admin panel
│       │   ├── layout.tsx              # Root layout
│       │   ├── page.tsx                # Landing page
│       │   └── globals.css             # Global styles
│       ├── components/                 # Server/client components (non-page)
│       │   └── collaboration/          # Collaboration system components
│       ├── lib/                        # Utilities and configs
│       │   ├── auth.ts                 # NextAuth configuration
│       │   ├── prisma.ts               # Prisma client singleton
│       │   ├── s3.ts                   # AWS S3 client
│       │   ├── redis.ts                # Redis client
│       │   ├── socket.ts               # Socket.io client
│       │   ├── rbac.ts                 # Role-based access control
│       │   └── utils.ts                # Shared utilities
│       ├── prisma/                     # Database schema and migrations
│       │   ├── schema.prisma           # Data model definitions
│       │   └── generated-client/       # Prisma client (generated)
│       ├── public/                     # Static assets
│       ├── package.json                # Dependencies and scripts
│       ├── next.config.js              # Next.js config
│       ├── tsconfig.json               # TypeScript config
│       └── server.ts                   # Custom Node.js server with Socket.io
│
├── packages/
│   ├── core/                           # 3D scene core logic and schema
│   │   ├── src/
│   │   │   ├── schema/                 # Zod node definitions
│   │   │   │   ├── nodes/              # All node types (Wall, Door, etc.)
│   │   │   │   ├── index.ts            # Export all schemas
│   │   │   │   ├── types.ts            # AnyNode discriminated union
│   │   │   │   ├── collections.ts      # Group/collection types
│   │   │   │   └── material.ts         # Material definitions
│   │   │   ├── systems/                # Domain systems for each element
│   │   │   │   ├── wall/               # Wall system
│   │   │   │   ├── door/               # Door system
│   │   │   │   ├── window/             # Window system
│   │   │   │   ├── roof/               # Roof system
│   │   │   │   ├── ceiling/            # Ceiling system
│   │   │   │   ├── slab/               # Floor slab system
│   │   │   │   ├── stair/              # Stair system
│   │   │   │   ├── fence/              # Fence system
│   │   │   │   └── item/               # Furniture/item system
│   │   │   ├── store/                  # State management (Zustand)
│   │   │   │   ├── use-scene.ts        # Scene graph state
│   │   │   │   ├── collaboration.ts    # Yjs sync logic
│   │   │   │   ├── use-interactive.ts  # Interactive element state
│   │   │   │   └── history-control.ts  # Undo/redo state
│   │   │   ├── hooks/                  # Custom React hooks
│   │   │   │   ├── spatial-grid/       # Spatial queries and collision
│   │   │   │   └── scene-registry/     # Three.js scene registry
│   │   │   ├── events/                 # Event system
│   │   │   │   └── bus.ts              # Event emitter and types
│   │   │   ├── lib/                    # Utilities
│   │   │   │   ├── space-detection.ts  # Automatic room detection
│   │   │   │   ├── asset-storage.ts    # File upload/download
│   │   │   │   └── polygon-geometry.ts # Geometry helpers
│   │   │   ├── material-library.ts     # Material catalog
│   │   │   └── index.ts                # Public exports
│   │   └── package.json                # Core package config
│   │
│   ├── editor/                         # Editor UI components and logic
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── editor/             # Main editor container
│   │   │   │   │   ├── index.tsx       # Editor root component
│   │   │   │   │   ├── floorplan-panel.tsx
│   │   │   │   │   ├── editor-layout-v2.tsx
│   │   │   │   │   ├── floating-action-menu.tsx
│   │   │   │   │   ├── selection-manager.tsx
│   │   │   │   │   └── ...other editor tools
│   │   │   │   ├── ui/                 # UI panels and controls
│   │   │   │   │   ├── sidebar/        # Left sidebar
│   │   │   │   │   ├── command-palette/
│   │   │   │   │   ├── item-catalog/   # Furniture/items library
│   │   │   │   │   ├── panels/         # Settings, site, material panels
│   │   │   │   │   ├── controls/       # Input controls (sliders, etc.)
│   │   │   │   │   └── primitives/     # Basic UI components
│   │   │   │   ├── viewer-overlay.tsx  # 3D viewport overlay UI
│   │   │   │   ├── systems/            # Systems UI layer
│   │   │   │   └── collaboration/      # Presence system
│   │   │   ├── store/                  # Zustand stores
│   │   │   │   ├── use-editor.tsx      # Editor UI state (tools, mode, etc.)
│   │   │   │   ├── use-audio.tsx       # Audio player state
│   │   │   │   ├── use-command-registry.ts  # Command palette actions
│   │   │   │   ├── use-upload.ts       # File upload state
│   │   │   │   └── use-palette-view-registry.ts  # Material preview registry
│   │   │   ├── contexts/               # React contexts
│   │   │   │   └── presets-context.tsx # Material presets management
│   │   │   ├── hooks/                  # Custom hooks
│   │   │   │   └── use-auto-save.ts    # Periodic scene saving
│   │   │   ├── lib/                    # Utilities
│   │   │   │   ├── scene.ts            # Scene graph import/export
│   │   │   │   ├── sfx-bus.ts          # Sound effects trigger system
│   │   │   │   └── ...other utils
│   │   │   └── index.tsx               # Public exports
│   │   └── package.json
│   │
│   ├── viewer/                         # Read-only 3D viewer component
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   └── viewer/             # Main viewer component
│   │   │   │       ├── index.tsx       # Viewer root
│   │   │   │       ├── post-processing.tsx  # SSGI effects
│   │   │   │       ├── walkthrough-controls.tsx
│   │   │   │       └── ...viewer features
│   │   │   ├── systems/                # Viewer-specific systems
│   │   │   │   ├── interactive/        # Click detection, selection
│   │   │   │   ├── level/              # Level management
│   │   │   │   ├── export/             # Model export
│   │   │   │   └── ...other systems
│   │   │   ├── store/                  # Viewer state (camera, materials)
│   │   │   │   └── use-viewer.tsx
│   │   │   ├── lib/                    # Utilities
│   │   │   │   ├── materials.ts        # Material creation
│   │   │   │   ├── asset-url.ts        # CDN URL resolution
│   │   │   │   ├── layers.ts           # Three.js layer constants
│   │   │   │   └── merged-outline-node.ts
│   │   │   └── index.ts                # Public exports
│   │   └── package.json
│   │
│   ├── ui/                             # Shared UI component library
│   │   ├── src/                        # Button, Card, Code components
│   │   └── package.json
│   │
│   ├── typescript-config/              # Shared TypeScript configs
│   ├── eslint-config/                  # Shared ESLint configs
│
├── tooling/
│   ├── release/                        # Release automation scripts
│   └── typescript/                     # TypeScript tooling
│
├── .planning/                          # GSD analysis documents
│   └── codebase/                       # This analysis
│
├── .github/workflows/                  # GitHub Actions CI/CD
├── package.json                        # Root workspace config
├── biome.jsonc                         # Biome linter/formatter config
├── tsconfig.json                       # Root TypeScript config
├── turbo.json                          # Turbo monorepo config
└── docker-compose.yml                  # Local dev environment
```

## Directory Purposes

**`apps/editor/app/`:**
- Purpose: Next.js App Router pages and API endpoints
- Contains: Server/Client components, Server Actions, API routes
- Key files: `layout.tsx`, `page.tsx`, `Providers.tsx`

**`apps/editor/lib/`:**
- Purpose: Shared utilities for server-side code
- Contains: Auth config, DB client, S3 client, Redis client, RBAC utilities
- Key files: `auth.ts`, `prisma.ts`, `rbac.ts`

**`apps/editor/prisma/`:**
- Purpose: Database schema and migrations
- Contains: Prisma schema, generated client
- Key files: `schema.prisma`

**`packages/core/src/schema/`:**
- Purpose: Type-safe node and collection definitions
- Contains: Zod schemas for all building element types
- Pattern: One file per node type in `nodes/`, index file exports all

**`packages/core/src/systems/`:**
- Purpose: Domain logic for each building element type
- Contains: Class-based systems with CRUD operations
- Pattern: One directory per system, `{name}-system.ts` as main export

**`packages/core/src/store/`:**
- Purpose: Zustand stores for scene and interactive state
- Contains: `use-scene.ts` (main 3D state), `collaboration.ts` (Yjs sync)
- Pattern: Monolithic store with all scene data in one tree

**`packages/editor/src/components/editor/`:**
- Purpose: Main editor UI container and tools
- Contains: Floorplan, viewport, action menus, floating panels
- Key file: `index.tsx` (root Editor component)

**`packages/editor/src/components/ui/`:**
- Purpose: Sidebar, command palette, item catalog, material panels
- Contains: Organized by functionality (sidebar, panels, primitives)
- Pattern: Sidebar has tab system with panel content

**`packages/editor/src/store/`:**
- Purpose: Editor UI state (not scene state)
- Contains: Selected tool, mode, viewport settings, audio, upload progress
- Key file: `use-editor.tsx` (main editor UI store)

**`packages/viewer/src/systems/`:**
- Purpose: Viewer-specific 3D rendering logic
- Contains: Interactive selection, model export, level switching
- Pattern: Systems for different aspects (export, level, interactive, scan)

## Key File Locations

**Entry Points:**

- `apps/editor/app/page.tsx`: Landing page
- `apps/editor/app/layout.tsx`: Root layout with fonts and metadata
- `apps/editor/app/editor/[id]/page.tsx`: Editor page (server-side)
- `apps/editor/app/editor/[id]/EditorClient.tsx`: Editor UI (client-side)
- `apps/editor/server.ts`: Custom Node.js server with Socket.io

**Configuration:**

- `apps/editor/package.json`: Next.js app dependencies
- `apps/editor/next.config.js`: Next.js configuration
- `apps/editor/tsconfig.json`: TypeScript paths and options
- `biome.jsonc`: Linter and formatter rules (root level)
- `turbo.json`: Monorepo task configuration

**Core Logic:**

- `packages/core/src/schema/types.ts`: AnyNode discriminated union
- `packages/core/src/store/use-scene.ts`: Scene state and mutations
- `packages/core/src/systems/wall/wall-system.ts`: Wall manipulation logic
- `packages/core/src/events/bus.ts`: Event emitter and types
- `packages/core/src/material-library.ts`: Material catalog

**Editor UI:**

- `packages/editor/src/components/editor/index.tsx`: Editor root component
- `packages/editor/src/components/editor/floorplan-panel.tsx`: 2D view
- `packages/editor/src/components/editor/floating-action-menu.tsx`: Tools menu
- `packages/editor/src/store/use-editor.tsx`: Editor UI state store
- `packages/editor/src/components/ui/sidebar/`: Left panel with tabs

**Viewer:**

- `packages/viewer/src/components/viewer/index.tsx`: Viewer root
- `packages/viewer/src/store/use-viewer.tsx`: Viewer state

**Database/Auth:**

- `apps/editor/prisma/schema.prisma`: Database models
- `apps/editor/lib/auth.ts`: NextAuth configuration
- `apps/editor/lib/rbac.ts`: Role-based access control
- `apps/editor/app/api/auth/signup/route.ts`: Signup endpoint

**Real-time Sync:**

- `apps/editor/server.ts`: WebSocket server (Yjs sync protocol)
- `apps/editor/lib/socket.ts`: Socket.io client initialization
- `packages/core/src/store/collaboration.ts`: Yjs ↔ Zustand binding

**Dashboard:**

- `apps/editor/app/dashboard/page.tsx`: Main dashboard view
- `apps/editor/app/dashboard/actions.ts`: Server actions for DB queries
- `apps/editor/app/dashboard/_components/`: Reusable dashboard components

## Naming Conventions

**Files:**

- Pages: `page.tsx` (Next.js convention)
- API routes: `route.ts` (Next.js convention)
- Server actions: `actions.ts` (co-located in feature directory)
- Zustand stores: `use-{name}.ts` or `use-{name}.tsx`
- React components: `PascalCase.tsx`, e.g. `Editor.tsx`, `Sidebar.tsx`
- Systems: `{name}-system.ts`, e.g. `wall-system.ts`
- Utilities: `kebab-case.ts`, e.g. `asset-storage.ts`

**Directories:**

- Page routes: `[id]/` for dynamic, lowercase for static (Next.js convention)
- Feature directories: lowercase, e.g. `editor/`, `dashboard/`, `api/`
- Component types: `components/`, `ui/`, `systems/`
- Utilities: `lib/`, `hooks/`, `utils/`

**Types:**

- Node types: `{Name}Node`, e.g. `WallNode`, `DoorNode`
- Event types: `{Name}Event`, e.g. `BuildingEvent`, `WallEvent`
- System classes: `{Name}System`, e.g. `WallSystem`, `DoorSystem`
- Store hooks: `use{Name}`, e.g. `useScene`, `useEditor`

## Where to Add New Code

**New Feature (e.g., new building element):**

1. **Schema definition:** `packages/core/src/schema/nodes/{element}.ts`
   - Define Zod schema extending base node types
   - Export in `packages/core/src/schema/index.ts`

2. **System:** `packages/core/src/systems/{element}/{element}-system.ts`
   - Create system class with add/update/delete methods
   - Export in system package index

3. **Editor UI:** `packages/editor/src/components/ui/`
   - Add panel/controls for element properties
   - Register in sidebar or command palette

4. **Viewer:** `packages/viewer/src/systems/{element}/`
   - Add rendering and interaction logic

5. **Tests:** Co-locate alongside implementation with `.test.ts` or `.spec.ts`

**New API Endpoint:**

1. Create route: `apps/editor/app/api/{resource}/{action}/route.ts`
2. Implement POST/GET/PUT handler with error handling
3. Use Prisma for DB queries: `await prisma.{model}.{operation}(...)`
4. Return `NextResponse.json()` with data or error

**New Page:**

1. Create directory: `apps/editor/app/{feature}/`
2. Add `page.tsx` (Server Component by default)
3. Add `layout.tsx` if custom layout needed
4. Import components from `_components/` or `packages/ui/`
5. Use Server Actions for DB queries from `actions.ts`

**New Component:**

- **Global UI:** `packages/ui/src/` (exported from UI package)
- **Editor-specific:** `packages/editor/src/components/{category}/{ComponentName}.tsx`
- **Dashboard:** `apps/editor/app/dashboard/_components/{ComponentName}.tsx`

**New Utility/Hook:**

- **Shared (all packages):** `packages/core/src/lib/` for core logic
- **Editor-only:** `packages/editor/src/lib/` or `packages/editor/src/hooks/`
- **Server-only:** `apps/editor/lib/` for auth, DB, storage

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD analysis documents (ARCHITECTURE.md, STRUCTURE.md, etc.)
- Generated: Yes (by GSD mapper)
- Committed: Yes (tracked in git)

**`packages/core/dist/`:**
- Purpose: Compiled TypeScript output
- Generated: Yes (by `tsc`)
- Committed: No (in .gitignore)

**`apps/editor/.next/`:**
- Purpose: Next.js build output
- Generated: Yes (by `next build`)
- Committed: No (in .gitignore)

**`prisma/generated-client/`:**
- Purpose: Generated Prisma client
- Generated: Yes (by `prisma generate`)
- Committed: Yes (needed at runtime)

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes (by `bun install`)
- Committed: No

**`.turbo/cache/`:**
- Purpose: Turbo monorepo cache
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-04-28*
