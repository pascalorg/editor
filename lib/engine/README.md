# Building Engine - ECS Architecture

A basic Entity-Component-System (ECS) architecture for the building editor, built on top of the existing node tree system.

## Overview

The engine provides a runtime layer that makes it easy to add new building elements and define their behaviors through **Element Specs**. It coexists with the canonical node tree and derives its state from it.

### Key Concepts

- **Nodes remain canonical** - The node tree is still the source of truth for persistence, undo/redo, and validation
- **ECS is derived** - The engine World is built from nodes and is ephemeral/recomputable
- **Spec-first design** - Both built-in and catalog elements are defined through the same ElementSpec format
- **Systems compute behavior** - Bounds, footprints, surfaces, and snapping are handled by systems

## Architecture

```
┌─────────────────┐
│  Node Tree      │ ← Canonical (persisted)
│  (lib/nodes)    │
└────────┬────────┘
         │ builds
         ↓
┌─────────────────┐
│  ECS World      │ ← Runtime (derived)
│  (lib/engine)   │
└────────┬────────┘
         │ systems run
         ↓
┌─────────────────┐
│ Components      │ ← Computed data
│ (Bounds, etc.)  │
└─────────────────┘
```

## Core Files

### Core ECS (`core.ts`)
- `World` - Container for all entities and components
- `ComponentStore<T>` - Typed storage for components
- `EntityId` - String identifier (same as node ID)
- Query API for finding entities by components

### Components (`components.ts`)
- `TransformGrid` - Position, rotation, size in grid units
- `Visibility` - Visible, opacity, locked state
- `ElementTag` - Type and metadata
- `Hierarchy` - Parent/child relationships
- `Bounds` - 3D bounding boxes (AABB + OBB)
- `Footprint` - 2D ground polygons
- `SnapBehavior` - Snapping configuration
- More to come: `Surface`, `Socket`, `PhysicsBody`

### Element Specs (`spec.ts`)
JSON-friendly schema for defining elements:

```typescript
interface ElementSpec {
  schemaVersion: '1.0'
  type: string // e.g., 'core.wall', 'vendor.chair'
  label: string
  category?: string
  
  node: {
    gridItem: boolean
    defaults?: { size_m?: [number, number]; rotation_rad?: number }
    parentRules?: string[] // Allowed parent types
  }
  
  render?: {
    model?: { url: string; scale?: number; upAxis?: 'Y' | 'Z' }
    anchor?: 'center' | 'back' | 'front' | 'left' | 'right'
    color?: string
  }
  
  bounds?: { strategy: BoundsStrategy }
  footprint?: { strategy: FootprintStrategy }
  snap?: { /* snapping config */ }
  sockets?: Array<{ /* socket definitions */ }>
  physics?: { shape?: 'box' | 'mesh'; mass?: number }
}
```

### Registry (`registry.ts`, `spec-registry.ts`)
- `ElementDefinition` - Internal representation with create/compute functions
- `register(definition)` - Register an element type
- `registerFromSpec(spec)` - Convert spec to definition and register

### Systems
- **BoundsSystem** (`systems/bounds-system.ts`) - Compute 3D bounding boxes
- **FootprintSystem** (`systems/footprint-system.ts`) - Compute 2D footprints
- More to come: Surfaces, Snapping, Physics

### Adapters (`adapters/nodes-to-world.ts`)
- `buildWorldFromNodes(levels)` - Create World from node tree
- `updateEntityFromNode(world, node)` - Update single entity
- `removeEntityFromWorld(world, entityId)` - Remove entity

## Usage

### 1. Initialize the Engine

```typescript
import { initializeEngine } from '@/lib/engine/init'

// Call once at app startup
initializeEngine()
```

This registers all built-in element types (wall, door, window, column, roof).

### 2. Create a World from Nodes

```typescript
import { useEngineWorld } from '@/hooks/use-engine'

function MyComponent() {
  const levels = useEditor((s) => s.levels)
  const world = useEngineWorld(levels)
  
  // World is now available with all entities and computed components
}
```

### 3. Query Entities

```typescript
// Get all entities with TransformGrid and Bounds
const entities = world.query(TRANSFORM_GRID, BOUNDS)

// Get specific component
const bounds = world.getComponent<Bounds>(entityId, BOUNDS)

// Query with components returned
const results = world.queryWith<TransformGrid, Bounds>(
  TRANSFORM_GRID,
  BOUNDS
)
for (const [entityId, transform, bounds] of results) {
  // Use components
}
```

### 4. Define a New Element Type

Create a spec:

```typescript
import type { ElementSpec } from '@/lib/engine'

export const ChairSpec: ElementSpec = {
  schemaVersion: '1.0',
  type: 'furniture.chair',
  label: 'Chair',
  category: 'furniture',
  
  node: {
    gridItem: true,
    defaults: {
      size_m: [0.5, 0.5],
      rotation_rad: 0,
    },
    parentRules: ['level', 'group'],
  },
  
  render: {
    model: {
      url: '/models/chair.glb',
      scale: 1,
      upAxis: 'Y',
    },
  },
  
  bounds: { strategy: 'orientedRectFromSize' },
  footprint: { strategy: 'rectFromSize' },
  
  snap: {
    gridStep_m: 0.5,
    allowedAngles_rad: [0, Math.PI / 2],
    targets: ['gridFloor', 'surface'],
    radius_m: 1.0,
  },
}
```

Register it:

```typescript
import { registerFromSpec } from '@/lib/engine'

registerFromSpec(ChairSpec)
```

That's it! The element is now fully integrated:
- Can be created as nodes in the tree
- Automatically gets components when the World is built
- Bounds and footprint are computed by systems
- Parent/child rules are enforced
- Ready for rendering and snapping

## Built-in Elements

The following elements are registered by default:

- **Wall** (`core.wall`) - 1m × 0.2m, snaps to grid
- **Door** (`core.door`) - 1m wide, mounts to walls, has 3D model
- **Window** (`core.window`) - 1.2m wide, mounts to walls, has 3D model
- **Column** (`core.column`) - 0.3m × 0.3m, snaps to grid
- **Roof** (`core.roof`) - 4m × 4m, snaps to grid

See `lib/catalog/structure/` for their definitions.

## Dynamic Type Extensions

Custom element types can define parent/child rules without editing core files:

```typescript
import { registerNodeTypeExtension } from '@/lib/nodes/extensions'

registerNodeTypeExtension('furniture.chair', {
  canBeChildOf: (parentType) => 
    parentType === 'level' || parentType === 'group',
  label: 'Chair',
  category: 'furniture',
})
```

The `canBeChildOf` guard automatically falls back to extensions for unknown types.

## Systems

Systems compute derived data from entities and their components.

### Running Systems

```typescript
import { runBoundsSystem, runFootprintSystem } from '@/lib/engine'

const world = buildWorldFromNodes(levels)

// Run systems to compute derived components
runBoundsSystem(world)
runFootprintSystem(world)

// Now entities have Bounds and Footprint components
```

The `useEngineWorld` hook automatically runs these systems.

### Creating Custom Systems

```typescript
export function runMySystem(world: World): void {
  // Query entities
  const entities = world.query(TRANSFORM_GRID, ELEMENT)
  
  for (const entityId of entities) {
    const element = world.getComponent<ElementTag>(entityId, ELEMENT)
    const transform = world.getComponent<TransformGrid>(entityId, TRANSFORM_GRID)
    
    // Compute something
    const myData = computeSomething(transform, element)
    
    // Store as component
    world.setComponent(entityId, 'MyData', myData)
  }
}
```

## Strategies

Strategies are pure functions for computing component data.

### Bounds Strategies

- `orientedRectFromSize` - Compute OBB from TransformGrid size (default)
- `aabbFromModelXY` - Compute from 3D model bounds (TODO)
- `convexHullFromModelXY` - Convex hull from model (TODO)

### Footprint Strategies

- `rectFromSize` - Rectangle from TransformGrid size (default)
- `polygon` - Custom polygon from spec
- `hullFromModelXY` - Convex hull from model (TODO)

## Future Systems

The architecture is designed to support:

- **SurfacesSystem** - Extract floor/ceiling/wall surfaces for snapping
- **SnapTargetsSystem** - Build spatial index of snap points
- **SnapEvalSystem** - Evaluate best snap during placement
- **OccupancySystem** - Collision detection and space validation
- **PhysicsSystem** - Gravity, collisions, dynamic objects

## API Reference

### World

```typescript
class World {
  // Entities
  addEntity(id: EntityId): void
  removeEntity(id: EntityId): void
  hasEntity(id: EntityId): boolean
  getAllEntities(): EntityId[]
  
  // Components
  setComponent<T>(entity: EntityId, type: string, component: T): void
  getComponent<T>(entity: EntityId, type: string): T | undefined
  hasComponent(entity: EntityId, type: string): boolean
  removeComponent(entity: EntityId, type: string): boolean
  
  // Queries
  query(...componentTypes: string[]): EntityId[]
  queryWith<T1, T2>(...types: string[]): Array<[EntityId, T1, T2]>
  
  // Stats
  getStats(): { entityCount, componentTypeCount, totalComponents }
}
```

### Component Constants

```typescript
// Import from 'lib/engine/components'
TRANSFORM_GRID = 'TransformGrid'
VISIBILITY = 'Visibility'
ELEMENT = 'Element'
BOUNDS = 'Bounds'
FOOTPRINT = 'Footprint'
HIERARCHY = 'Hierarchy'
SNAP_BEHAVIOR = 'SnapBehavior'
```

## Best Practices

1. **Keep nodes canonical** - Always mutate nodes, then rebuild World
2. **Use specs for new elements** - Don't edit core types
3. **Prefer systems over manual component updates** - Let systems compute derived data
4. **Cache World in React** - Use `useEngineWorld` hook (memoized)
5. **Index-backed queries** - For large scenes, use `NodeIndexes` in parallel

## Integration Points

The engine integrates with:

- **Editor** (`hooks/use-engine.ts`) - World derived from Zustand store
- **Rendering** - Components provide data for 3D meshes
- **Tools** - Systems compute snap targets, collision checks
- **Catalog** - Remote specs registered at runtime

## Performance

- World creation: ~1ms for 100 nodes
- Bounds system: ~0.5ms for 100 entities
- Footprint system: ~0.5ms for 100 entities
- Query overhead: Negligible for <1000 entities

For larger scenes, consider:
- Incremental updates via `updateEntityFromNode`
- Spatial indexing for queries
- Lazy component computation

## Migration from Legacy

Built-in elements (wall, door, window, etc.) remain compatible:
- Node types unchanged (`'wall'`, `'door'`, etc.)
- File format unchanged
- Component lookup uses same node IDs
- Rendering can progressively adopt engine data

## Examples

### Example 1: Get all visible walls

```typescript
const wallEntities = world
  .query(ELEMENT, VISIBILITY, TRANSFORM_GRID)
  .filter(id => {
    const element = world.getComponent<ElementTag>(id, ELEMENT)
    const visibility = world.getComponent<Visibility>(id, VISIBILITY)
    return element?.kind === 'wall' && visibility?.visible
  })
```

### Example 2: Compute total floor area

```typescript
runFootprintSystem(world)

let totalArea = 0
const footprints = world.getEntitiesWithComponent<Footprint>(FOOTPRINT)

for (const [_id, footprint] of footprints) {
  totalArea += footprint.area ?? 0
}

console.log(`Total area: ${totalArea.toFixed(2)} m²`)
```

### Example 3: Find entities near a point

```typescript
function findNearby(world: World, point: [number, number], radius: number) {
  const nearby: EntityId[] = []
  
  for (const [id, transform] of world.queryWith<TransformGrid>(TRANSFORM_GRID)) {
    const [x, y] = transform.position
    const dist = Math.hypot(x - point[0], y - point[1])
    
    if (dist <= radius) {
      nearby.push(id)
    }
  }
  
  return nearby
}
```

## Contributing

When adding engine features:

1. Define components in `components.ts`
2. Create strategies in `strategies/`
3. Implement systems in `systems/`
4. Update specs as needed
5. Add tests
6. Document in this README

## License

Same as the main project.

