# Building Elements Catalog

Organized collection of building elements with specifications and metadata.

## Structure

```
lib/catalog/
├── types.ts                    # Catalog-specific types
├── structure/                  # Structural elements
│   ├── wall.ts                # Wall spec & metadata
│   ├── door.ts                # Door spec & metadata
│   ├── window.ts              # Window spec & metadata
│   ├── column.ts              # Column spec & metadata
│   ├── roof.ts                # Roof spec & metadata
│   └── index.ts               # Export all
├── items/                      # Furniture & objects (future)
│   └── index.ts
├── register.ts                 # Registration functions
└── index.ts                    # Main exports
```

## Element Organization

### Structural Elements (`structure/`)

Core building components:
- **Wall** - Load-bearing and partition walls
- **Door** - Entry doors, interior doors
- **Window** - Standard windows, skylights
- **Column** - Structural columns and pillars
- **Roof** - Pitched roofs, flat roofs

Each structural element includes:
- `spec.ts` - ElementSpec for the ECS engine
- Metadata (tags, description, dimensions)
- Default values and constraints

### Items (`items/`)

Furniture and decorative objects (to be implemented):
- Furniture (chairs, tables, beds)
- Appliances (refrigerator, oven, dishwasher)
- Fixtures (lighting, plumbing)
- Decorations (art, plants)

## Adding New Elements

### 1. Create Element File

```
lib/catalog/structure/stairs.ts
```

### 2. Define Specification and Metadata

```typescript
// stairs.ts
import type { ElementSpec } from '@/lib/engine'

export const StairsSpec: ElementSpec = {
  schemaVersion: '1.0',
  type: 'structure.stairs',
  label: 'Stairs',
  category: 'structure',
  
  node: {
    gridItem: true,
    defaults: {
      size_m: [1.2, 3.0], // width x length
      rotation_rad: 0,
    },
    parentRules: ['level', 'group'],
  },
  
  render: {
    model: {
      url: '/models/Stairs.glb',
      scale: 1,
      upAxis: 'Y',
    },
  },
  
  bounds: { strategy: 'orientedRectFromSize' },
  footprint: { strategy: 'rectFromSize' },
  
  snap: {
    gridStep_m: 0.5,
    allowedAngles_rad: [0, Math.PI / 2],
    targets: ['gridFloor'],
    radius_m: 1.0,
  },
}

export const StairsMetadata = {
  id: 'core.stairs',
  tags: ['circulation', 'vertical', 'access'],
  description: 'Staircase for vertical circulation',
  defaultRise: 0.175, // meters per step
  defaultRun: 0.28,   // meters per step
}
```

### 3. Export from Category

```typescript
// lib/catalog/structure/index.ts
export * from './stairs'
```

### 4. Register in `register.ts`

```typescript
import { StairsSpec } from './structure'

export function registerStructuralElements(): void {
  // ...existing registrations
  registerFromSpec(StairsSpec)
}
```

## Element Specifications

Each element must define:

### Required Fields

- `schemaVersion` - Spec version (currently '1.0')
- `type` - Unique type identifier (e.g., 'structure.wall')
- `label` - Display name
- `node.gridItem` - Whether element has grid positioning
- `node.parentRules` - Allowed parent types

### Optional Fields

- `category` - UI category grouping
- `node.defaults` - Default size, rotation
- `render` - Model URL, color, anchor
- `bounds` - Bounding box strategy
- `footprint` - 2D footprint strategy
- `snap` - Snapping behavior
- `sockets` - Attachment points
- `physics` - Physics properties

## Metadata

Additional element information:

```typescript
export const ElementMetadata = {
  id: 'core.element',           // Catalog ID
  tags: ['tag1', 'tag2'],        // Search tags
  description: 'Description',    // Help text
  // Element-specific defaults
  defaultHeight: 2.7,
  defaultWidth: 1.0,
  // etc.
}
```

## Type System

### Element Types

Format: `{category}.{element}`

**Structural:**
- `structure.wall`
- `structure.door`
- `structure.window`
- `structure.column`
- `structure.roof`

**Items** (future):
- `furniture.chair`
- `furniture.table`
- `appliance.refrigerator`

### Categories

- `structure` - Load-bearing and enclosure
- `items` - Movable objects
- `outdoor` - Landscape elements
- `systems` - MEP systems

## Rendering

Element rendering is handled separately in `components/editor/elements/`.

The catalog only defines:
- What the element is (spec)
- How it behaves (engine integration)
- Default properties (metadata)

The rendering layer handles:
- 3D geometry
- Materials and textures
- User interactions
- Visual feedback

## Integration with Engine

```typescript
// 1. Define spec in catalog
const MyElementSpec: ElementSpec = { /* ... */ }

// 2. Register with engine
registerFromSpec(MyElementSpec)

// 3. Engine creates entities from nodes
const world = buildWorldFromNodes(levels)

// 4. Systems compute derived data
runBoundsSystem(world)
runFootprintSystem(world)

// 5. Rendering uses engine + node data
<MyElementMesh nodeId={id} world={world} />
```

## Best Practices

### DO:
- ✅ Keep specs data-driven and JSON-compatible
- ✅ Use meaningful type identifiers
- ✅ Provide sensible defaults
- ✅ Include comprehensive metadata
- ✅ Test specs with validation

### DON'T:
- ❌ Mix rendering code with specs
- ❌ Hardcode magic numbers
- ❌ Duplicate logic between elements
- ❌ Skip parent rules validation
- ❌ Forget to register new elements

## Remote Catalog (Future)

The catalog structure supports remote elements:

```typescript
// Fetch remote spec
const response = await fetch('/api/catalog/furniture.chair-modern')
const spec = await response.json()

// Validate
if (validateElementSpec(spec)) {
  // Register
  registerFromSpec(spec)
  
  // Now available for placement
  createNode({ type: 'furniture.chair-modern', ... })
}
```

## Examples

See individual element folders for complete examples:
- `structure/wall/` - Simple extruded geometry
- `structure/door/` - GLB model with animation
- `structure/roof/` - Complex parametric geometry

## Resources

- **Engine API:** `lib/engine/README.md`
- **Spec Schema:** `lib/engine/spec.ts`
- **Node Types:** `lib/nodes/types.ts`
- **Examples:** `lib/engine/EXAMPLES.md`

