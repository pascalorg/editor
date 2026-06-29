import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getRoofWallFaceFrame,
  getScaledDimensions,
  type ItemNode,
  type RoofSegmentNode,
  roofFacePointToSegment,
  useLiveTransforms,
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

// Plan-space rotation convention used by the legacy `rotatePlanVector`
// in `editor/src/lib/floorplan/geometry.ts`. This is a CLOCKWISE rotation
// — the registry-side equivalent of the canonical floor-plan transform
// math. Don't switch to a standard counter-clockwise rotation; the wall
// items math (wallRotation = -atan2(dy, dx)) is calibrated against this
// convention, and the legacy item floor-plan stack reads from these
// offsets across many sites.
function rotateVec(x: number, y: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c + y * s, -x * s + y * c]
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
        ? ((wall.thickness ?? 0.1) / 2) * (item.side === 'front' ? 1 : -1)
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
  } else if (parentNode?.type === 'shelf') {
    // Shelf-hosted item: `item.position` is in shelf-local coords. The
    // shelf has its own `position` + `rotation[1]` in its parent (level)
    // frame, so the item's plan-space position composes the shelf's
    // pose with the item's local offset. Without this branch the
    // `else` below would treat shelf-local coords as level-local and
    // the item would render at the wrong spot whenever the shelf is
    // anywhere other than (0, 0, 0).
    //
    // We also check `useLiveTransforms` for the shelf — if the shelf is
    // mid-move (3D or 2D), its scene-state `position` is still at the
    // pre-move spot but the live transform carries the cursor-tracked
    // position. Reading the live value here keeps the hosted item
    // following the shelf in 2D throughout the drag, mirroring how the
    // shelf's own entry follows via the layer's effectiveNode override.
    const shelf = parentNode as AnyNode & {
      position: [number, number, number]
      rotation: [number, number, number]
    }
    const live = useLiveTransforms.getState().get(shelf.id as AnyNodeId)
    const shelfX = live?.position[0] ?? shelf.position[0]
    const shelfZ = live?.position[2] ?? shelf.position[2]
    const shelfRotationY = live?.rotation ?? shelf.rotation[1] ?? 0
    const [offsetX, offsetY] = rotateVec(item.position[0], item.position[2], shelfRotationY)
    result = {
      x: shelfX + offsetX,
      y: shelfZ + offsetY,
      rotation: shelfRotationY + localRotation,
    }
  } else if (parentNode?.type === 'roof-segment') {
    // Roof-hosted wall item: FACE-LOCAL position mapped through the face
    // frame, then composed through the segment's and parent roof's poses
    // into level-local plan coords.
    const segment = parentNode as RoofSegmentNode
    const roof = segment.parentId
      ? (ctx.resolve(segment.parentId as AnyNodeId) as
          | (AnyNode & { position: [number, number, number]; rotation: number })
          | undefined)
      : undefined
    if (roof?.type === 'roof' && item.roofFace) {
      const frame = getRoofWallFaceFrame(segment, item.roofFace)
      const segLocal = roofFacePointToSegment(segment, item.roofFace, item.position)
      const [sx, sz] = rotateVec(segLocal[0], segLocal[2], segment.rotation ?? 0)
      const [rx, rz] = rotateVec(
        sx + segment.position[0],
        sz + segment.position[2],
        roof.rotation ?? 0,
      )
      result = {
        x: rx + roof.position[0],
        y: rz + roof.position[2],
        rotation: (roof.rotation ?? 0) + (segment.rotation ?? 0) + frame.yaw + localRotation,
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

  // Wall-side items are anchored at the mounted wall face; their body extends
  // depth-ward AWAY from the wall (into the room), so push the footprint centre
  // a half-depth out along the item's local +Z. After the front/back π flip in
  // `transform.rotation`, +depth/2 always points off the wall for either side;
  // a negative offset would lay the footprint across the wall onto the far side.
  const centerLocalZ = node.asset.attachTo === 'wall-side' ? depth / 2 : 0
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

  const isSelected = ctx.viewState?.selected ?? false
  const isMoving = ctx.viewState?.moving ?? false
  const floorPlanUrl = node.asset.floorPlanUrl
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      // When an asset thumbnail is present, the polygon is a transparent
      // hit-target — the image carries the visual weight. Without a
      // thumbnail the polygon needs a light fill to read at all.
      //
      // `transparent` (not `none`) so the interior remains hit-testable —
      // the registry layer's wrapping `<g>` only fires onPointerDown when
      // the child renders a paintable surface. `fill="none"` would make
      // clicks pass through to whatever's beneath, breaking selection.
      fill: floorPlanUrl ? 'transparent' : '#fef3c7',
      stroke: '#92400e',
      strokeWidth: 0.012,
      opacity: 0.85,
    },
  ]
  // Asset thumbnail — top-down PNG capture from the asset modal. Drawn
  // inside the footprint with the item's rotation applied. Matches the
  // legacy `FloorplanItemImage` overlay.
  if (floorPlanUrl) {
    children.push({
      kind: 'image',
      url: floorPlanUrl,
      center: [cx, cy],
      width,
      height: depth,
      // `rotateVec` (the footprint polygon) applies R(-angle), but the renderer
      // draws the image with SVG `rotate(+deg)` = R(+angle). Negate so the
      // sprite rotates the same way as its footprint box (and 3D); otherwise the
      // two counter-rotate and diverge by 2x the item's rotation.
      rotation: -transform.rotation,
    })
  }
  // Move handle — orange dot at the item center. Only when selected and not
  // already moving: during a move the dot sits under the cursor, so a release
  // over it would re-arm the move (and re-enter edit) instead of committing.
  if (isSelected && !isMoving) {
    children.push({
      kind: 'move-handle',
      point: [cx, cy],
    })
  }
  return { kind: 'group', children }
}
