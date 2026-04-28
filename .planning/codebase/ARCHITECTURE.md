# Architecture

**Analysis Date:** 2026-04-28

## Pattern Overview

**Overall:** Monorepo-based full-stack 3D collaborative SaaS platform with modular packages, Next.js frontend, WebSocket real-time sync (Yjs + Socket.io), and domain-driven systems.

**Key Characteristics:**
- Modular package architecture: core logic, editor UI, viewer components, shared UI/config
- Hybrid client-server: Next.js App Router with Server Actions + WebSocket/Socket.io for real-time collaboration
- CRDT-based sync: Yjs documents for conflict-free state replication across collaborators
- Domain systems: Building elements (walls, doors, windows, etc.) handled by dedicated systems with clear responsibilities
- Monolithic Zustand stores for editor and viewer state management
- Three-tier permissions: Organization → Team → Project with role-based access

## Layers

**API Layer:**
- Purpose: HTTP endpoints for auth, data persistence, file uploads, project management
- Location: `apps/editor/app/api/`
- Contains: Next.js route handlers (POST/GET/PUT), NextAuth configuration, Prisma queries
- Depends on: Prisma ORM, PostgreSQL database, AWS S3, NextAuth, Redis
- Used by: Frontend client, mobile apps, external integrations

**Real-time Sync Layer:**
- Purpose: Manage Yjs documents and WebSocket connections for collaborative editing
- Location: `apps/editor/server.ts`, `packages/core/src/store/collaboration.ts`
- Contains: Socket.io server, Yjs document management, sync protocol (Step 1/2), awareness events
- Depends on: Socket.io, Yjs, Redis adapter (for multi-instance deployments)
- Used by: Editor clients connecting for collaborative sessions

**Core Domain Layer:**
- Purpose: Building element systems, spatial queries, scene state management
- Location: `packages/core/src/systems/`, `packages/core/src/store/use-scene.ts`
- Contains: Wall/Door/Window/Roof/Slab systems, spatial grid, material library, schema definitions
- Depends on: Yjs (for collaboration binding), event emitter
- Used by: Editor UI, Viewer components, collision/space detection

**Editor UI Layer:**
- Purpose: 2D floorplan + 3D viewport, tools, command palette, sidebar panels
- Location: `packages/editor/src/components/`, `packages/editor/src/store/use-editor.tsx`
- Contains: React components (Floorplan, EditorLayout, SidebarPanel, CommandPalette), Zustand store
- Depends on: React Three Fiber, Three.js, @pascal-app/core, TailwindCSS, Framer Motion
- Used by: Editor page in Next.js app

**Viewer Layer:**
- Purpose: Read-only 3D visualization, walkthrough controls, material rendering
- Location: `packages/viewer/src/components/viewer`, `packages/viewer/src/store/use-viewer.tsx`
- Contains: Viewer component, SSGI post-processing, interactive systems, first-person controls
- Depends on: React Three Fiber, Three.js, @pascal-app/core
- Used by: Project preview, marketplace asset previews

**Dashboard/Auth Layer:**
- Purpose: User authentication, project listing, team/org management, onboarding
- Location: `apps/editor/app/dashboard/`, `apps/editor/app/login/`, `apps/editor/app/signup/`
- Contains: Page components, Server Actions for DB queries, Auth layouts
- Depends on: NextAuth, Prisma, RBAC utilities
- Used by: Web app entry point

## Data Flow

**Project Creation Flow:**

1. User creates project via Dashboard page (`apps/editor/app/dashboard/projects/page.tsx`)
2. Server Action calls `createProject()` → Prisma creates Project record
3. Project stored with team_id, owner_id, status
4. User redirected to Editor page with `projectId`

**Real-time Editing Flow:**

1. EditorClient connects WebSocket: `getSocket().emit('join-project', projectId)`
2. Server (`server.ts`) receives `join-project` event, creates/retrieves Yjs Doc
3. Server sends state vector (Step 1): `socket.emit('yjs-sync-step-1', stateVector)`
4. Client applies updates to local Zustand store bound to Yjs Doc
5. User modifies scene (e.g., adds wall) → updates Zustand store
6. `bindSceneStoreToYjs()` detects change → writes to Yjs Doc
7. Yjs broadcasts update to Socket.io → other clients in project receive
8. Other clients apply update locally → scene updates in real-time

**Asynchronous Persistence:**

1. Yjs updates are ephemeral (in-memory at server)
2. Editor component `useAutoSave` hook periodically serializes scene state
3. Auto-save sends scene JSON to database (not yet implemented in production flow)
4. On page reload: fetch latest scene from DB → initialize Yjs Doc

**State Management:**

- **Editor State** (`use-editor.tsx`): Active tool, mode, phase, selected nodes, viewport settings
- **Scene State** (`use-scene.ts`): 3D scene graph (nodes, rootNodeIds, collections)
- **Viewer State** (`use-viewer.tsx`): Camera, materials, rendering options
- **Upload State** (`use-upload.ts`): File upload progress, presigned URLs
- All bound to Yjs for multi-client sync (except editor UI state)

## Key Abstractions

**AnyNode System:**
- Purpose: Represents all building elements in a discriminated union
- Examples: `WallNode`, `DoorNode`, `WindowNode`, `RoofNode`, `SlabNode`, `ItemNode`
- Pattern: Zod schema definitions in `packages/core/src/schema/nodes/`, typed as `AnyNode = z.infer<...>`
- Used by: Scene graph, spatial queries, rendering systems

**System Pattern (Wall/Door/Item/etc.):**
- Purpose: Encapsulates logic for a single building element type
- Examples: `WallSystem`, `DoorSystem`, `ItemSystem` in `packages/core/src/systems/`
- Pattern: Class-based systems with methods like `addWall()`, `updateWall()`, `deleteWall()`
- Exports: Exported from `packages/core/src/index.ts` for use in editor/viewer

**Event Bus:**
- Purpose: Decoupled communication between systems and UI
- Location: `packages/core/src/events/bus.ts`
- Pattern: Zustand-like emitter with discriminated union event types (BuildingEvent, WallEvent, etc.)
- Usage: `emitter.on(EventSuffix, handler)`, `emitter.emit(EventSuffix, data)`

**Spatial Grid:**
- Purpose: Efficient collision detection and spatial queries
- Location: `packages/core/src/hooks/spatial-grid/`
- Pattern: Grid-based spatial hashing for wall-to-wall intersection, point-in-polygon tests
- Methods: `pointInPolygon()`, `spatialGridManager.query()`

**Material Library:**
- Purpose: Centralized catalog of materials and presets
- Location: `packages/core/src/material-library.ts`
- Pattern: Zod-validated material definitions, preset system with library material refs
- Exports: `MATERIAL_CATALOG`, `getMaterialsForTarget()`, `toLibraryMaterialRef()`

**Zustand Stores:**
- Pattern: Monolithic stores with all state in one tree (not split by concern)
- Middleware: `persist` for local storage (editor UI preferences)
- Subscriptions: Used to trigger Yjs syncs and side effects

## Entry Points

**Web App:**
- Location: `apps/editor/app/page.tsx`
- Triggers: Direct navigation to domain (landing page)
- Responsibilities: Display landing page, links to signup/login

**Editor Page:**
- Location: `apps/editor/app/editor/[id]/page.tsx`
- Triggers: User navigates to editor after auth + project ownership check
- Responsibilities: Verify user access (RBAC), render EditorClient with projectId

**EditorClient:**
- Location: `apps/editor/app/editor/[id]/EditorClient.tsx`
- Triggers: Rendered when page loads
- Responsibilities: Initialize Zustand stores, connect WebSocket, render Editor component tree

**Server.ts WebSocket Handler:**
- Location: `apps/editor/server.ts`
- Triggers: Node.js server startup (custom Next.js server)
- Responsibilities: Accept WebSocket connections, manage Yjs docs per-project, sync protocol, Redis adapter

**Dashboard Entry:**
- Location: `apps/editor/app/dashboard/page.tsx`
- Triggers: User post-auth
- Responsibilities: Load user orgs/teams/projects, display dashboard layout

## Error Handling

**Strategy:** Mixed approach - try/catch for critical paths, error boundaries for React, console logging for debugging

**Patterns:**

- API routes: `try/catch` → `NextResponse.json({ error: ... }, { status: 400/500 })`
- Server Actions: `throw new Error()` → caught by Next.js error boundary or client-side try/catch
- Yjs sync: `try { Y.applyUpdate(...) } catch (err) { console.error(...) }`
- WebSocket: All handlers wrapped with null checks (e.g., `if (!currentProjectId) return`)
- React components: No error boundaries implemented; relies on Next.js app-level error handling

**Example** (`apps/editor/app/api/auth/signup/route.ts`):
```typescript
try {
  const { email, password, name } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 })
  }
  // ... create user
  return NextResponse.json({ success: true })
} catch (error) {
  console.error("Signup error:", error)
  return NextResponse.json({ error: "Internal error" }, { status: 500 })
}
```

## Cross-Cutting Concerns

**Logging:** Console-based (`console.log()`, `console.error()`)
- WebSocket/Yjs: `console.log('[Yjs]', '[Socket]', '[Socket.io]' prefixes)`
- Prisma: Configured in lib/prisma.ts with query logging in dev mode
- No structured logging library; PostHog tracks client-side analytics

**Validation:** Zod schemas for:
- Building nodes (all in `packages/core/src/schema/`)
- Request bodies via `req.json()` → manually destructured (no middleware validation)
- Environment variables not centrally validated

**Authentication:** NextAuth + custom credentials provider
- JWT strategy with server-side session lookup
- Prisma bcryptjs password hashing
- RBAC layer in `apps/editor/lib/rbac.ts` (OrgRole, ProjectRole → AccessLevel)

**Authorization:** Three-tier hierarchy
- Organization: OWNER/ADMIN/MEMBER
- Team: Members inherit from org or explicit team membership
- Project: OWNER/EDITOR/VIEWER role with org-level fallback for OWNER/ADMIN

**Collaboration:** Yjs + Socket.io
- Yjs docs stored in-memory on server (not persisted to disk/DB)
- Redis adapter enables multi-instance scaling
- Awareness updates for presence (avatar cursors)

---

*Architecture analysis: 2026-04-28*
