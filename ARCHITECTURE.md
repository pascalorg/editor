# Building Editor - Architecture Overview

## System Architecture

The building editor uses a hybrid **Node Tree + ECS** architecture:

```
┌─────────────────────────────────────────────────────────┐
│                     User Interface                        │
│  (React Components + Three.js/R3F Rendering)             │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
┌─────────▼─────────┐  ┌───────▼────────┐
│   Node Tree       │  │  ECS Engine    │
│   (Canonical)     │  │  (Runtime)     │
│                   │  │                │
│  - Persistence    │  │  - Bounds      │
│  - Undo/Redo      │  │  - Footprints  │
│  - Validation     │  │  - Snapping    │
│  - Operations     │  │  - Physics     │
└─────────┬─────────┘  └───────▲────────┘
          │                    │
          └────────────────────┘
           builds on mutation
```

## Data Flow

### 1. Node Tree (Source of Truth)

**Location:** `lib/nodes/`

The node tree is the canonical data model. It's:
- Persisted to localStorage and JSON files
- Managed by Zustand store (`hooks/use-editor.tsx`)
- Immutable (operations return new trees)
- Validated for structural integrity
- Indexed for O(1) lookups

**Key Files:**
- `types.ts` - Node type definitions
- `operations.ts` - Pure CRUD operations
- `selectors.ts` - Query helpers
- `guards.ts` - Type guards and validation
- `indexes.ts` - Fast lookup structures
- `utils.ts` - Tree traversal and manipulation
- `extensions.ts` - Dynamic type registry (NEW)

### 2. ECS Engine (Derived Runtime)

**Location:** `lib/engine/`

The ECS layer is built from nodes and provides:
- Component-based data storage
- System-computed behaviors
- Extensible element definitions
- Performance optimizations

**Key Files:**
- `core.ts` - World, entities, components
- `components.ts` - Component type definitions
- `spec.ts` - Element specification schema
- `registry.ts` - Element definition registry
- `spec-registry.ts` - Spec → Definition converter
- `adapters/nodes-to-world.ts` - Node tree → World
- `systems/` - Behavior computation
- `strategies/` - Pure computation functions
- `builtin-specs/` - Built-in element definitions

### 3. State Management

**Location:** `hooks/use-editor.tsx`

Zustand store with:
```typescript
{
  levels: LevelNode[]           // Canonical tree
  nodeIndex: Map<id, node>      // Fast lookup
  indexes?: NodeIndexes         // Optional full indexes
  selectedLevelId: string | null
  controlMode: 'select' | 'delete' | 'building' | 'guide'
  // ... view/camera modes
}
```

**Mutations always:**
1. Use `lib/nodes/operations.ts` functions
2. Return new `levels` array
3. Rebuild `nodeIndex` (and optionally `indexes`)
4. Trigger re-render

**The `useEngineWorld` hook:**
```typescript
const world = useEngineWorld(levels) // Memoized
```

Rebuilds World only when `levels` changes, then runs systems.

## Node Tree Structure

```
levels: LevelNode[]
  ├─ LevelNode (id: "level-0", level: 0)
  │   ├─ WallNode (id: "wall-1")
  │   │   ├─ DoorNode (id: "door-1")
  │   │   └─ WindowNode (id: "window-1")
  │   ├─ ColumnNode (id: "column-1")
  │   ├─ RoofNode (id: "roof-1")
  │   │   └─ RoofSegmentNode (id: "segment-1")
  │   ├─ ReferenceImageNode (id: "ref-1")
  │   └─ GroupNode (id: "group-1")
  │       └─ WallNode (id: "wall-2")
  └─ LevelNode (id: "level-1", level: 1)
      └─ ...
```

**Node Types:**
- `level` - Floor container
- `wall` - Linear wall segment
- `door`, `window` - Wall-mounted openings
- `column` - Vertical support
- `roof`, `roof-segment` - Roof structure
- `reference-image`, `scan` - Reference content
- `group` - Organizational container

**All nodes have:**
- `id` - Unique identifier
- `type` - Type string
- `name` - Display name
- `children` - Child nodes
- `parent?` - Parent ID
- `visible?`, `opacity?`, `locked?` - Display state
- `metadata?` - Custom data

**Grid nodes additionally have:**
- `position: [x, y]` - Grid coordinates
- `rotation` - Radians
- `size: [width, depth]` - Grid units

## ECS World Structure

```
World
  ├─ Entities (Set<EntityId>)
  │   └─ Same IDs as nodes
  │
  └─ Components (Map<ComponentType, ComponentStore>)
      ├─ TransformGrid: Map<EntityId, TransformGrid>
      ├─ Visibility: Map<EntityId, Visibility>
      ├─ ElementTag: Map<EntityId, ElementTag>
      ├─ Hierarchy: Map<EntityId, Hierarchy>
      ├─ Bounds: Map<EntityId, Bounds>
      ├─ Footprint: Map<EntityId, Footprint>
      └─ ...
```

**Entity = Node:** Every node becomes an entity with the same ID.

**Components are computed by:**
1. **Element definitions** during world creation
2. **Systems** after world is built

## Component Lifecycle

```
Node created
    ↓
World.addEntity(node.id)
    ↓
ElementDefinition.create(node) → Components
    ↓
World.setComponent(entityId, type, component)
    ↓
Systems run → Compute derived components
    ↓
Components available for rendering/tools
```

## Element Registration

### Built-in Elements

```typescript
// lib/engine/builtin-specs/wall.ts
export const WallSpec: ElementSpec = {
  type: 'wall',
  node: { gridItem: true, defaults: { size_m: [1, 0.2] } },
  bounds: { strategy: 'orientedRectFromSize' },
  footprint: { strategy: 'rectFromSize' },
  // ...
}

// lib/engine/register-builtins.ts
registerFromSpec(WallSpec)
```

### Custom/Catalog Elements

```typescript
// Define spec
const ChairSpec: ElementSpec = {
  type: 'furniture.chair',
  node: { 
    gridItem: true, 
    parentRules: ['level', 'group'] 
  },
  render: { model: { url: '/models/chair.glb' } },
  // ...
}

// Register
registerFromSpec(ChairSpec)

// Create node
const chairNode: BaseNode = {
  id: generateId(),
  type: 'furniture.chair',
  name: 'Chair',
  // ...
}

// Add to tree
const newLevels = addNodeToParent(levels, levelId, chairNode)
```

## Systems

Systems compute derived component data:

### BoundsSystem
```typescript
runBoundsSystem(world)
// For each entity with TransformGrid + Element:
//   1. Get element definition
//   2. Call definition.computeBounds(entityId, world)
//   3. Store Bounds component
```

### FootprintSystem
```typescript
runFootprintSystem(world)
// For each entity with TransformGrid + Element:
//   1. Get element definition
//   2. Call definition.computeFootprint(entityId, world)
//   3. Store Footprint component
```

### Future Systems
- **SurfacesSystem** - Extract snap surfaces
- **SnapTargetsSystem** - Build spatial index
- **SnapEvalSystem** - Evaluate placement
- **OccupancySystem** - Collision detection
- **PhysicsSystem** - Dynamic simulation

## Rendering

```typescript
function Wall({ nodeId }: { nodeId: string }) {
  const node = useEditor((s) => selectNodeByIdFromIndex(s, nodeId))
  const world = useEngineWorld(levels)
  
  // Option 1: Use node data directly (current)
  const { position, rotation, size } = node
  
  // Option 2: Use engine components (future)
  const transform = world.getComponent<TransformGrid>(nodeId, TRANSFORM_GRID)
  const bounds = world.getComponent<Bounds>(nodeId, BOUNDS)
  
  return (
    <mesh position={worldPosition} rotation={[0, rotation, 0]}>
      <boxGeometry args={[size[0], 2.7, size[1]]} />
      <meshStandardMaterial color="#e0e0e0" />
    </mesh>
  )
}
```

## Grid System

**Grid coordinates → World coordinates:**
- Grid unit = 0.5m (default)
- Grid X → World X
- Grid Y → World Z
- World Y = height (always up)

**Grid positioning:**
- Discrete 61×61 grid points
- Snapping to horizontal/vertical/45° axes
- Interactive tiles for raycasting
- Infinite grid (base floor) vs. proximity grid (upper floors)

## Coordinate Systems

```
Grid Coordinates (integers)
  position: [30, 30] = center of grid
  size: [2, 1] = 2 units wide, 1 unit deep

World Coordinates (meters)
  x: 30 * 0.5 = 15m
  z: 30 * 0.5 = 15m
  width: 2 * 0.5 = 1m
  depth: 1 * 0.5 = 0.5m

Three.js Scene
  position: [-15 + 15, 0, -15 + 15] = [0, 0, 0]
  (parent group offset centers grid at origin)
```

## Operation Flow Examples

### Creating a Wall

```typescript
// 1. User clicks two points on grid
const startPos = [10, 10]
const endPos = [15, 10]

// 2. Calculate wall properties
const length = Math.hypot(endPos[0] - startPos[0], endPos[1] - startPos[1])
const angle = Math.atan2(endPos[1] - startPos[1], endPos[0] - startPos[0])

// 3. Create wall node
const wallNode: WallNode = {
  id: generateId(),
  type: 'wall',
  name: 'Wall',
  position: startPos,
  rotation: angle,
  size: [length, 0.4], // 0.4 grid units = 0.2m
  children: [],
  visible: true,
  opacity: 100,
}

// 4. Add to level (immutable operation)
const newLevels = addWallToLevel(levels, selectedLevelId, wallNode)

// 5. Update store (triggers re-render)
setState({ 
  levels: newLevels,
  nodeIndex: buildNodeIndex(newLevels)
})

// 6. useEngineWorld hook rebuilds World
// 7. Systems compute Bounds and Footprint
// 8. Rendering uses new data
```

### Adding a Door to Wall

```typescript
// 1. User selects wall and door tool
const wallNode = findNodeById(levels, wallId)

// 2. User clicks position on wall (0.0 - 1.0 along length)
const relativePos = 0.5 // Middle of wall

// 3. Calculate door position/rotation
const doorPos = [
  wallNode.position[0] + Math.cos(wallNode.rotation) * wallNode.size[0] * relativePos,
  wallNode.position[1] + Math.sin(wallNode.rotation) * wallNode.size[0] * relativePos,
]

// 4. Create door node
const doorNode: DoorNode = {
  id: generateId(),
  type: 'door',
  name: 'Door',
  position: doorPos,
  rotation: wallNode.rotation,
  size: [2, 0.4], // 1m wide (2 grid units)
  children: [],
  width: 1.0, // Legacy field
}

// 5. Add to wall
const newLevels = addDoorToWall(levels, wallId, doorNode)

// 6. Update store + rebuild World
```

## Parent/Child Rules

**Built-in rules** (`lib/nodes/guards.ts`):
```typescript
function canBeChildOf(child: BaseNode, parent: BaseNode): boolean {
  if (isLevelNode(parent)) return isLevelChildNode(child)
  if (isWallNode(parent)) return isWallChildNode(child) // door/window
  if (isRoofNode(parent)) return isRoofSegmentNode(child)
  if (isGroupNode(parent)) return isBuildingElementNode(child) || isGroupNode(child)
  
  // Fall back to dynamic extensions
  return canTypeBeChildOf(child.type, parent.type)
}
```

**Dynamic rules** (`lib/nodes/extensions.ts`):
```typescript
registerNodeTypeExtension('furniture.chair', {
  canBeChildOf: (parentType) => 
    parentType === 'level' || parentType === 'group'
})
```

## Performance Considerations

### Node Operations
- Use `nodeIndex` for O(1) lookups by ID
- Use `indexes` for O(1) lookups by type/parent (optional, for large scenes)
- Prefer `operations.ts` functions over manual tree manipulation
- Rebuild indexes after each mutation batch

### ECS World
- Memoize World in React hooks
- Run systems only when needed
- Use component queries efficiently
- Consider incremental updates for large scenes

### Rendering
- React.memo on 3D components
- Conditional rendering (only visible levels)
- Instanced meshes for repeated geometry
- LOD for distant/small elements

## File Organization

```
lib/
├── nodes/              # Canonical tree model
│   ├── types.ts
│   ├── operations.ts
│   ├── selectors.ts
│   ├── guards.ts
│   ├── indexes.ts
│   ├── utils.ts
│   ├── extensions.ts   # NEW
│   └── bounds.ts
│
├── engine/             # ECS runtime (NEW)
│   ├── core.ts
│   ├── components.ts
│   ├── spec.ts
│   ├── registry.ts
│   ├── spec-registry.ts
│   ├── init.ts
│   ├── index.ts
│   ├── adapters/
│   │   └── nodes-to-world.ts
│   ├── systems/
│   │   ├── bounds-system.ts
│   │   └── footprint-system.ts
│   ├── strategies/
│   │   ├── bounds.ts
│   │   └── footprint.ts
│   ├── builtin-specs/
│   │   ├── wall.ts
│   │   ├── door.ts
│   │   ├── window.ts
│   │   ├── column.ts
│   │   ├── roof.ts
│   │   └── index.ts
│   └── register-builtins.ts
│
└── migration/          # Legacy compatibility
    ├── legacy-to-nodes.ts
    ├── nodes-to-legacy.ts
    └── validators.ts

hooks/
├── use-editor.tsx      # Zustand store
├── use-engine.ts       # ECS World hook (NEW)
└── use-nodes.ts

components/
├── editor/
│   ├── index.tsx       # Main canvas
│   ├── elements/       # 3D renderers
│   │   ├── wall.tsx
│   │   ├── door.tsx
│   │   └── ...
│   └── ...
└── viewer/
```

## Testing Strategy

### Unit Tests
- Node operations (add/update/delete/move)
- ECS queries and component storage
- Systems (bounds, footprint computation)
- Spec validation
- Coordinate transformations

### Integration Tests
- Node tree → World conversion
- System pipeline
- Element registration
- Parent/child validation

### E2E Tests
- Wall placement → bounds computed → rendered
- Door added to wall → hierarchy maintained
- Import/export with custom elements
- Undo/redo with engine state

## Future Enhancements

### Catalog System
- Remote spec fetching (`GET /catalog/:id/spec`)
- Spec validation and sandboxing
- Parameter customization
- Caching by version

### Advanced Snapping
- Surface-based snapping (floor, wall, ceiling)
- Socket system for attachments
- Priority-based target selection
- Occupancy checking

### Physics Integration
- Static/dynamic distinction
- Gravity and collision
- Constraint solving
- Performance (WASM?)

### Collaborative Editing
- Operational transforms on node operations
- Conflict resolution
- Cursor sharing
- Real-time sync

## Migration Path

The engine is designed for **incremental adoption**:

1. ✅ **Phase 1: Foundation** (Current)
   - Core ECS implemented
   - Built-ins registered as specs
   - World derived from nodes
   - Basic systems (bounds, footprint)

2. **Phase 2: Integration**
   - Rendering switches to engine components
   - Tools use engine queries
   - Camera framing uses bounds
   - Wall mitering migrates to FootprintSystem

3. **Phase 3: Extension**
   - Catalog loader
   - Generic catalog renderer
   - Snapping systems
   - First custom elements

4. **Phase 4: Advanced**
   - Physics stub → real integration
   - Terrain system
   - Advanced surface snapping
   - Performance optimization

## Key Design Decisions

### Why Hybrid Node + ECS?

**Nodes provide:**
- Familiar tree structure
- Easy serialization
- Simple persistence
- Undo/redo via snapshots

**ECS provides:**
- Extensibility (new element types)
- Performance (data-oriented)
- Flexibility (component composition)
- System-based behavior

**Together:** Best of both worlds. Nodes stay simple and persist easily. ECS handles complex runtime behavior.

### Why Specs?

Element specs enable:
- **Declarative definitions** - JSON-friendly, portable
- **Same registration path** - Built-ins and catalog use identical flow
- **No code edits** - Add elements without touching core files
- **Remote loading** - Fetch specs from server
- **Version control** - Specs are versioned and cacheable

### Why Systems?

Systems centralize logic:
- **Separation of concerns** - Bounds, snapping, physics are separate
- **Testability** - Pure functions, easy to test
- **Performance** - Batch processing, cache-friendly
- **Optional** - Only run what you need

---

## Getting Started

### For Developers

1. Read `lib/nodes/README.md` (if exists) or review node types
2. Read `lib/engine/README.md` (this file)
3. Explore built-in specs in `lib/engine/builtin-specs/`
4. Try creating a custom element spec
5. Add a new system

### For Contributors

1. Adding elements? Write a spec and register it
2. Adding behavior? Write a system
3. Extending nodes? Use dynamic extensions
4. New computation? Add a strategy

### Resources

- **Node API:** `lib/nodes/types.ts`, `lib/nodes/operations.ts`
- **Engine API:** `lib/engine/index.ts`
- **Examples:** `lib/engine/builtin-specs/`
- **Tests:** (TBD)

---

Questions? Check the code or ask the team!

