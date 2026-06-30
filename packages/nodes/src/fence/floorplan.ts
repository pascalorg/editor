import {
  type FloorplanGeometry,
  type GeometryContext,
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  getFenceControlHandle,
  getWallMidpointHandlePoint,
  isCurvedWall,
  isSplineFence,
  sampleFenceCenterline,
} from '@pascal-app/core'
import type { FenceNode } from './schema'

/**
 * Stage C floor-plan builder for fence. 1:1 visual port of the legacy
 * `FloorplanFenceLayer` from `floorplan-panel.tsx`:
 *
 *   1. Three stacked stroke paths along the centerline, all with
 *      `vectorEffect: 'non-scaling-stroke'` so widths stay constant on
 *      screen at any zoom:
 *        a. Optional glow (semi-transparent, only when active/hovered).
 *        b. White underlay — the visual "fence body" base layer.
 *        c. Dark accent — the actual fence outline.
 *   2. Style-aware markers at computed positions along the centerline:
 *        - `privacy` / `horizontal`: rotated rectangle (solid panel).
 *        - `rail`: concentric circle stack (post + ring + tiny center).
 *        - default `slat`: white X mark with a coloured X on top.
 *   3. Markers thinned when `showInfill === false` — only first + last
 *      remain (matches legacy "endpoints only" mode).
 *   4. Selection chrome: dots on the endpoints + centered length label
 *      (same shape as the wall builder).
 *
 * `getFloorplanFenceMarkerTs` is inlined here — it was a private helper
 * in the legacy panel and is fence-specific, so it lives with the kind.
 */

// The tangent handle arm is drawn this many times longer than the raw curve
// handle vector so it's easy to grab on screen even at the default (small)
// tangent. The `move-tangent` affordance divides this factor back out so the
// stored tangent matches the visual arm length. Must stay in sync with the
// 3D tool's arm scale.
const TANGENT_HANDLE_ARM_SCALE = 3

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getFloorplanFenceLength(fence: FenceNode): number {
  if (isSplineFence(fence) || isCurvedWall(fence)) {
    return getFenceCenterlineLength(fence)
  }
  return Math.hypot(fence.end[0] - fence.start[0], fence.end[1] - fence.start[1])
}

/**
 * Distribute markers along the fence centerline. Spacing depends on
 * `postSpacing` (tighter for privacy style); `inset` keeps the first /
 * last marker away from the endpoints. Returns a list of t-values in
 * [0, 1] suitable for `getWallCurveFrameAt`.
 */
function getFloorplanFenceMarkerTs(fence: FenceNode): number[] {
  const length = getFloorplanFenceLength(fence)
  if (length <= 0.24) return [0.5]

  const spacing = clamp(
    fence.style === 'privacy' ? fence.postSpacing * 0.72 : fence.postSpacing,
    0.34,
    1.5,
  )
  const inset = clamp(
    Math.max(fence.postSize * 1.25, fence.edgeInset * 10),
    0.18,
    Math.min(0.48, length * 0.22),
  )
  const usableLength = Math.max(length - inset * 2, 0)
  if (usableLength <= 0.001) return [0.5]

  const markerCount = Math.max(1, Math.min(24, Math.floor(usableLength / spacing) + 1))
  if (markerCount === 1) return [0.5]

  return Array.from({ length: markerCount }, (_, index) =>
    clamp((inset + (usableLength * index) / (markerCount - 1)) / length, 0.08, 0.92),
  )
}

function buildCenterlinePathD(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length < 2) return ''
  const first = points[0]!
  return [`M ${first.x} ${first.y}`, ...points.slice(1).map((p) => `L ${p.x} ${p.y}`)].join(' ')
}

function buildMarker(
  fence: FenceNode,
  point: { x: number; y: number },
  angleRadians: number,
  accentColor: string,
  surfaceColor: string,
  isActive: boolean,
): FloorplanGeometry {
  const markerStrokeWidth = isActive ? 1.65 : 1.35

  if (fence.style === 'privacy' || fence.style === 'horizontal') {
    const w = clamp(fence.postSize * 0.58, 0.038, 0.068)
    const h = clamp(Math.max(fence.baseHeight * 0.5, fence.postSize * 1.4), 0.1, 0.17)
    // Surface plate underneath + accent rectangle on top — gives a clean
    // "punched out of the underlay stroke" look at all zooms.
    return {
      kind: 'group',
      transform: { translate: [point.x, point.y], rotate: angleRadians },
      children: [
        {
          kind: 'rect',
          x: -(w + 0.032) / 2,
          y: -(h + 0.038) / 2,
          width: w + 0.032,
          height: h + 0.038,
          rx: 0.014,
          ry: 0.014,
          fill: surfaceColor,
        },
        {
          kind: 'rect',
          x: -w / 2,
          y: -h / 2,
          width: w,
          height: h,
          rx: 0.01,
          ry: 0.01,
          fill: accentColor,
        },
      ],
    }
  }

  if (fence.style === 'rail') {
    const r = clamp(fence.postSize * 0.52, 0.048, 0.078)
    return {
      kind: 'group',
      transform: { translate: [point.x, point.y] },
      children: [
        { kind: 'circle', cx: 0, cy: 0, r: r + 0.018, fill: surfaceColor },
        {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r,
          fill: surfaceColor,
          stroke: accentColor,
          strokeWidth: markerStrokeWidth,
          vectorEffect: 'non-scaling-stroke',
        },
        {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: r * 0.34,
          fill: accentColor,
          fillOpacity: isActive ? 0.24 : 0.18,
          vectorEffect: 'non-scaling-stroke',
        },
      ],
    }
  }

  // Default — slat X mark.
  const half = clamp(fence.postSize * 0.42, 0.03, 0.055)
  return {
    kind: 'group',
    transform: { translate: [point.x, point.y], rotate: angleRadians },
    children: [
      // White underlay so the X shows against any background.
      {
        kind: 'line',
        x1: -half,
        y1: -half,
        x2: half,
        y2: half,
        stroke: surfaceColor,
        strokeWidth: 2.8,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'line',
        x1: half,
        y1: -half,
        x2: -half,
        y2: half,
        stroke: surfaceColor,
        strokeWidth: 2.8,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      },
      // Accent X on top.
      {
        kind: 'line',
        x1: -half,
        y1: -half,
        x2: half,
        y2: half,
        stroke: accentColor,
        strokeWidth: markerStrokeWidth,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'line',
        x1: half,
        y1: -half,
        x2: -half,
        y2: half,
        stroke: accentColor,
        strokeWidth: markerStrokeWidth,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      },
    ],
  }
}

export function buildFenceFloorplan(node: FenceNode, ctx: GeometryContext): FloorplanGeometry {
  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const isHovered = view?.hovered ?? false
  const isActive = isSelected || isHighlighted
  const showInteractiveChrome = isActive || isHovered

  // Centerline path — sampled for spline / arc fences so the underlay /
  // accent / glow all trace the same shape.
  const centerlinePoints =
    isSplineFence(node) || isCurvedWall(node)
      ? sampleFenceCenterline(node, 24)
      : [
          { x: node.start[0], y: node.start[1] },
          { x: node.end[0], y: node.end[1] },
        ]
  const pathD = buildCenterlinePathD(centerlinePoints)

  // Stroke shifts: selected wins; hover (not selected) → `wallHoverStroke`
  // (light blue from the legacy palette, same as walls); otherwise dark
  // accent. Mirrors the `fenceStroke` ternary in the legacy panel.
  const accentStroke =
    isActive && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : '#111827'
  const glowStroke =
    isActive && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : accentStroke
  const underlayStroke = 'rgba(255, 255, 255, 0.98)'
  // Surface (white) for marker plates — themed dark surface would look
  // wrong on the white underlay, so we hardcode white here.
  const markerSurface = '#ffffff'

  // Widths step up on hover (between idle and active) — same pattern the
  // legacy panel uses for `fenceUnderlayWidth` / `fenceStrokeWidth`.
  const underlayWidth = isActive ? 6.5 : isHovered ? 6 : 5.2
  const accentWidth = isActive ? 2.6 : isHovered ? 2.35 : 2.05
  // Glow only appears when active or hovered. Opacity gradient matches
  // the legacy (0.22 active / 0.14 hover / 0 idle).
  const glowOpacity = isActive ? 0.22 : isHovered ? 0.14 : 0

  // Marker frames. Filter to first+last when infill is off so the user
  // still sees end posts (matches legacy).
  const markerTs = getFloorplanFenceMarkerTs(node)
  const markerFrames = markerTs.map((t) => {
    const frame = getFenceCenterlineFrameAt(node, t)
    return {
      point: frame.point,
      angle: Math.atan2(frame.tangent.y, frame.tangent.x),
    }
  })
  const visibleMarkers =
    (node.showInfill ?? true)
      ? markerFrames
      : markerFrames.filter((_, i) => i === 0 || i === markerFrames.length - 1)

  const children: FloorplanGeometry[] = []

  // 1. Glow (only when active / highlighted / hovered). Wide,
  // low-opacity ring. Width steps with the interaction level so hover
  // is subtler than active.
  if (glowOpacity > 0) {
    children.push({
      kind: 'path',
      d: pathD,
      fill: 'none',
      stroke: glowStroke,
      strokeWidth: isActive ? 9.5 : isHovered ? 8.8 : 8.2,
      strokeOpacity: glowOpacity,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
    })
  }

  // 2. White underlay — visible fence body base layer.
  children.push({
    kind: 'path',
    d: pathD,
    fill: 'none',
    stroke: underlayStroke,
    strokeOpacity: 0.98,
    strokeWidth: underlayWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
  })

  // 3. Dark accent on top.
  children.push({
    kind: 'path',
    d: pathD,
    fill: 'none',
    stroke: accentStroke,
    strokeWidth: accentWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
  })

  // 4. Style-aware markers. Pass `showInteractiveChrome` so hover also
  // bumps marker stroke widths slightly (legacy panel does the same).
  for (const marker of visibleMarkers) {
    children.push(
      buildMarker(
        node,
        marker.point,
        marker.angle,
        accentStroke,
        markerSurface,
        showInteractiveChrome,
      ),
    )
  }

  // 5. Hit-line(s) for click detection. A straight/arc fence uses a single
  // chord-spanning line; a spline fence emits one short hit-line per sampled
  // span so the clickable region follows the curve instead of cutting the
  // chord (there's no curved `hit-path` primitive yet).
  if (isSplineFence(node)) {
    for (let i = 1; i < centerlinePoints.length; i += 1) {
      const a = centerlinePoints[i - 1]!
      const b = centerlinePoints[i]!
      children.push({
        kind: 'hit-line',
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        strokeWidthPx: 18,
        cursor: 'pointer',
      })
    }
  } else {
    children.push({
      kind: 'hit-line',
      x1: node.start[0],
      y1: node.start[1],
      x2: node.end[0],
      y2: node.end[1],
      strokeWidthPx: 18,
      cursor: 'pointer',
    })
  }

  // 6. Endpoint handles + side move-arrows + curve handle + length when
  //    selected. Mirrors the wall builder so fences gain the same set of
  //    in-plan affordances (drag endpoints, drag body via either side
  //    arrow, drag the midpoint sagitta to curve).
  if (isSelected) {
    if (isSplineFence(node) && node.path) {
      // Spline fence: per control point draw (a) the symmetric tangent line
      // through the point with a small handle dot on each end — dragging an
      // end bends the curve on both sides via `move-tangent` — and (b) the
      // larger control-point dot itself, which moves the point.
      for (let i = 0; i < node.path.length; i += 1) {
        const point = node.path[i]!
        const handle = getFenceControlHandle(node.path, node.tangents, i)
        // Scale the on-screen handle arm so even the default (small) tangent
        // is grabbable; the affordance divides this back out on apply.
        const armX = handle.x * TANGENT_HANDLE_ARM_SCALE
        const armY = handle.y * TANGENT_HANDLE_ARM_SCALE
        const out: [number, number] = [point[0] + armX, point[1] + armY]
        const inn: [number, number] = [point[0] - armX, point[1] - armY]

        // Connecting line (the "tangent" through the point). Violet to match
        // the 3D tangent line + the handle dots.
        children.push({
          kind: 'line',
          x1: inn[0],
          y1: inn[1],
          x2: out[0],
          y2: out[1],
          stroke: '#8381ed',
          strokeWidth: 1.25,
          strokeOpacity: 0.85,
          vectorEffect: 'non-scaling-stroke',
        })
        // Handle dot on each end. Both drive the same `move-tangent`
        // affordance; `side` tells it which end is being dragged so the
        // stored OUT vector gets the correct sign.
        children.push({
          kind: 'endpoint-handle',
          point: out,
          state: 'idle',
          variant: 'curve',
          affordance: 'move-tangent',
          payload: { fenceId: node.id, index: i, side: 'out' as const },
        })
        children.push({
          kind: 'endpoint-handle',
          point: inn,
          state: 'idle',
          variant: 'curve',
          affordance: 'move-tangent',
          payload: { fenceId: node.id, index: i, side: 'in' as const },
        })
        // The control-point dot last so it sits on top of the tangent line.
        children.push({
          kind: 'endpoint-handle',
          point: [point[0], point[1]],
          state: 'idle',
          affordance: 'move-control-point',
          payload: { fenceId: node.id, index: i },
        })
      }
    } else {
      children.push({
        kind: 'endpoint-handle',
        point: [node.start[0], node.start[1]],
        state: 'idle',
        affordance: 'move-endpoint',
        payload: { fenceId: node.id, endpoint: 'start' as const },
      })
      children.push({
        kind: 'endpoint-handle',
        point: [node.end[0], node.end[1]],
        state: 'idle',
        affordance: 'move-endpoint',
        payload: { fenceId: node.id, endpoint: 'end' as const },
      })
    }

    // Two perpendicular `move-arrow` chevrons at the fence midpoint.
    // No `affordance` → the registry layer routes pointer-down through
    // `setMovingNode`, which the `FloorplanRegistryMoveOverlay` picks
    // up and runs through `def.floorplanMoveTarget` (see
    // `fence/floorplan-move.ts`). Sized in plan-units like the wall
    // counterpart so they shrink / grow with zoom.
    {
      const dx = node.end[0] - node.start[0]
      const dz = node.end[1] - node.start[1]
      const lineLength = Math.hypot(dx, dz)
      if (lineLength > 1e-6) {
        const frame =
          isSplineFence(node) || isCurvedWall(node) ? getFenceCenterlineFrameAt(node, 0.5) : null
        const midX = frame ? frame.point.x : (node.start[0] + node.end[0]) / 2
        const midZ = frame ? frame.point.y : (node.start[1] + node.end[1]) / 2
        const nx = frame ? frame.normal.x : -dz / lineLength
        const nz = frame ? frame.normal.y : dx / lineLength
        const offset = (node.thickness ?? 0.08) / 2 + 0.05
        children.push({
          kind: 'move-arrow',
          point: [midX + nx * offset, midZ + nz * offset],
          angle: Math.atan2(nz, nx),
        })
        children.push({
          kind: 'move-arrow',
          point: [midX - nx * offset, midZ - nz * offset],
          angle: Math.atan2(-nz, -nx),
        })
      }
    }

    // Curve sagitta handle — teal dot at the visual midpoint that drives
    // `curveOffset`. Routes through `fenceCurveAffordance`. Fences host
    // no children, so there's no equivalent of wall's curve-blocking
    // check to gate this. Suppressed for spline fences: the single sagitta
    // is meaningless against a multi-point curve.
    if (!isSplineFence(node)) {
      const curveHandle = getWallMidpointHandlePoint(node)
      children.push({
        kind: 'endpoint-handle',
        point: [curveHandle.x, curveHandle.y],
        state: 'idle',
        variant: 'curve',
        affordance: 'curve',
        payload: { fenceId: node.id },
      })
    }

    const length = getFloorplanFenceLength(node)
    if (length >= 0.1) {
      const labelFrame =
        isSplineFence(node) || isCurvedWall(node) ? getFenceCenterlineFrameAt(node, 0.5) : null
      const midX = labelFrame ? labelFrame.point.x : (node.start[0] + node.end[0]) / 2
      const midZ = labelFrame ? labelFrame.point.y : (node.start[1] + node.end[1]) / 2
      const angle = labelFrame
        ? Math.atan2(labelFrame.tangent.y, labelFrame.tangent.x)
        : Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
      children.push({
        kind: 'dimension-label',
        cx: midX,
        cy: midZ,
        text: `${Number.parseFloat(length.toFixed(2))}m`,
        angle,
      })
    }
  }

  return { kind: 'group', children }
}
