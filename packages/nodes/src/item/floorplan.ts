import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getScaledDimensions,
  type ItemNode,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for item.
 *
 * Items can be parented to a wall, ceiling, slab, or another item.
 * Position is in the parent's local frame, so we walk the parent chain
 * via `ctx.resolve` to compute the world-space (level-local) transform.
 *
 * Mirrors `getItemFloorplanTransform` from editor/lib/floorplan/items.ts
 * but uses the registry's resolve callback instead of a node map. Logic
 * is identical so visual output matches the legacy.
 *
 * Returns a rotated rectangle of width × depth at the resolved position.
 * Phase 5 follow-up may render `asset.floorPlanUrl` as a custom image
 * overlay when present.
 */
type Transform = { x: number; y: number; rotation: number }

function rotateVec(x: number, y: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c - y * s, x * s + y * c]
}

function resolveItemTransform(
  item: ItemNode,
  ctx: GeometryContext,
  cache = new Map<AnyNodeId, Transform | null>(),
): Transform | null {
  const cached = cache.get(item.id as AnyNodeId)
  if (cached !== undefined) return cached

  const localRotation = item.rotation[1] ?? 0
  let result: Transform | null = null

  const parentNode: AnyNode | undefined = item.parentId
    ? ctx.resolve(item.parentId as AnyNodeId)
    : undefined

  if (parentNode?.type === 'wall') {
    // Wall-aligned: rotate item.position by wall's angle, anchor at wall.start.
    const wall = parentNode as AnyNode & {
      start: [number, number]
      end: [number, number]
      thickness?: number
    }
    const wallRotation = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
    const wallLocalZ =
      item.asset.attachTo === 'wall-side'
        ? ((wall.thickness ?? 0.1) / 2) * (item.side === 'back' ? -1 : 1)
        : item.position[2]
    const [offsetX, offsetY] = rotateVec(item.position[0], wallLocalZ, wallRotation)
    result = {
      x: wall.start[0] + offsetX,
      y: wall.start[1] + offsetY,
      rotation: wallRotation + localRotation,
    }
  } else if (parentNode?.type === 'item') {
    // Nested item: recursively resolve parent's transform.
    const parentT = resolveItemTransform(parentNode as ItemNode, ctx, cache)
    if (parentT) {
      const [offsetX, offsetY] = rotateVec(item.position[0], item.position[2], parentT.rotation)
      result = {
        x: parentT.x + offsetX,
        y: parentT.y + offsetY,
        rotation: parentT.rotation + localRotation,
      }
    }
  } else {
    // Level / slab / ceiling parent — item.position is level-local.
    result = {
      x: item.position[0],
      y: item.position[2],
      rotation: localRotation,
    }
  }

  cache.set(item.id as AnyNodeId, result)
  return result
}

export function buildItemFloorplan(node: ItemNode, ctx: GeometryContext): FloorplanGeometry | null {
  const transform = resolveItemTransform(node, ctx)
  if (!transform) return null

  const [width, , depth] = getScaledDimensions(node)
  if (width <= 0 || depth <= 0) return null

  // Wall-side items are anchored at the front face — center their footprint
  // half-a-depth back toward the wall surface.
  const centerLocalZ = node.asset.attachTo === 'wall-side' ? -depth / 2 : 0
  const [centerOffsetX, centerOffsetY] = rotateVec(0, centerLocalZ, transform.rotation)
  const cx = transform.x + centerOffsetX
  const cy = transform.y + centerOffsetY

  // Rectangle corners in local space, rotated and translated.
  const halfW = width / 2
  const halfD = depth / 2
  const corners: Array<[number, number]> = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ]
  const points: readonly FloorplanPoint[] = corners.map(([x, y]) => {
    const [rx, ry] = rotateVec(x, y, transform.rotation)
    return [cx + rx, cy + ry] as FloorplanPoint
  })

  return {
    kind: 'polygon',
    points,
    fill: '#fef3c7',
    stroke: '#92400e',
    strokeWidth: 0.012,
    opacity: 0.85,
  }
}
