# Pascal Editor

A 3D building editor built with React Three Fiber and WebGPU.

## Repository Architecture

This is a Turborepo monorepo with three main packages:

```
editor-v2/
├── apps/
│   └── editor/          # Next.js application (this package)
├── packages/
│   ├── core/            # Schema definitions, state management, systems
│   └── viewer/          # 3D rendering components
```

### Separation of Concerns

| Package | Responsibility |
|---------|---------------|
| **@pascal-app/core** | Node schemas, scene state (Zustand), systems (geometry generation), spatial queries, event bus |
| **@pascal-app/viewer** | 3D rendering via React Three Fiber, default camera/controls, post-processing |
| **apps/editor** | UI components, tools, custom behaviors, editor-specific systems |

The **viewer** renders the scene with sensible defaults. The **editor** extends it with interactive tools, selection management, and editing capabilities.

### Stores

Each package has its own Zustand store for managing state:

| Store | Package | Responsibility |
|-------|---------|----------------|
| `useScene` | `@pascal-app/core` | Scene data: nodes, root IDs, dirty nodes, CRUD operations. Persisted to IndexedDB with undo/redo via Zundo. |
| `useViewer` | `@pascal-app/viewer` | Viewer state: current selection (building/level/zone IDs), level display mode (stacked/exploded/solo), camera mode. |
| `useEditor` | `apps/editor` | Editor state: active tool, structure layer visibility, panel states, editor-specific preferences. |

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

---

## Core Concepts

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

**Node Hierarchy:**

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

Nodes are stored in a **flat dictionary** (`Record<id, Node>`), not a nested tree. Parent-child relationships are defined via `parentId` and `children` arrays.

---

### Scene State (Zustand Store)

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

---

### Scene Registry

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

This allows systems to access 3D objects directly without traversing the scene graph.

---

### Node Renderers

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

Example (simplified):
```tsx
const WallRenderer = ({ node }) => {
  const ref = useRef<Mesh>(null!)
  useRegistry(node.id, 'wall', ref)

  return (
    <mesh ref={ref}>
      <boxGeometry args={[0, 0, 0]} />  {/* Replaced by WallSystem */}
      <meshStandardMaterial />
      {node.children.map(id => <NodeRenderer key={id} nodeId={id} />)}
    </mesh>
  )
}
```

---

### Systems

Systems are React components that run in the render loop (`useFrame`) to update geometry and transforms. They process **dirty nodes** marked by the store.

**Core Systems (in `@pascal-app/core`):**

| System | Responsibility |
|--------|---------------|
| `WallSystem` | Generates wall geometry with mitering and CSG cutouts for doors/windows |
| `SlabSystem` | Generates floor geometry from polygons |
| `CeilingSystem` | Generates ceiling geometry |
| `RoofSystem` | Generates roof geometry |
| `ItemSystem` | Positions items on walls, ceilings, or floors (slab elevation) |

**Viewer Systems (in `@pascal-app/viewer`):**

| System | Responsibility |
|--------|---------------|
| `LevelSystem` | Handles level visibility and vertical positioning (stacked/exploded/solo modes) |
| `ScanSystem` | Controls 3D scan visibility |
| `GuideSystem` | Controls guide image visibility |

**Processing Pattern:**
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

---

### Dirty Nodes

When a node changes, it's marked as **dirty** in `useScene.getState().dirtyNodes`. Systems check this set each frame and only recompute geometry for dirty nodes.

```typescript
// Automatic: createNode, updateNode, deleteNode mark nodes dirty
useScene.getState().updateNode(wallId, { thickness: 0.2 })
// → wallId added to dirtyNodes
// → WallSystem regenerates geometry next frame
// → wallId removed from dirtyNodes
```

**Manual marking:**
```typescript
useScene.getState().dirtyNodes.add(wallId)
```

---

### Event Bus

Inter-component communication uses a typed event emitter (mitt):

```typescript
// Node events
emitter.on('wall:click', (event) => { ... })
emitter.on('item:enter', (event) => { ... })
emitter.on('zone:context-menu', (event) => { ... })

// Grid events (background)
emitter.on('grid:click', (event) => { ... })

// Event payload
NodeEvent {
  node: AnyNode
  position: [x, y, z]
  localPosition: [x, y, z]
  normal?: [x, y, z]
  stopPropagation: () => void
}
```

---

### Spatial Grid Manager

Handles collision detection and placement validation:

```typescript
spatialGridManager.canPlaceOnFloor(levelId, position, dimensions, rotation)
spatialGridManager.canPlaceOnWall(wallId, t, height, dimensions)
spatialGridManager.getSlabElevationAt(levelId, x, z)
```

Used by item placement tools to validate positions and calculate slab elevations.

---

## Editor Architecture

The editor extends the viewer with:

### Tools

Tools are activated via the toolbar and handle user input for specific operations:

- **SelectTool** - Selection and manipulation
- **WallTool** - Draw walls
- **ZoneTool** - Create zones
- **ItemTool** - Place furniture/fixtures
- **SlabTool** - Create floor slabs

### Selection Manager

The editor uses a custom selection manager with hierarchical navigation:

```
Site → Building → Level → Zone → Items
```

Each depth level has its own selection strategy for hover/click behavior.

### Editor-Specific Systems

- `ZoneSystem` - Controls zone visibility based on level mode
- Custom camera controls with node focusing

---

## Data Flow

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

---

## Technology Stack

- **React 19** + **Next.js 15**
- **Three.js** (WebGPU renderer)
- **React Three Fiber** + **Drei**
- **Zustand** (state management)
- **Zod** (schema validation)
- **Zundo** (undo/redo)
- **three-bvh-csg** (Boolean geometry operations)

---

## Getting Started

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Open http://localhost:3000
```

---

## Key Files

| Path | Description |
|------|-------------|
| `packages/core/src/schema/` | Node type definitions (Zod schemas) |
| `packages/core/src/hooks/use-scene.ts` | Scene state store |
| `packages/core/src/hooks/scene-registry/` | 3D object registry |
| `packages/core/src/systems/` | Geometry generation systems |
| `packages/viewer/src/components/renderers/` | Node renderers |
| `packages/viewer/src/components/viewer/` | Main Viewer component |
| `apps/editor/components/tools/` | Editor tools |
| `apps/editor/store/` | Editor-specific state |
