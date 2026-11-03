import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getScaledDimensions,
  type ItemNode,
  scriptImages,
} from '@pascal-app/core'
import {
  formatLinearMeasurement,
  readFloorplanContext,
  readFloorplanMetricNotationOverride,
} from '@pascal-app/editor'
import { restingNodePlanFrame } from '../shared/resting-surface-plan'
import { buildPlanItemSymbol, classifyPlanItem, PLAN_SYMBOL_METADATA_KEY } from './plan-symbols'

/**
 * Stage C floor-plan builder for item.
 *
 * Items can be parented to a wall, ceiling, slab, roof face, block face or
 * another hosted node. The plan pose is the item's level frame — the pose
 * the viewer mounts it at — so the footprint sits where the item does in 3D
 * for every host chain.
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

export function resolveItemTransform(item: ItemNode, ctx: GeometryContext): Transform | null {
  let f: ReturnType<typeof restingNodePlanFrame>
  try {
    f = restingNodePlanFrame(item, ctx.resolve)
  } catch {
    // A host chain that no longer resolves (a deleted host mid-edit) has no pose to draw.
    return null
  }
  return {
    x: f.position[0],
    y: f.position[2],
    rotation: Math.atan2(f.axes[2][0], f.axes[2][2]),
  }
}

export function buildItemContextualDimensions(
  node: ItemNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const transform = resolveItemTransform(node, ctx)
  if (!transform) return null
  const [width, , depth] = getScaledDimensions(node)
  if (width <= 1e-6 || depth <= 1e-6) return null

  const centerLocalZ = node.asset.attachTo === 'wall-side' ? depth / 2 : 0
  const [centerOffsetX, centerOffsetY] = rotateVec(0, centerLocalZ, transform.rotation)
  const cx = transform.x + centerOffsetX
  const cy = transform.y + centerOffsetY
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const point = (x: number, y: number): FloorplanPoint => {
    const [rx, ry] = rotateVec(x, y, transform.rotation)
    return [cx + rx, cy + ry]
  }
  const widthNormal = rotateVec(0, -1, transform.rotation)
  const depthNormal = rotateVec(1, 0, transform.rotation)
  const unit = ctx.viewState?.unit ?? 'metric'
  const metricNotation = readFloorplanMetricNotationOverride(ctx) ?? 'meters'
  const stroke = ctx.viewState?.palette?.selectedStroke ?? '#2563eb'

  return {
    kind: 'group',
    children: [
      {
        kind: 'dimension',
        start: point(-halfWidth, -halfDepth),
        end: point(halfWidth, -halfDepth),
        offsetNormal: widthNormal,
        offsetDistance: 0.28,
        extensionOvershoot: 0.08,
        text: formatLinearMeasurement(width, unit, metricNotation),
        stroke,
      },
      {
        kind: 'dimension',
        start: point(halfWidth, -halfDepth),
        end: point(halfWidth, halfDepth),
        offsetNormal: depthNormal,
        offsetDistance: 0.28,
        extensionOvershoot: 0.08,
        text: formatLinearMeasurement(depth, unit, metricNotation),
        stroke,
      },
    ],
  }
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

  // A sheet (drafting) draws the permit-set symbol — fixtures as labelled
  // linework, furniture as a light outline — never the sprite or the
  // editor's amber footprint. Ceiling items and decor draw nothing.
  if (readFloorplanContext(ctx).drafting) {
    const planClass = classifyPlanItem(node.asset)
    const symbol = buildPlanItemSymbol(planClass, {
      map: (x, y) => {
        const [rx, ry] = rotateVec(x, y, transform.rotation)
        return [cx + rx, cy + ry]
      },
      width,
      depth,
    })
    // the sheet lays its tags out around fixtures and (more loosely)
    // furniture; the mark rides on the outline itself, which the sheet's
    // model / annotation split passes through untouched (it rebuilds groups)
    const [outline, ...rest] = symbol
    if (!outline) return null
    const marked = {
      ...outline,
      metadata: {
        ...(outline as { metadata?: object }).metadata,
        [PLAN_SYMBOL_METADATA_KEY]: planClass.kind,
      },
    } as FloorplanGeometry
    return { kind: 'group', children: [marked, ...rest] }
  }

  const isSelected = ctx.viewState?.selected ?? false
  // Marquee preview — the about-to-be-selected tint every other kind shows.
  const isHighlighted = ctx.viewState?.highlighted ?? false
  const showSelection = isSelected || isHighlighted
  const isMoving = ctx.viewState?.moving ?? false
  const selectedStroke = ctx.viewState?.palette?.selectedStroke ?? '#3b82f6'
  const floorPlanUrl = scriptImages(node)?.floorPlan ?? node.asset.floorPlanUrl
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
      // Selected items read as selected: palette stroke + heavier weight
      // (the move dot used to be the only cue, and it hides in
      // multi-selections).
      stroke: showSelection ? selectedStroke : '#92400e',
      strokeWidth: showSelection ? 0.035 : 0.012,
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
  // Selection ring ABOVE the thumbnail — the base polygon's selected stroke
  // sits underneath the image, so re-draw it on top. `fill: none` keeps the
  // ring click-through; the base polygon owns hit-testing.
  if (showSelection && floorPlanUrl) {
    children.push({
      kind: 'polygon',
      points,
      fill: 'none',
      stroke: selectedStroke,
      strokeWidth: 0.035,
      opacity: isSelected ? 0.95 : 0.7,
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
