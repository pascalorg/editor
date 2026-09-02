import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { resolveServicePoint } from '../anchor'
import { floorplanDrawContext, type UtilitiesDrawContext } from '../draw-context'
import { utilitiesLayerMetadata } from '../layer'
import type { ServicePointNode } from '../schema'
import { SERVICE_POINT_ABBR, SERVICE_POINT_SYSTEM, SYSTEM_COLOR } from '../schema'
import { localToSite, type LooseNode, siteToLocal } from '../site-frame'

const R = 0.34
const STROKE = 0.06
const TEXT_SIZE = 0.42

/**
 * Plan symbols for the building/utility interface points.
 *
 * The shapes follow common electrical / civil plan conventions:
 *   meter (electric / water / gas) — circle with the abbreviation beside it,
 *     the standard meter symbol;
 *   panel                          — filled rectangle (the panelboard block);
 *   cleanout                       — circle with a cross (`CO`), the standard
 *     sanitary cleanout mark;
 *   entry / exit / NID             — a small square, the generic device box.
 * The abbreviation is always drawn — none of these symbols is unambiguous on
 * its own at plan scale.
 *
 * Colour is the APWA colour of the system the point belongs to.
 *
 * The position round-trip matters: a wall-anchored point resolves in
 * BUILDING-LOCAL metres (that is the frame `wall.start` / `wall.end` live
 * in), is lifted back to SITE metres, and only then goes through
 * `dctx.toPlan` — so the same symbol lands in the right place whether the
 * caller wants floor-plan or site-plan coordinates.
 */
export function drawServicePoint(
  node: ServicePointNode,
  dctx: UtilitiesDrawContext,
): FloorplanGeometry | null {
  const nodes = node.wallId
    ? (() => {
        const wall = dctx.resolve(node.wallId)
        return wall ? { [node.wallId]: wall } : {}
      })()
    : {}
  const resolved = resolveServicePoint(nodes, node, (position) =>
    siteToLocal(dctx.frame, position),
  )
  const site = localToSite(dctx.frame, resolved.local)
  const [cx, cy] = dctx.toPlan([site[0], site[2]])

  const view = dctx.view
  const selected = (view?.selected ?? false) || (view?.highlighted ?? false)
  const system = SERVICE_POINT_SYSTEM[node.serviceKind]
  const stroke = selected && view?.palette ? view.palette.selectedStroke : SYSTEM_COLOR[system]

  const children: FloorplanGeometry[] = []
  switch (node.serviceKind) {
    case 'electric-meter':
    case 'water-meter':
    case 'gas-meter':
      children.push({
        kind: 'circle',
        cx,
        cy,
        r: R,
        fill: '#ffffff',
        fillOpacity: 0.9,
        stroke,
        strokeWidth: STROKE,
      })
      break
    case 'panel':
      children.push({
        kind: 'rect',
        x: cx - R * 1.1,
        y: cy - R * 0.65,
        width: R * 2.2,
        height: R * 1.3,
        fill: stroke,
        fillOpacity: 0.85,
        stroke,
        strokeWidth: STROKE,
      })
      break
    case 'sewer-cleanout':
      children.push(
        {
          kind: 'circle',
          cx,
          cy,
          r: R,
          fill: '#ffffff',
          fillOpacity: 0.9,
          stroke,
          strokeWidth: STROKE,
        },
        { kind: 'line', x1: cx - R, y1: cy, x2: cx + R, y2: cy, stroke, strokeWidth: STROKE },
        { kind: 'line', x1: cx, y1: cy - R, x2: cx, y2: cy + R, stroke, strokeWidth: STROKE },
      )
      break
    default:
      children.push({
        kind: 'rect',
        x: cx - R * 0.8,
        y: cy - R * 0.8,
        width: R * 1.6,
        height: R * 1.6,
        fill: '#ffffff',
        fillOpacity: 0.9,
        stroke,
        strokeWidth: STROKE,
      })
      break
  }

  children.push(
    {
      kind: 'text',
      x: cx + R * 1.5,
      y: cy,
      text: node.label || SERVICE_POINT_ABBR[node.serviceKind],
      fontSize: TEXT_SIZE,
      fill: stroke,
      fontWeight: 700,
      textAnchor: 'start',
      dominantBaseline: 'middle',
      upright: true,
    },
    { kind: 'hit-line', x1: cx - R, y1: cy, x2: cx + R, y2: cy, strokeWidthPx: 16 },
  )

  return utilitiesLayerMetadata({ kind: 'group', children })
}

/** `def.floorplan` entry point — output in building-local metres. */
export function buildServicePointFloorplan(
  node: ServicePointNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  return drawServicePoint(node, floorplanDrawContext(node as unknown as LooseNode, ctx))
}
