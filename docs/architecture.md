# Repository architecture

An overview of how the Pascal Editor packages fit together. The canonical rules for each
boundary live in [`wiki/architecture/`](../wiki/architecture/README.md); this page is the
orientation tour.

## Layout

This is a Turborepo monorepo with the reusable editor packages, the standalone app,
and the CLI that distributes it:

```
editor/
├── apps/
│   └── editor/          # Next.js application
├── packages/
│   ├── core/            # Schemas, scene state, registry contracts, capture contracts
│   ├── viewer/          # 3D rendering runtime, shared systems, capture runtime
│   ├── editor/          # Editing tools and UI components
│   ├── nodes/           # Built-in node definitions, renderers, and systems
│   ├── cli/             # Persistent local editor installer and process manager
│   ├── mcp/             # Model Context Protocol server and scene storage
│   ├── ifc-converter/   # IFC → Pascal scene graph conversion
│   └── ui/              # Shared UI components
```

## Separation of concerns

| Package | Responsibility |
|---------|---------------|
| **@pascal-app/core** | Node schemas, scene state (Zustand), registry contracts, spatial queries, and event bus. `core/capture` adds versioned capture manifests, normalized streams, and transport-neutral static/live sources |
| **@pascal-app/viewer** | 3D rendering via React Three Fiber, shared render systems, default camera/controls, and post-processing. `viewer/capture` adds the capture runtime and reference model, device-motion, point-cloud, and surface-mesh layers |
| **@pascal-app/editor** | Editing tools, panels, selection, and direct-manipulation UI |
| **@pascal-app/nodes** | Built-in registry plugin with node definitions, renderers, geometry, and systems |
| **@pascal-app/cli** | Installs and manages a versioned standalone editor runtime and persistent local data |
| **@pascal-app/mcp** | Exposes scene tools, resources, prompts, and local storage to MCP-compatible AI hosts |
| **@pascal-app/ifc-converter** | Converts IFC bytes into a Pascal scene graph |
| **apps/editor** | Standalone Next.js host for the editor packages |

The **viewer** renders the scene with sensible defaults. The **editor** extends it with interactive tools, selection management, and editing capabilities.

## Stores

Each package has its own Zustand store for managing state:

| Store | Package | Responsibility |
|-------|---------|----------------|
| `useScene` | `@pascal-app/core` | Scene data: nodes, root IDs, dirty nodes, CRUD operations. Persisted to IndexedDB with undo/redo via Zundo. |
| `useViewer` | `@pascal-app/viewer` | Viewer state: current selection (building/level/zone IDs), level display mode (stacked/exploded/solo), camera mode. |
| `useEditor` | `@pascal-app/editor` | Editor state: active tool, structure layer visibility, panel states, editor-specific preferences. |

**Access patterns:**

```typescript
// Subscribe to state changes (React component)
const nodes = useScene((state) => state.nodes)
const levelId = useViewer((state) => state.selection.levelId)
const activeTool = useEditor((state) => state.tool)

// Access state outside React (callbacks, systems)
const node = useScene.getState().nodes[id]
useViewer.getState().setSelection({ levelId: 'level_123' })
```

## Core concepts

### Nodes

Nodes are the data primitives that describe the 3D scene. All nodes extend `BaseNode`:

```typescript
BaseNode {
  id: string              // Auto-generated with type prefix (e.g., "wall_abc123")
  type: string            // Discriminator for type-safe handling
  parentId: string | null // Parent node reference
  visible: boolean
  camera?: Camera         // Optional saved camera position
  metadata?: JSON         // Arbitrary metadata (e.g., { isTransient: true })
}
```

**Node hierarchy:**

```
Site
└── Building
    └── Level
        ├── Wall → Item (doors, windows)
        ├── Slab
        ├── Ceiling → Item (lights)
        ├── Roof
        ├── Zone
        ├── Scan (3D reference)
        └── Guide (2D reference)
```

Nodes are stored in a **flat dictionary** (`Record<id, Node>`), not a nested tree. Parent-child relationships are defined via `parentId` and `children` arrays. See [node schemas](../wiki/architecture/node-schemas.md) and [node definitions](../wiki/architecture/node-definitions.md).

### Scene state

The scene is managed by a Zustand store in `@pascal-app/core`:

```typescript
useScene.getState() = {
  nodes: Record<id, AnyNode>,  // All nodes
  rootNodeIds: string[],       // Top-level nodes (sites)
  dirtyNodes: Set<string>,     // Nodes pending system updates

  createNode(node, parentId),
  updateNode(id, updates),
  deleteNode(id),
}
```

**Middleware:**
- **Persist** - Saves to IndexedDB (excludes transient nodes)
- **Temporal** (Zundo) - Undo/redo with 50-step history

### Scene registry

The registry maps node IDs to their Three.js objects for fast lookup:

```typescript
sceneRegistry = {
  nodes: Map<id, Object3D>,    // ID → 3D object
  byType: {
    wall: Set<id>,
    item: Set<id>,
    zone: Set<id>,
    // ...
  }
}
```

Renderers register their refs using the `useRegistry` hook:

```tsx
const ref = useRef<Mesh>(null!)
useRegistry(node.id, 'wall', ref)
```

This allows systems to access 3D objects directly without traversing the scene graph. See [scene registry](../wiki/architecture/scene-registry.md).

### Node renderers

Renderers are React components that create Three.js objects for each node type:

```
SceneRenderer
└── NodeRenderer (dispatches by type)
    ├── BuildingRenderer
    ├── LevelRenderer
    ├── WallRenderer
    ├── SlabRenderer
    ├── ZoneRenderer
    ├── ItemRenderer
    └── ...
```

**Pattern:**
1. Renderer creates a placeholder mesh/group
2. Registers it with `useRegistry`
3. Systems update geometry based on node data

See [renderers](../wiki/architecture/renderers.md).

### Systems

Systems are React components that run in the render loop (`useFrame`) to update geometry and transforms. They process **dirty nodes** marked by the store: geometry systems (walls with mitering and CSG cutouts, slabs, ceilings, roofs, item placement) and viewer systems (level visibility and stacking, scan and guide visibility).

```typescript
useFrame(() => {
  for (const id of dirtyNodes) {
    const obj = sceneRegistry.nodes.get(id)
    const node = useScene.getState().nodes[id]

    // Update geometry, transforms, etc.
    updateGeometry(obj, node)

    dirtyNodes.delete(id)
  }
})
```

See [systems](../wiki/architecture/systems.md).

### Dirty nodes

When a node changes, it's marked as **dirty** in `useScene.getState().dirtyNodes`. Systems check this set each frame and only recompute geometry for dirty nodes.

```typescript
// Automatic: createNode, updateNode, deleteNode mark nodes dirty
useScene.getState().updateNode(wallId, { thickness: 0.2 })
// → wallId added to dirtyNodes
// → the wall system regenerates geometry next frame
// → wallId removed from dirtyNodes
```

### Event bus

Inter-component communication uses a typed event emitter (mitt):

```typescript
emitter.on('wall:click', (event) => { ... })
emitter.on('item:enter', (event) => { ... })
emitter.on('grid:click', (event) => { ... })
```

See [events](../wiki/architecture/events.md).

### Spatial queries

Placement validation for tools:

```typescript
spatialGridManager.canPlaceOnFloor(levelId, position, dimensions, rotation)
spatialGridManager.canPlaceOnWall(wallId, t, height, dimensions)
spatialGridManager.getSlabElevationAt(levelId, x, z)
```

See [spatial queries](../wiki/architecture/spatial-queries.md).

## Editor

The editor extends the viewer with tools (select, wall, zone, item, slab, and more), a
hierarchical selection manager (`Site → Building → Level → Zone → Items`), and
editor-specific systems and camera controls. See [tools](../wiki/architecture/tools.md),
[interaction scope](../wiki/architecture/interaction-scope.md), and
[selection managers](../wiki/architecture/selection-managers.md).

## Data flow

```
User Action (click, drag)
       ↓
Tool Handler
       ↓
useScene.createNode() / updateNode()
       ↓
Node added/updated in store
Node marked dirty
       ↓
React re-renders NodeRenderer
useRegistry() registers 3D object
       ↓
System detects dirty node (useFrame)
Updates geometry via sceneRegistry
Clears dirty flag
```

## Technology stack

- **React 19** + **Next.js 16**
- **Three.js** (WebGPU renderer)
- **React Three Fiber** + **Drei**
- **Zustand** (state management)
- **Zod** (schema validation)
- **Zundo** (undo/redo)
- **three-bvh-csg** (Boolean geometry operations)
- **Turborepo** (monorepo management)
- **Bun** (package manager)

## Key files

| Path | Description |
|------|-------------|
| `packages/core/src/schema/` | Node type definitions (Zod schemas) |
| `packages/core/src/store/use-scene.ts` | Scene state store |
| `packages/core/src/hooks/scene-registry/` | 3D object registry |
| `packages/core/src/systems/` | Geometry generation systems |
| `packages/nodes/src/` | Built-in node kinds, one folder per kind |
| `packages/viewer/src/components/renderers/` | Node renderers |
| `packages/viewer/src/components/viewer/` | Main Viewer component |
| `packages/editor/src/components/tools/` | Editor tools |
| `packages/editor/src/store/` | Editor-specific state |
