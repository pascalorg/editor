import {
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
 * Stage C floor-plan emitter for elevator. Architectural symbol style:
 *
 *  - **Outer shaft outline** — outer face of the shaft wall.
 *  - **Inner shaft outline** — inner face of the shaft wall, offset
 *    inward by `shaftWallThickness`. The two outlines together read as
 *    a hollow wall in plan.
 *  - **Dashed X** — two diagonals across the shaft interior, the
 *    universal architectural mark for an elevator cab.
 *  - **Door opening** — two small jamb stubs flanking the opening at
 *    the front face, with a dashed line spanning the opening (the
 *    closed door).
 *  - **Selection / runtime chrome** — selected → palette stroke;
 *    cab-on-level → green tint on the X; target/queued → sky accent.
 *
 * Reads live overrides (`useLiveNodeOverrides`) and runtime cab state
 * (`useInteractive.elevators[id]`) non-reactively; the registry layer
 * subscribes to both stores so this builder re-runs on change.
 */

const STAGE_LEVEL_FILTER_HIDE = false

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
  const doorWidth = Math.min(Math.max(display.doorWidth, 0.45), shaftWidth - 0.24)
  const outerHalfW = Math.max(0.1, shaftWidth / 2 + wallThickness)
  const outerHalfD = Math.max(0.1, shaftDepth / 2 + wallThickness)
  const innerHalfW = Math.max(0.05, shaftWidth / 2)
  const innerHalfD = Math.max(0.05, shaftDepth / 2)

  const center = { x: display.position[0], y: display.position[2] }
  const cos = Math.cos(display.rotation)
  const sin = Math.sin(display.rotation)
  const rotate = (lx: number, ly: number): [number, number] => {
    // Negated-rotation matrix (equivalent to rotating by `-rotation`)
    // so SVG's CW-with-y-down `rotate` direction visually matches
    // Three.js Y-rotation (CCW from a top-down view). Column / shelf /
    // roof-segment do the same thing explicitly via `-node.rotation`
    // passed to `rotatePlanVector`; this is the inline version.
    return [lx * cos + ly * sin, -lx * sin + ly * cos]
  }
  const toPlan = (lx: number, ly: number): FloorplanPoint => {
    const [rx, ry] = rotate(lx, ly)
    return [center.x + rx, center.y + ry]
  }
  const rectPoints = (halfW: number, halfD: number): FloorplanPoint[] => [
    toPlan(-halfW, -halfD),
    toPlan(halfW, -halfD),
    toPlan(halfW, halfD),
    toPlan(-halfW, halfD),
  ]

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

  // Base ink: near-black architectural outline. Selection switches to
  // the palette accent. Runtime state (car-on-level, target, queued)
  // is conveyed via the served-level chip column when selected, not
  // the main outline — so the floor-plan symbol stays neutral and
  // matches the line weight of the other architectural elements.
  const baseInk = '#111111'
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : baseInk
  const cabMarkInk = stroke

  const children: FloorplanGeometry[] = []

  // Invisible hit-target — closed polygon over the full outer
  // footprint so clicks anywhere inside the elevator (not just on the
  // stroked outlines) select the node. The outer outline below is a
  // polyline with `fill='none'`, so without this layer the interior
  // would fall through to whatever sits beneath.
  children.push({
    kind: 'polygon',
    points: rectPoints(outerHalfW, outerHalfD),
    fill: stroke,
    fillOpacity: 0,
    stroke: 'none',
    strokeWidth: 0,
    pointerEvents: 'all',
  })

  // Door geometry. The jambs are little U-shaped notches that hang
  // BELOW the outer wall's bottom edge on either side of the door
  // opening; the outer outline traces around them and breaks for the
  // door in the middle.
  const doorY = -outerHalfD
  const effectiveDoorWidth = Math.min(doorWidth, innerHalfW * 2 - 0.16)
  const jambInnerX = effectiveDoorWidth / 2
  const jambWidth = Math.max(0.08, Math.min(wallThickness * 2.2, (outerHalfW - jambInnerX) * 0.55))
  const jambOuterX = Math.min(jambInnerX + jambWidth, outerHalfW - 0.04)
  const jambStubDepth = Math.max(0.06, wallThickness * 1.05)

  // Outer outline — single polyline that traces clockwise from the
  // left edge of the door opening, around the left jamb stub, along
  // the bottom-left segment, up the left side, across the top, down
  // the right side, along the bottom-right segment, around the right
  // jamb stub, ending at the right edge of the door opening. The two
  // endpoints frame the door gap; SVG `polyline` doesn't close.
  const outerOutline: FloorplanPoint[] = [
    toPlan(-jambInnerX, doorY),
    toPlan(-jambInnerX, doorY - jambStubDepth),
    toPlan(-jambOuterX, doorY - jambStubDepth),
    toPlan(-jambOuterX, doorY),
    toPlan(-outerHalfW, doorY),
    toPlan(-outerHalfW, outerHalfD),
    toPlan(outerHalfW, outerHalfD),
    toPlan(outerHalfW, doorY),
    toPlan(jambOuterX, doorY),
    toPlan(jambOuterX, doorY - jambStubDepth),
    toPlan(jambInnerX, doorY - jambStubDepth),
    toPlan(jambInnerX, doorY),
  ]
  children.push({
    kind: 'polyline',
    points: outerOutline,
    fill: 'none',
    stroke,
    strokeWidth: showSelectedChrome ? 0.035 : 0.025,
    strokeLinejoin: 'miter',
    strokeLinecap: 'butt',
  })

  // Inner outline — closed rectangle, the inner face of the shaft.
  // The X diagonals terminate at its corners.
  children.push({
    kind: 'polygon',
    points: rectPoints(innerHalfW, innerHalfD),
    fill: 'none',
    stroke,
    strokeWidth: 0.02,
    strokeLinejoin: 'miter',
  })

  // Dashed X across the shaft interior — corner-to-corner of the
  // inner rectangle, the universal elevator-cab mark.
  const diagonals: Array<readonly [FloorplanPoint, FloorplanPoint]> = [
    [toPlan(-innerHalfW, -innerHalfD), toPlan(innerHalfW, innerHalfD)],
    [toPlan(innerHalfW, -innerHalfD), toPlan(-innerHalfW, innerHalfD)],
  ]
  for (const [start, end] of diagonals) {
    children.push({
      kind: 'line',
      x1: start[0],
      y1: start[1],
      x2: end[0],
      y2: end[1],
      stroke: cabMarkInk,
      strokeWidth: 0.018,
      strokeDasharray: '0.08 0.06',
      strokeLinecap: 'butt',
      opacity: 0.85,
    })
  }

  // Dashed door line — sits on the outer wall line, spanning the gap
  // between the two jamb stubs.
  const doorStart = toPlan(-jambInnerX, doorY)
  const doorEnd = toPlan(jambInnerX, doorY)
  children.push({
    kind: 'line',
    x1: doorStart[0],
    y1: doorStart[1],
    x2: doorEnd[0],
    y2: doorEnd[1],
    stroke: cabMarkInk,
    strokeWidth: 0.02,
    strokeDasharray: '0.08 0.06',
    strokeLinecap: 'butt',
    opacity: 0.9,
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
      const [rangeOffsetX, rangeOffsetY] = rotate(outerHalfW + 0.38, 0)
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

  // Selection chrome — orange move-handle dot at the centre, four
  // perpendicular side resize-arrows ringing the outer shaft, and a
  // rotate-arrow at the front-right corner. Side arrows drive `width`
  // (X-axis) and `depth` (Z-axis) through `elevatorResizeAffordance`
  // with `anchor: 'center'` — sister of the 3D `linear-resize` handles
  // in `definition.ts`. Body move is reached via the centroid dot or
  // the floating action menu's Move button.
  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [display.position[0], display.position[2]],
    })

    const sideArrowOffset = 0.12
    const rotateCornerOffset = 0.22
    const cx = display.position[0]
    const cz = display.position[2]
    const sides: Array<{
      local: [number, number]
      localAngle: number
      axis: 'x' | 'z'
      side: 1 | -1
    }> = [
      { local: [outerHalfW + sideArrowOffset, 0], localAngle: 0, axis: 'x', side: 1 },
      { local: [-(outerHalfW + sideArrowOffset), 0], localAngle: Math.PI, axis: 'x', side: -1 },
      { local: [0, outerHalfD + sideArrowOffset], localAngle: Math.PI / 2, axis: 'z', side: 1 },
      {
        local: [0, -(outerHalfD + sideArrowOffset)],
        localAngle: -Math.PI / 2,
        axis: 'z',
        side: -1,
      },
    ]
    for (const side of sides) {
      const [ox, oz] = rotate(side.local[0], side.local[1])
      const [tx, tz] = rotate(Math.cos(side.localAngle), Math.sin(side.localAngle))
      children.push({
        kind: 'move-arrow',
        point: [cx + ox, cz + oz],
        angle: Math.atan2(tz, tx),
        affordance: 'elevator-resize',
        payload: { axis: side.axis, side: side.side },
      })
    }

    // Rotate-arrow at the +X / +Z corner. `localAngle = π/4` puts the
    // curved arrow's bow at the diagonal corner so it reads as a
    // rotation gizmo around the elevator centre.
    const cornerLocalX = outerHalfW + rotateCornerOffset
    const cornerLocalZ = outerHalfD + rotateCornerOffset
    const [cornerX, cornerZ] = rotate(cornerLocalX, cornerLocalZ)
    const [radialX, radialZ] = rotate(1, 1)
    children.push({
      kind: 'rotate-arrow',
      point: [cx + cornerX, cz + cornerZ],
      angle: Math.atan2(radialZ, radialX),
      affordance: 'elevator-rotate',
      pivot: [cx, cz],
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
function collectAllNodes(ctx: GeometryContext): Record<string, never> {
  // We need the building → levels graph for service-level resolution.
  // Walk up from the elevator: parent (level) → its parent (building) →
  // building.children (all levels). That's enough for the resolver.
  const out: Record<string, unknown> = {}
  const level = ctx.parent
  if (level) {
    out[level.id] = level
    const building = (level as { parentId?: string }).parentId
      ? ctx.resolve((level as { parentId: string }).parentId as never)
      : undefined
    if (building) {
      out[building.id] = building
      const childIds = (building as unknown as { children?: string[] }).children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) {
          const child = ctx.resolve(cid as never)
          if (child) out[child.id] = child
        }
      }
    }
  }
  return out as Record<string, never>
}
