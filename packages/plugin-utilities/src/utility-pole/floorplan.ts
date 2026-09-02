import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { polePlan } from '../utility-line/endpoints'
import { floorplanDrawContext, type UtilitiesDrawContext } from '../draw-context'
import { utilitiesLayerMetadata } from '../layer'
import type { UtilityPoleNode } from '../schema'
import { SYSTEM_COLOR } from '../schema'
import { crossarmAxis, POLE_CROSSARM_LENGTH } from './geometry'

const SYMBOL_RADIUS = 0.45
const STROKE = 0.07
const TEXT_SIZE = 0.5
/** Plan length of the down-guy leader, metres. */
const GUY_LENGTH = 2.4

/**
 * The standard utility-pole plan symbol: a circle with a cross through it
 * (the cross arms extend a little past the circle, which is how the symbol
 * is drawn on civil sheets so it stays readable at small scale). A pole
 * carrying a transformer gets a second, concentric ring; a guyed pole gets a
 * leader with a tick at the anchor.
 *
 * Drawn in APWA red — a pole is an electric-power facility.
 */
export function drawUtilityPole(
  node: UtilityPoleNode,
  dctx: UtilitiesDrawContext,
): FloorplanGeometry | null {
  const [cx, cy] = dctx.toPlan(polePlan(node))

  const view = dctx.view
  const selected = (view?.selected ?? false) || (view?.highlighted ?? false)
  const stroke = selected && view?.palette ? view.palette.selectedStroke : SYSTEM_COLOR.power

  const arm = SYMBOL_RADIUS * 1.45
  const children: FloorplanGeometry[] = [
    {
      kind: 'circle',
      cx,
      cy,
      r: SYMBOL_RADIUS,
      fill: '#ffffff',
      fillOpacity: 0.9,
      stroke,
      strokeWidth: STROKE,
    },
    { kind: 'line', x1: cx - arm, y1: cy, x2: cx + arm, y2: cy, stroke, strokeWidth: STROKE },
    { kind: 'line', x1: cx, y1: cy - arm, x2: cx, y2: cy + arm, stroke, strokeWidth: STROKE },
  ]

  // The crossarm itself, drawn along `yaw` — without it the plan symbol gives
  // no feedback at all for the R / T rotate, and the run leaves the arm at a
  // pin the plan does not show.
  const armAxis = crossarmAxis(node.yaw)
  const armHalf = POLE_CROSSARM_LENGTH / 2
  children.push({
    kind: 'line',
    x1: cx - armAxis[0] * armHalf,
    y1: cy - armAxis[1] * armHalf,
    x2: cx + armAxis[0] * armHalf,
    y2: cy + armAxis[1] * armHalf,
    stroke,
    strokeWidth: STROKE * 1.4,
    strokeLinecap: 'round',
  })

  if (node.hasTransformer) {
    children.push({
      kind: 'circle',
      cx,
      cy,
      r: SYMBOL_RADIUS * 0.5,
      fill: 'none',
      stroke,
      strokeWidth: STROKE,
    })
  }

  const guy = guyVector(node.guy)
  if (guy) {
    const ax = cx + guy[0] * GUY_LENGTH
    const ay = cy + guy[1] * GUY_LENGTH
    children.push(
      { kind: 'line', x1: cx, y1: cy, x2: ax, y2: ay, stroke, strokeWidth: STROKE * 0.7 },
      // Anchor tick, perpendicular to the guy.
      {
        kind: 'line',
        x1: ax - guy[1] * 0.3,
        y1: ay + guy[0] * 0.3,
        x2: ax + guy[1] * 0.3,
        y2: ay - guy[0] * 0.3,
        stroke,
        strokeWidth: STROKE,
      },
    )
  }

  const caption = [node.label, node.classLabel, node.hasTransformer ? 'XFMR' : '']
    .filter(Boolean)
    .join(' · ')
  if (caption) {
    children.push({
      kind: 'text',
      x: cx,
      y: cy - SYMBOL_RADIUS * 2.1,
      text: caption,
      fontSize: TEXT_SIZE,
      fill: stroke,
      fontWeight: 600,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      upright: true,
    })
  }

  children.push({
    kind: 'hit-line',
    x1: cx - SYMBOL_RADIUS,
    y1: cy,
    x2: cx + SYMBOL_RADIUS,
    y2: cy,
    strokeWidthPx: 18,
  })

  return utilitiesLayerMetadata({ kind: 'group', children })
}

/** `def.floorplan` entry point — output in building-local metres. */
export function buildUtilityPoleFloorplan(
  node: UtilityPoleNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  return drawUtilityPole(
    node,
    floorplanDrawContext(node as unknown as Record<string, unknown>, ctx),
  )
}

/** Plan unit vector for a guy direction. x east, y(z) south. */
export function guyVector(guy: UtilityPoleNode['guy']): [number, number] | null {
  switch (guy) {
    case 'north':
      return [0, -1]
    case 'south':
      return [0, 1]
    case 'east':
      return [1, 0]
    case 'west':
      return [-1, 0]
    default:
      return null
  }
}
