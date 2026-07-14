import {
  type AnyNode,
  type AnyNodeId,
  type ElevatorNode,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  resolveElevatorServiceLevelIds,
  useInteractive,
  useLiveNodeOverrides,
} from '@pascal-app/core'

/**
 * Stage C floor-plan emitter for elevator. Renders:
 *
 *  - **Outer shaft footprint** — rotated rectangle (cab + wall thickness).
 *  - **Cab indicator** — inner rectangle showing the cab's position within
 *    the shaft. Highlighted when `runtime.currentLevelId` matches the
 *    active level (i.e. the car is *on this floor*).
 *  - **Door opening indicator** — a short marker on the front face
 *    spanning `doorWidth` so users can see which way the doors open.
 *  - **Selection / target / queued chrome** — selection stroke when
 *    the elevator is selected, accent stroke when the runtime targets
 *    this level (cab is travelling here) or this level is queued.
 *
 * Reads the elevator's live state via `useLiveNodeOverrides.getState()`
 * (inspector edits) and `useInteractive.getState().elevators[id]`
 * (runtime cab travel). Those reads are non-reactive on their own —
 * `FloorplanRegistryLayer` subscribes to both stores so the layer
 * re-renders when they change, propagating into this builder.
 *
 * Per-level served-level chips (the small floor-label badges on each
 * shaft side) are not emitted yet — they need an HTML-overlay primitive
 * in `FloorplanGeometry` to render properly (SVG `<text>` rotates with
 * the plan, which mangles label legibility). Tracked as follow-up; the
 * legacy `<FloorplanElevatorLayer>` still renders the chips for
 * pre-registry builds while we figure out the right primitive shape.
 */

const STAGE_LEVEL_FILTER_HIDE = true

export function buildElevatorFloorplan(
  node: ElevatorNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  // Merge in any live overrides (inspector edits not yet committed).
  const overrides = useLiveNodeOverrides.getState().get(node.id)
  const display: ElevatorNode = overrides ? ({ ...node, ...overrides } as ElevatorNode) : node

  // Service-level gate. If the active level isn't one the elevator
  // serves, render nothing — legacy behaviour. The level id comes via
  // `ctx.parent` (the elevator's parent in the tree is the level it's
  // hosted on, which is the active level when the registry layer walks
  // from `levelId`).
  const parentLevelId = ctx.parent?.id
  if (STAGE_LEVEL_FILTER_HIDE && parentLevelId) {
    const sceneNodes = collectAllNodes(ctx)
    const serviceLevelIds = resolveElevatorServiceLevelIds(display, sceneNodes)
    if (!serviceLevelIds.includes(parentLevelId as AnyNodeId)) {
      return null
    }
  }

  const wallThickness = Math.max(display.shaftWallThickness ?? 0.09, 0.04)
  const cabWidth = Math.max(display.width, 0.8)
  const cabDepth = Math.max(display.depth, 0.8)
  const shaftWidth = Math.max(display.shaftWidth ?? display.width, cabWidth, 0.8)
  const shaftDepth = Math.max(display.shaftDepth ?? display.depth, cabDepth, 0.8)
  const doorWidth = Math.min(Math.max(display.doorWidth, 0.45), cabWidth - 0.18, shaftWidth - 0.18)
  const halfWidth = Math.max(0.1, shaftWidth / 2 + wallThickness)
  const halfDepth = Math.max(0.1, shaftDepth / 2 + wallThickness)

  const center = { x: display.position[0], y: display.position[2] }
  const cos = Math.cos(display.rotation)
  const sin = Math.sin(display.rotation)
  const rotate = (lx: number, ly: number): [number, number] => {
    // Same clockwise convention as `rotatePlanVector` in editor — see
    // `wiki/architecture/tools.md` for why every plan-space rotation
    // uses this matrix and not the standard counter-clockwise one.
    return [lx * cos + ly * sin, -lx * sin + ly * cos]
  }

  // Outer shaft footprint corners.
  const outerCorners: Array<readonly [number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]
  const outerPoints: FloorplanPoint[] = outerCorners.map(([lx, ly]) => {
    const [rx, ry] = rotate(lx, ly)
    return [center.x + rx, center.y + ry]
  })

  // Cab inner rectangle. The cab sits flush against the front face
  // (-Z in local coords) so its center is `-shaftDepth/2 + cabDepth/2`
  // away from shaft center.
  const cabCenterLocalY = -shaftDepth / 2 + cabDepth / 2
  const cabHalfW = cabWidth / 2
  const cabHalfD = cabDepth / 2
  const cabCorners: Array<readonly [number, number]> = [
    [-cabHalfW, cabCenterLocalY - cabHalfD],
    [cabHalfW, cabCenterLocalY - cabHalfD],
    [cabHalfW, cabCenterLocalY + cabHalfD],
    [-cabHalfW, cabCenterLocalY + cabHalfD],
  ]
  const cabPoints: FloorplanPoint[] = cabCorners.map(([lx, ly]) => {
    const [rx, ry] = rotate(lx, ly)
    return [center.x + rx, center.y + ry]
  })

  // Runtime state — current level / target level / queued.
  const runtime = useInteractive.getState().elevators[node.id]
  const isCarOnLevel = parentLevelId ? runtime?.currentLevelId === parentLevelId : false
  const isTargetLevel = parentLevelId ? runtime?.targetLevelId === parentLevelId : false
  const isQueuedLevel = parentLevelId
    ? (runtime?.queue.includes(parentLevelId as never) ?? false)
    : false

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  // Stroke selection — selected wins, then runtime target / queued
  // states get the accent palette colour so users can spot "the cab is
  // coming here" at a glance.
  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : isTargetLevel || isQueuedLevel
        ? '#0ea5e9'
        : '#475569'
  // Shaft fill — orange when selected, light slate otherwise. When the
  // car is *on this level*, the cab indicator inside gets the highlight
  // instead of the whole shaft (more legible).
  const shaftFill = showSelectedChrome ? '#fed7aa' : '#cbd5e1'
  const cabFill = isCarOnLevel ? '#22c55e' : showSelectedChrome ? '#fef3c7' : '#e2e8f0'
  const cabStroke = isCarOnLevel ? '#15803d' : '#475569'

  const children: FloorplanGeometry[] = []

  // Outer shaft.
  children.push({
    kind: 'polygon',
    points: outerPoints,
    fill: shaftFill,
    stroke,
    strokeWidth: showSelectedChrome ? 0.04 : 0.03,
    strokeLinejoin: 'round',
    opacity: 0.85,
  })

  // Cab inner rectangle.
  children.push({
    kind: 'polygon',
    points: cabPoints,
    fill: cabFill,
    fillOpacity: isCarOnLevel ? 0.85 : 0.55,
    stroke: cabStroke,
    strokeWidth: 0.018,
    strokeLinejoin: 'round',
    opacity: 0.92,
  })

  // Door opening indicator — a short line on the front edge centered
  // on the cab. The legacy renders a more complex slide / center-open
  // hint; this is the minimum useful signal.
  const doorY = -halfDepth
  const [doorStartX, doorStartY] = rotate(-doorWidth / 2, doorY)
  const [doorEndX, doorEndY] = rotate(doorWidth / 2, doorY)
  children.push({
    kind: 'line',
    x1: center.x + doorStartX,
    y1: center.y + doorStartY,
    x2: center.x + doorEndX,
    y2: center.y + doorEndY,
    stroke: isCarOnLevel ? '#15803d' : '#0f172a',
    strokeWidth: 0.05,
    strokeLinecap: 'round',
    opacity: 0.92,
  })

  // Served-level chips — vertical column of marker circles + level
  // numbers to the right of the shaft, only when selected and the
  // elevator serves more than one level. Mirrors the legacy
  // `<FloorplanElevatorLayer>` chip rendering (~line 6423 in
  // floorplan-panel.tsx).
  if (isSelected && parentLevelId) {
    const sceneNodes = collectAllNodes(ctx)
    const serviceLevelIds = resolveElevatorServiceLevelIds(display, sceneNodes)
    if (serviceLevelIds.length > 1) {
      const disabledLevelIds = new Set(display.disabledLevelIds ?? [])
      const serviceOnlyLevelIds = new Set(display.serviceOnlyLevelIds ?? [])
      const rangeStep = 0.18
      const rangeHeight = Math.max(0, (serviceLevelIds.length - 1) * rangeStep)
      const [rangeOffsetX, rangeOffsetY] = rotate(halfWidth + 0.38, 0)
      const rangeX = center.x + rangeOffsetX
      const rangeBottomY = center.y + rangeOffsetY + rangeHeight / 2
      const rangeTopY = center.y + rangeOffsetY - rangeHeight / 2

      // Connector spine — single vertical line tying the chips to the
      // shaft. Sky blue, semi-transparent.
      children.push({
        kind: 'line',
        x1: rangeX,
        y1: rangeTopY,
        x2: rangeX,
        y2: rangeBottomY,
        stroke: '#0ea5e9',
        strokeOpacity: 0.52,
        strokeWidth: 0.018,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      })

      // One chip per served level. Lowest level at the bottom of the
      // column, index increases upward — matches legacy ordering.
      serviceLevelIds.forEach((levelId, index) => {
        const isCurrent = runtime?.currentLevelId === levelId
        const isTarget = runtime?.targetLevelId === levelId
        // `resolveElevatorServiceLevelIds` returns plain `string[]`, but
        // the runtime queue is `AnyNodeId[]` (branded). The values agree
        // at runtime — narrowing through `as never` keeps the includes
        // call type-safe without dragging the brand into the helper's
        // public return type.
        const isQueued = runtime?.queue.includes(levelId as never) ?? false
        const isDisabled = disabledLevelIds.has(levelId)
        const isServiceOnly = serviceOnlyLevelIds.has(levelId)
        const isUnavailable = isDisabled || isServiceOnly

        const markerFill = isCurrent
          ? '#22c55e'
          : isTarget || isQueued
            ? '#38bdf8'
            : isUnavailable
              ? '#94a3b8'
              : '#ffffff'
        const markerStroke = isUnavailable ? '#64748b' : '#0369a1'
        const labelColor = isUnavailable ? '#64748b' : '#075985'
        const y = rangeBottomY - index * rangeStep

        children.push({
          kind: 'circle',
          cx: rangeX,
          cy: y,
          r: 0.055,
          fill: markerFill,
          fillOpacity: isUnavailable ? 0.72 : 0.95,
          stroke: markerStroke,
          strokeWidth: 0.012,
        })
        children.push({
          kind: 'text',
          x: rangeX + 0.11,
          y,
          text: String(index + 1),
          fontSize: 0.13,
          fontWeight: 700,
          fill: labelColor,
          textAnchor: 'start',
          dominantBaseline: 'middle',
        })
      })
    }
  }

  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [display.position[0], display.position[2]],
    })
  }

  return { kind: 'group', children }
}

/**
 * `ctx` exposes `resolve` and `children` / `siblings` / `parent`, but
 * not the full nodes map. `resolveElevatorServiceLevelIds` wants a
 * `Record<id, AnyNode>`; we rebuild it by walking the chain we DO have
 * access to. For the elevator's service-level check we only need the
 * elevator's parent (the level), its building, and any level siblings.
 * This is the minimum graph the resolver needs.
 *
 * If a future use needs the full nodes map for a builder, we'd surface
 * it through ctx — but doing so leaks the whole scene store into every
 * `def.floorplan` call. Narrow opt-in is the better default.
 */
function collectAllNodes(ctx: GeometryContext): Record<string, AnyNode> {
  // We need the building → levels graph for service-level resolution.
  // Walk up from the elevator: parent (level) → its parent (building) →
  // building.children (all levels). That's enough for the resolver.
  const out: Record<string, AnyNode> = {}
  const level = ctx.parent
  if (level) {
    out[level.id] = level
    const building = level.parentId ? ctx.resolve(level.parentId as AnyNodeId) : undefined
    if (building) {
      out[building.id] = building
      if ('children' in building && Array.isArray(building.children)) {
        for (const cid of building.children) {
          const child = ctx.resolve(cid as AnyNodeId)
          if (child) out[child.id] = child
        }
      }
    }
  }
  return out
}
