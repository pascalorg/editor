# @pascal-app/core

Core library for Pascal 3D building editor.

## Installation

```bash
npm install @pascal-app/core
```

## Peer Dependencies

```bash
npm install react three @react-three/fiber @react-three/drei
```

## What's Included

- **Node Schemas** - Zod schemas for all building primitives (walls, slabs, items, etc.)
- **Scene State** - Zustand store with IndexedDB persistence and undo/redo
- **Systems** - Geometry generation for walls, floors, ceilings, roofs
- **Scene Registry** - Fast lookup from node IDs to Three.js objects
- **Spatial Grid** - Collision detection and placement validation
- **Event Bus** - Typed event emitter for inter-component communication
- **Asset Storage** - IndexedDB-based file storage for user-uploaded assets

## Usage

```typescript
import { useScene, WallNode, ItemNode } from '@pascal-app/core'

// Create a wall
const wall = WallNode.parse({
  points: [[0, 0], [5, 0]],
  height: 3,
  thickness: 0.2,
})

useScene.getState().createNode(wall, parentLevelId)

// Subscribe to scene changes
function MyComponent() {
  const nodes = useScene((state) => state.nodes)
  const walls = Object.values(nodes).filter(n => n.type === 'wall')

  return <div>Total walls: {walls.length}</div>
}
```

## Node Types

- `SiteNode` - Root container
- `BuildingNode` - Building within a site
- `LevelNode` - Floor level
- `WallNode` - Vertical wall with optional openings
- `SlabNode` - Floor slab
- `CeilingNode` - Ceiling surface
- `RoofNode` - Roof geometry
- `ZoneNode` - Spatial zone/room
- `ItemNode` - Furniture, fixtures, appliances
- `ScanNode` - 3D scan reference
- `GuideNode` - 2D guide image reference

## Systems

Systems process dirty nodes each frame to update geometry:

- `WallSystem` - Wall geometry with mitering and CSG cutouts
- `SlabSystem` - Floor polygon generation
- `CeilingSystem` - Ceiling geometry
- `RoofSystem` - Roof generation
- `ItemSystem` - Item positioning on walls/ceilings/floors

## License

MIT
