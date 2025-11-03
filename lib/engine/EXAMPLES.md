# Engine Examples

Practical examples for using the ECS engine.

## Example 1: Initialize Engine

```typescript
// app/layout.tsx or main entry point
import { initializeEngine } from '@/lib/engine/init'

// Call once at app startup
initializeEngine()
```

## Example 2: Use Engine in Components

```typescript
import { useEngineWorld } from '@/hooks/use-engine'
import { BOUNDS, TRANSFORM_GRID } from '@/lib/engine'
import type { Bounds, TransformGrid } from '@/lib/engine'

function BuildingStats() {
  const levels = useEditor((s) => s.levels)
  const world = useEngineWorld(levels)
  
  // Query all entities with bounds
  const entitiesWithBounds = world.query(TRANSFORM_GRID, BOUNDS)
  
  // Calculate total volume
  let totalVolume = 0
  for (const entityId of entitiesWithBounds) {
    const bounds = world.getComponent<Bounds>(entityId, BOUNDS)
    if (bounds) {
      const { min, max } = bounds.aabb
      const volume = 
        (max[0] - min[0]) * 
        (max[1] - min[1]) * 
        (max[2] - min[2])
      totalVolume += volume
    }
  }
  
  return (
    <div>
      <p>Entities: {world.getStats().entityCount}</p>
      <p>Components: {world.getStats().totalComponents}</p>
      <p>Volume: {totalVolume.toFixed(2)} m³</p>
    </div>
  )
}
```

## Example 3: Define Custom Element

```typescript
// lib/custom-elements/chair.ts
import type { ElementSpec } from '@/lib/engine'

export const ChairSpec: ElementSpec = {
  schemaVersion: '1.0',
  type: 'furniture.chair',
  label: 'Chair',
  category: 'furniture',
  
  node: {
    gridItem: true,
    defaults: {
      size_m: [0.5, 0.5], // 50cm x 50cm
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
    anchor: 'center',
  },
  
  bounds: {
    strategy: 'orientedRectFromSize',
  },
  
  footprint: {
    strategy: 'rectFromSize',
  },
  
  snap: {
    gridStep_m: 0.5,
    allowedAngles_rad: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
    targets: ['gridFloor', 'surface'],
    radius_m: 1.0,
    priority: ['surface', 'gridPoint'],
  },
  
  sockets: [
    {
      type: 'surface.top',
      localPose: {
        position_m: [0, 0.45, 0], // 45cm high
        rotationY_rad: 0,
      },
      capacity: 1, // One item can be placed on chair
    },
  ],
}
```

```typescript
// Register the chair
import { registerFromSpec } from '@/lib/engine'
import { ChairSpec } from './custom-elements/chair'

registerFromSpec(ChairSpec)
```

## Example 4: Create Node from Spec

```typescript
import { generateId } from '@/lib/utils'
import { addNodeToParent } from '@/lib/nodes/operations'
import type { BaseNode } from '@/lib/nodes/types'

function addChairToLevel(levels: LevelNode[], levelId: string, position: [number, number]) {
  // Create chair node
  const chairNode: BaseNode = {
    id: generateId(),
    type: 'furniture.chair',
    name: 'Chair',
    position,
    rotation: 0,
    size: [1, 1], // Grid units (will be converted by engine)
    children: [],
    visible: true,
    opacity: 100,
  }
  
  // Add to level
  return addNodeToParent(levels, levelId, chairNode)
}
```

## Example 5: Custom System

```typescript
// lib/engine/systems/collision-system.ts
import type { World } from '../core'
import { BOUNDS, TRANSFORM_GRID } from '../components'
import type { Bounds } from '../components'
import { aabbIntersects } from '../strategies/bounds'

export function runCollisionSystem(world: World): Set<[string, string]> {
  const collisions = new Set<[string, string]>()
  
  // Get all entities with bounds
  const entities = world.query(TRANSFORM_GRID, BOUNDS)
  
  // Check all pairs
  for (let i = 0; i < entities.length; i++) {
    const id1 = entities[i]
    const bounds1 = world.getComponent<Bounds>(id1, BOUNDS)
    if (!bounds1) continue
    
    for (let j = i + 1; j < entities.length; j++) {
      const id2 = entities[j]
      const bounds2 = world.getComponent<Bounds>(id2, BOUNDS)
      if (!bounds2) continue
      
      // Check intersection
      if (aabbIntersects(bounds1.aabb, bounds2.aabb)) {
        collisions.add([id1, id2])
      }
    }
  }
  
  return collisions
}
```

```typescript
// Usage
const world = useEngineWorld(levels)
const collisions = runCollisionSystem(world)

console.log(`Found ${collisions.size} collisions`)
```

## Example 6: Query Specific Elements

```typescript
import { ELEMENT } from '@/lib/engine'
import type { ElementTag } from '@/lib/engine'

function findAllWalls(world: World): string[] {
  const walls: string[] = []
  
  const entities = world.query(ELEMENT)
  for (const entityId of entities) {
    const element = world.getComponent<ElementTag>(entityId, ELEMENT)
    if (element?.kind === 'wall') {
      walls.push(entityId)
    }
  }
  
  return walls
}
```

## Example 7: Compute Floor Area

```typescript
import { FOOTPRINT, ELEMENT } from '@/lib/engine'
import type { Footprint, ElementTag } from '@/lib/engine'
import { runFootprintSystem } from '@/lib/engine'

function computeFloorArea(world: World, levelId: string): number {
  // Ensure footprints are computed
  runFootprintSystem(world)
  
  let totalArea = 0
  
  // Get all entities in this level
  const entities = world.query(FOOTPRINT, ELEMENT)
  
  for (const entityId of entities) {
    const element = world.getComponent<ElementTag>(entityId, ELEMENT)
    const footprint = world.getComponent<Footprint>(entityId, FOOTPRINT)
    
    // Only count walls and columns for this level
    if (element?.kind === 'wall' || element?.kind === 'column') {
      // Check if entity belongs to this level (simplified)
      if (footprint?.area) {
        totalArea += footprint.area
      }
    }
  }
  
  return totalArea
}
```

## Example 8: Camera Framing with Bounds

```typescript
import { BOUNDS } from '@/lib/engine'
import type { Bounds } from '@/lib/engine'
import { runBoundsSystem } from '@/lib/engine'
import * as THREE from 'three'

function frameAllElements(
  world: World,
  camera: THREE.Camera,
  controls: any
): void {
  // Ensure bounds are computed
  runBoundsSystem(world)
  
  // Collect all bounds
  const entities = world.query(BOUNDS)
  const allBounds: Bounds['aabb'][] = []
  
  for (const entityId of entities) {
    const bounds = world.getComponent<Bounds>(entityId, BOUNDS)
    if (bounds) {
      allBounds.push(bounds.aabb)
    }
  }
  
  if (allBounds.length === 0) return
  
  // Compute combined AABB
  const min = [
    Math.min(...allBounds.map(b => b.min[0])),
    Math.min(...allBounds.map(b => b.min[1])),
    Math.min(...allBounds.map(b => b.min[2])),
  ]
  
  const max = [
    Math.max(...allBounds.map(b => b.max[0])),
    Math.max(...allBounds.map(b => b.max[1])),
    Math.max(...allBounds.map(b => b.max[2])),
  ]
  
  // Calculate center and size
  const center = new THREE.Vector3(
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2
  )
  
  const size = new THREE.Vector3(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2]
  )
  
  // Position camera to see everything
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = (camera as THREE.PerspectiveCamera).fov
  const distance = maxDim / (2 * Math.tan((fov * Math.PI) / 360))
  
  camera.position.copy(center)
  camera.position.y += distance
  camera.position.z += distance
  
  if (controls) {
    controls.target.copy(center)
    controls.update()
  }
}
```

## Example 9: Load Catalog Item

```typescript
// lib/engine/runtime-catalog.ts
import { registerFromSpec } from './spec-registry'
import type { ElementSpec } from './spec'
import { validateElementSpec } from './spec'

export async function loadCatalogItem(itemId: string): Promise<void> {
  // Fetch spec from server
  const response = await fetch(`/api/catalog/${itemId}/spec`)
  const spec = await response.json()
  
  // Validate spec
  if (!validateElementSpec(spec)) {
    throw new Error(`Invalid spec for item ${itemId}`)
  }
  
  // Register
  registerFromSpec(spec)
  
  console.log(`Loaded catalog item: ${spec.type}`)
}
```

```typescript
// Usage
await loadCatalogItem('chair-modern-001')

// Now you can create nodes of this type
const chairNode = {
  type: 'chair-modern-001',
  // ...
}
```

## Example 10: Performance Monitoring

```typescript
import { useEngineWorld, useEngineStats } from '@/hooks/use-engine'

function PerformanceMonitor() {
  const levels = useEditor((s) => s.levels)
  const world = useEngineWorld(levels)
  const stats = useEngineStats(world)
  
  return (
    <div style={{ position: 'fixed', top: 10, right: 10, background: 'rgba(0,0,0,0.8)', color: 'white', padding: 10 }}>
      <div>Entities: {stats.entityCount}</div>
      <div>Component Types: {stats.componentTypeCount}</div>
      <div>Total Components: {stats.totalComponents}</div>
      <div>Avg Components/Entity: {(stats.totalComponents / stats.entityCount).toFixed(1)}</div>
    </div>
  )
}
```

## Example 11: Incremental Updates

```typescript
import { updateEntityFromNode } from '@/lib/engine/adapters/nodes-to-world'

// When a single node changes (optimization for large scenes)
function handleNodeUpdate(world: World, updatedNode: BaseNode): void {
  // Update entity in place
  updateEntityFromNode(world, updatedNode)
  
  // Recompute affected components
  runBoundsSystem(world) // Or just for this entity
  runFootprintSystem(world)
}
```

## Example 12: Advanced Queries

```typescript
import { TRANSFORM_GRID, VISIBILITY, ELEMENT } from '@/lib/engine'
import type { TransformGrid, Visibility, ElementTag } from '@/lib/engine'

// Find all visible walls within a radius
function findNearbyVisibleWalls(
  world: World,
  center: [number, number],
  radius: number
): string[] {
  const results: string[] = []
  
  // Use queryWith for type-safe access
  const entities = world.queryWith<TransformGrid, Visibility, ElementTag>(
    TRANSFORM_GRID,
    VISIBILITY,
    ELEMENT
  )
  
  for (const [entityId, transform, visibility, element] of entities) {
    // Check if wall
    if (element.kind !== 'wall') continue
    
    // Check if visible
    if (!visibility.visible) continue
    
    // Check distance
    const [x, y] = transform.position
    const dist = Math.hypot(x - center[0], y - center[1])
    if (dist <= radius) {
      results.push(entityId)
    }
  }
  
  return results
}
```

## Tips

1. **Initialize early** - Call `initializeEngine()` in your app's entry point
2. **Memoize World** - Use `useEngineWorld` hook, don't create World manually in render
3. **Run systems once** - Systems are automatically run by `useEngineWorld`
4. **Query efficiently** - Store query results if used multiple times in same render
5. **Type your components** - Use TypeScript generics: `world.getComponent<Bounds>(...)`
6. **Batch operations** - Update multiple nodes, then rebuild World once
7. **Check component existence** - Components may be undefined if not computed
8. **Use indexes** - For large scenes, maintain `NodeIndexes` alongside World

## Common Patterns

### Pattern: Get all X of type Y
```typescript
const walls = world.query(ELEMENT)
  .filter(id => world.getComponent<ElementTag>(id, ELEMENT)?.kind === 'wall')
```

### Pattern: Transform data for rendering
```typescript
const renderData = world.queryWith<TransformGrid, Visibility>(TRANSFORM_GRID, VISIBILITY)
  .filter(([_, __, visibility]) => visibility.visible)
  .map(([id, transform, visibility]) => ({
    id,
    position: transform.position,
    rotation: transform.rotation,
    opacity: visibility.opacity / 100,
  }))
```

### Pattern: Aggregate statistics
```typescript
const stats = world.queryWith<Footprint>(FOOTPRINT)
  .reduce((acc, [_, footprint]) => acc + (footprint.area ?? 0), 0)
```

## Next Steps

- See `lib/engine/README.md` for full API documentation
- See `ARCHITECTURE.md` for system design
- See `lib/engine/builtin-specs/` for more spec examples
- See `lib/catalog/structure/` for element examples
- Try creating your own custom element!

