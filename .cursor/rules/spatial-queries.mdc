---
description: Placement validation for tools — canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling
globs: apps/editor/components/tools/**
alwaysApply: false
---

# Spatial Queries

`useSpatialQuery()` validates whether an item can be placed at a given position without overlapping existing items. Every placement tool must call it before committing a node to the scene.

**Source**: @packages/core/src/hooks/spatial-grid/use-spatial-query.ts

## Hook

```ts
const { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling } = useSpatialQuery()
```

All three methods return `{ valid: boolean; conflictIds: string[] }`.
`canPlaceOnWall` additionally returns `adjustedY: number` (snapped height).

---

## canPlaceOnFloor

```ts
canPlaceOnFloor(
  levelId: string,
  position: [number, number, number],
  dimensions: [number, number, number],   // scaled width/height/depth
  rotation: [number, number, number],
  ignoreIds?: string[],                   // pass [draftItem.id] to exclude self
): { valid: boolean; conflictIds: string[] }
```

**Usage in a tool:**
```ts
const pos: [number, number, number] = [x, 0, z]
const { valid } = canPlaceOnFloor(levelId, pos, getScaledDimensions(item), item.rotation, [item.id])
if (valid) createNode(item, levelId)
```

---

## canPlaceOnWall

```ts
canPlaceOnWall(
  levelId: string,
  wallId: string,
  localX: number,          // distance along wall from start
  localY: number,          // height from floor
  dimensions: [number, number, number],
  attachType: 'wall' | 'wall-side',  // 'wall' needs clearance both sides; 'wall-side' only one
  side?: 'front' | 'back',
  ignoreIds?: string[],
): { valid: boolean; conflictIds: string[]; adjustedY: number }
```

`adjustedY` contains the snapped Y so items sit flush on the slab — always use it instead of the raw `localY`:

```ts
const { valid, adjustedY } = canPlaceOnWall(levelId, wallId, x, y, dims, 'wall', undefined, [item.id])
if (valid) updateNode(item.id, { wallT: x, wallY: adjustedY })
```

---

## canPlaceOnCeiling

```ts
canPlaceOnCeiling(
  ceilingId: string,
  position: [number, number, number],
  dimensions: [number, number, number],
  rotation: [number, number, number],
  ignoreIds?: string[],
): { valid: boolean; conflictIds: string[] }
```

---

## Slab Elevation

When items rest on a slab (not flat ground), use these to get the correct Y:

```ts
import { spatialGridManager } from '@pascal-app/core'

// Y at a single point
const y = spatialGridManager.getSlabElevationAt(levelId, x, z)

// Y considering the item's full footprint (highest slab point under item)
const y = spatialGridManager.getSlabElevationForItem(levelId, position, dimensions, rotation)
```

---

## Rules

- **Always pass `[item.id]` in `ignoreIds`** when validating a draft item that already exists in the scene — otherwise it collides with itself.
- **Use `adjustedY` from `canPlaceOnWall`** — don't use the raw cursor Y for wall-mounted items.
- **Use `getScaledDimensions(item)`** (@packages/core/src/schema/nodes/item.ts) to account for item scale, not the raw `asset.dimensions`.
- Validate on every pointer move for live feedback (highlight ghost red/green). Only `createNode` / `updateNode` on pointer up or click.

See @apps/editor/components/tools/item/use-placement-coordinator.tsx for a full implementation.
