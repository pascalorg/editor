import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { floorplanDrawContext, type UtilitiesDrawContext } from '../draw-context'
import { longestSegmentMidpoint, type PlanPoint, spacedLabelPoints } from '../geometry/labels'
import { lineLength, metresToFeet } from '../geometry/totals'
import { utilitiesLayerMetadata } from '../layer'
import type { UtilityLineNode } from '../schema'
import { SYSTEM_COLOR, SYSTEM_LETTER } from '../schema'

/** Plan tag spacing along an underground run, metres (≈ 26 ft). */
const LETTER_SPACING = 8
/** Blank margin at each end of a run so a tag never sits on a symbol. */
const LETTER_MARGIN = 1.2
const TEXT_SIZE = 0.55
const STROKE = 0.11

/**
 * Plan symbol for a utility run.
 *
 * OVERHEAD  — a solid line in the system's APWA colour, broken once at the
 *             middle of its longest span for an `— OH —` tag.
 * UNDERGROUND — a dashed line with the system letter (E/S/W/G/T/D) repeated
 *             along it, plus the size callout at the run midpoint.
 *
 * Coordinates: the node stores SITE metres; the floor-plan layer draws in
 * building-local metres, so every vertex goes through `siteToLocalPlan`.
 * See `site-frame.ts` for why.
 */
export function drawUtilityLine(
  node: UtilityLineNode,
  dctx: UtilitiesDrawContext,
): FloorplanGeometry | null {
  if (node.path.length < 2) return null
  const plan: PlanPoint[] = node.path.map((p) => dctx.toPlan([p[0], p[2]]))

  const view = dctx.view
  const selected = (view?.selected ?? false) || (view?.highlighted ?? false)
  const base = SYSTEM_COLOR[node.system]
  const stroke = selected && view?.palette ? view.palette.selectedStroke : base
  const overhead = node.routing === 'overhead'

  const children: FloorplanGeometry[] = [
    { kind: 'hit-line', ...segmentSpan(plan), strokeWidthPx: 12 },
    {
      kind: 'polyline',
      points: plan,
      fill: 'none',
      stroke,
      strokeWidth: STROKE,
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
      ...(overhead ? {} : { strokeDasharray: '0.9 0.5' }),
    },
  ]

  // Every intermediate segment beyond the first also needs a hit target.
  for (let i = 1; i < plan.length - 1; i++) {
    const a = plan[i] as PlanPoint
    const b = plan[i + 1] as PlanPoint
    children.push({
      kind: 'hit-line',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      strokeWidthPx: 12,
    })
  }

  if (overhead) {
    const site = longestSegmentMidpoint(plan)
    if (site) {
      children.push(
        // Knock the line out behind the tag so `— OH —` reads as a break.
        {
          kind: 'circle',
          cx: site.point[0],
          cy: site.point[1],
          r: TEXT_SIZE * 1.15,
          fill: '#ffffff',
          fillOpacity: 0.92,
          stroke: 'none',
        },
        {
          kind: 'text',
          x: site.point[0],
          y: site.point[1],
          text: '— OH —',
          fontSize: TEXT_SIZE,
          fill: stroke,
          fontWeight: 700,
          textAnchor: 'middle',
          dominantBaseline: 'middle',
          upright: true,
        },
      )
    }
  } else {
    for (const site of spacedLabelPoints(plan, LETTER_SPACING, LETTER_MARGIN)) {
      children.push(
        {
          kind: 'circle',
          cx: site.point[0],
          cy: site.point[1],
          r: TEXT_SIZE * 0.8,
          fill: '#ffffff',
          fillOpacity: 0.92,
          stroke: 'none',
        },
        {
          kind: 'text',
          x: site.point[0],
          y: site.point[1],
          text: SYSTEM_LETTER[node.system],
          fontSize: TEXT_SIZE,
          fill: stroke,
          fontWeight: 700,
          textAnchor: 'middle',
          dominantBaseline: 'middle',
          upright: true,
        },
      )
    }
  }

  const callout = calloutText(node)
  if (callout) {
    const site = longestSegmentMidpoint(plan)
    if (site) {
      // Offset to the left of travel so the callout clears the run itself.
      const nx = site.tangent[1]
      const ny = -site.tangent[0]
      children.push({
        kind: 'text',
        x: site.point[0] + nx * TEXT_SIZE * 1.9,
        y: site.point[1] + ny * TEXT_SIZE * 1.9,
        text: callout,
        fontSize: TEXT_SIZE * 0.85,
        fill: stroke,
        fontWeight: 600,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
        upright: true,
      })
    }
  }

  if (selected) {
    plan.forEach((point, index) => {
      children.push({
        kind: 'endpoint-handle',
        point,
        state: 'idle',
        affordance: 'move-utility-line-vertex',
        payload: { index },
      })
    })
  }

  return utilitiesLayerMetadata({ kind: 'group', children })
}

/** `def.floorplan` entry point — output in building-local metres. */
export function buildUtilityLineFloorplan(
  node: UtilityLineNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  return drawUtilityLine(node, floorplanDrawContext(node as unknown as Record<string, unknown>, ctx))
}

/** The size / material / length callout drawn beside a run. */
export function calloutText(node: UtilityLineNode): string {
  const bits: string[] = []
  if (node.sizeInches) bits.push(`${formatInches(node.sizeInches)}"`)
  if (node.material) bits.push(node.material.toUpperCase())
  const feet = metresToFeet(lineLength(node))
  if (feet > 0) bits.push(`${Math.round(feet)} LF`)
  if (node.routing === 'underground') {
    const depth = burialDepth(node)
    if (depth > 0) bits.push(`${Math.round(metresToFeet(depth) * 12)}" COVER`)
  }
  if (node.label) bits.unshift(node.label)
  return bits.join(' · ')
}

/** Deepest (most negative) vertex of a buried run, reported as a POSITIVE cover. */
export function burialDepth(node: UtilityLineNode): number {
  let deepest = 0
  for (const point of node.path) if (point[1] < deepest) deepest = point[1]
  return -deepest
}

/** 0.75 → `3/4`, 4 → `4`. Utility sizes are called out in fractional inches. */
export function formatInches(value: number): string {
  const whole = Math.floor(value)
  const fraction = value - whole
  if (fraction < 1e-6) return String(whole)
  for (const denominator of [2, 4, 8, 16]) {
    const numerator = Math.round(fraction * denominator)
    if (Math.abs(fraction - numerator / denominator) < 1e-6) {
      return whole > 0 ? `${whole}-${numerator}/${denominator}` : `${numerator}/${denominator}`
    }
  }
  return value.toFixed(2)
}

function segmentSpan(plan: readonly PlanPoint[]): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  const a = plan[0] as PlanPoint
  const b = (plan[1] ?? plan[0]) as PlanPoint
  return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }
}
