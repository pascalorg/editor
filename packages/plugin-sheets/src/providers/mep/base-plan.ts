/**
 * The architectural background an MEP sheet is drawn ON.
 *
 * A trade plan is the SAME floor plan as A2.0 — walls, doors, windows, room
 * names — screened back so the devices read on top of it. It is collected
 * through the host's own `collectSheetGeometry`, the identical call
 * `resolvePlan` makes for the floor-plan viewport, so the background can
 * never drift from the architectural sheet: one geometry source, two sheets.
 *
 * Furniture, the Bones kinds and the site-utility kinds are excluded — the
 * trade's own symbols are drawn by the provider, and drawing the host's
 * versions underneath would double every device.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import * as editor from '@pascal-app/editor'
import { type Bounds, EMPTY_BOUNDS, geometryListBounds, isEmpty } from '../../bounds'
import { annotationVisibility } from '../../drawings'
import type { NodeMap } from '../../model'
import type { ViewportLayers } from '../../schema'

/** Kinds the trade sheets never take from the host. */
const EXCLUDED_TYPES = new Set([
  'item',
  'shelf',
  'cabinet',
  'cabinet-module',
  'duct-segment',
  'duct-fitting',
  'duct-terminal',
  'hvac-equipment',
  'lineset',
  'liquid-line',
  'pipe-segment',
  'pipe-fitting',
  'pipe-trap',
  'roof',
  'roof-segment',
])

function acceptForBasePlan(type: string, category: string | undefined): boolean {
  if (EXCLUDED_TYPES.has(type)) return false
  if (type.startsWith('bones:')) return false
  if (type.startsWith('utilities:')) return false
  if (type === 'service-point' || type === 'utility-line' || type === 'utility-pole') return false
  if (type === 'terrain' || type === 'scan') return false
  if (category === 'analysis') return false
  return true
}

/** Primitive kinds that carry paint and therefore take the screen-back. */
const FADEABLE = new Set([
  'path',
  'polygon',
  'polyline',
  'rect',
  'circle',
  'line',
  'text',
  'image',
  'hatch',
])

/**
 * Screen a geometry tree back. `group` carries no opacity in the primitive
 * union, so the fade is pushed down onto the leaves — multiplied into any
 * opacity the host already set, so a light hatch stays lighter than a wall.
 *
 * STROKE AND FILL FADE SEPARATELY, and that is the whole point. A floor plan
 * carries big filled areas — zone tints, door swing arcs, the slab — that a
 * uniform screen-back turns into grey blobs the devices disappear into. The
 * trade sheet wants the LINEWORK: strokes stay readable, fills drop to a
 * hint, and a receptacle on a bedroom wall reads against the wall rather than
 * against a swing arc.
 */
export function fade(
  geometry: FloorplanGeometry,
  strokeFactor: number,
  fillFactor = strokeFactor * 0.3,
  strokeCapM = HAIRLINE_M,
): FloorplanGeometry {
  if (geometry.kind === 'group') {
    return {
      ...geometry,
      children: geometry.children.map((child) => fade(child, strokeFactor, fillFactor, strokeCapM)),
    }
  }
  // Handles and hit targets carry no paint; leave them exactly as they are.
  if (!FADEABLE.has(geometry.kind)) return geometry
  if (geometry.kind === 'text' || geometry.kind === 'hatch' || geometry.kind === 'image') {
    const current = typeof geometry.opacity === 'number' ? geometry.opacity : 1
    return { ...geometry, opacity: current * strokeFactor } as FloorplanGeometry
  }
  const styled = geometry as FloorplanGeometry & {
    fillOpacity?: number
    strokeOpacity?: number
    strokeWidth?: number
    vectorEffect?: string
  }
  const fill = typeof styled.fillOpacity === 'number' ? styled.fillOpacity : 1
  const stroke = typeof styled.strokeOpacity === 'number' ? styled.strokeOpacity : 1
  // A door leaf and a window sash are drawn with a stroke as wide as the wall
  // they sit in — on screen that reads as the opening, but screened back on a
  // trade plan it reads as a grey slab the devices vanish into. Background
  // strokes are capped to a hairline. `non-scaling-stroke` widths are SCREEN
  // pixels, not metres, so they are left alone.
  const width =
    styled.vectorEffect === 'non-scaling-stroke' || typeof styled.strokeWidth !== 'number'
      ? styled.strokeWidth
      : Math.min(styled.strokeWidth, strokeCapM)
  return {
    ...geometry,
    ...(width === undefined ? {} : { strokeWidth: width }),
    fillOpacity: fill * fillFactor,
    strokeOpacity: stroke * strokeFactor,
  } as FloorplanGeometry
}

/** Background stroke cap, world metres — ~1.5 pt of paper at 1/4" = 1'-0". */
const HAIRLINE_M = 0.025

export type BasePlan = {
  /** Null when the host drew nothing (no level geometry, or an empty registry). */
  geometry: FloorplanGeometry | null
  bounds: Bounds
  /** Room-label centres, so device tags can dodge them. */
  labelSpots: { x: number; y: number }[]
}

/**
 * The screened-back architectural background for `levelId`.
 *
 * Annotation primitives (dimension strings) are dropped outright: a trade
 * plan is dimensioned by the architectural sheet, and the dimension renderer
 * sizes its text off the ANNOTATION channel, which a provider result routes
 * separately anyway.
 */
export function basePlan(
  nodes: NodeMap,
  levelId: string,
  layers: ViewportLayers,
  opacity = 0.4,
): BasePlan {
  let entries: { model: FloorplanGeometry | null }[] = []
  try {
    entries = editor.collectSheetGeometry({
      nodes: nodes as never,
      levelId: levelId as never,
      drawingType: 'floor-plan' as never,
      annotationVisibility: {
        ...annotationVisibility(layers),
        automaticDimensions: false,
        contextualDimensions: false,
        manualDimensions: false,
        measurements: false,
      },
      accept: (node, category) => acceptForBasePlan(node.type, category),
    }) as unknown as { model: FloorplanGeometry | null }[]
  } catch {
    return { geometry: null, bounds: EMPTY_BOUNDS, labelSpots: [] }
  }
  const models = entries.map((e) => e.model).filter((m): m is FloorplanGeometry => m !== null)
  if (models.length === 0) return { geometry: null, bounds: EMPTY_BOUNDS, labelSpots: [] }
  const bounds = geometryListBounds(models)
  const children = [fade({ kind: 'group', children: models }, opacity)]
  const labels = layers.roomLabels ? roomLabels(nodes, levelId) : []
  children.push(...labels)
  return {
    geometry: { kind: 'group', children },
    bounds: isEmpty(bounds) ? EMPTY_BOUNDS : bounds,
    labelSpots: labels.map((label) => ({
      x: (label as { x: number }).x,
      y: (label as { y: number }).y,
    })),
  }
}

/**
 * Room names, drawn from the level's `zone` nodes.
 *
 * The host's zone geometry carries the room's FILL but not its NAME — the
 * name is drawn by a separate 2D layer that a sheet never mounts, so a trade
 * plan collected through `collectSheetGeometry` comes back with unlabelled
 * rooms. A plans examiner reads a trade sheet room by room, so the names are
 * drawn here from the same nodes the fills came from.
 */
export function roomLabels(nodes: NodeMap, levelId: string): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'zone' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const name = typeof node.name === 'string' ? node.name.trim() : ''
    if (!name) continue
    const polygon = node.polygon
    if (!Array.isArray(polygon) || polygon.length < 3) continue
    const centre = polygonCentroid(polygon as [number, number][])
    if (!centre) continue
    // Ceiling devices — the light, the smoke alarm — are placed AT the room
    // centroid, which is exactly where a centred room name would land. The
    // name steps off the centroid to the first clear side that is still
    // inside the room.
    const spot = stepOffCentroid(centre, polygon as [number, number][], LABEL_OFFSET_M)
    out.push({
      kind: 'text',
      x: spot[0],
      y: spot[1],
      text: name.toUpperCase(),
      fontSize: 0.19,
      fill: '#475569',
      fontWeight: 700,
      fontFamily: 'Helvetica, Arial, sans-serif',
      textAnchor: 'middle',
      opacity: 0.75,
    })
  }
  return out
}

/** How far a room name steps off the centroid to clear the ceiling devices. */
const LABEL_OFFSET_M = 0.62

/** The first offset of the centroid that is still inside the room. */
function stepOffCentroid(
  centre: [number, number],
  polygon: readonly [number, number][],
  distance: number,
): [number, number] {
  for (const [dx, dy] of [
    [0, distance],
    [0, -distance],
    [distance, 0],
    [-distance, 0],
  ] as const) {
    const candidate: [number, number] = [centre[0] + dx, centre[1] + dy]
    if (pointInPolygon(candidate, polygon)) return candidate
  }
  return centre
}

function pointInPolygon(p: [number, number], polygon: readonly [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (!a || !b) continue
    const straddles = a[1] > p[1] !== b[1] > p[1]
    if (!straddles) continue
    const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    if (p[0] < x) inside = !inside
  }
  return inside
}

/** Area centroid, falling back to the vertex mean for a degenerate ring. */
function polygonCentroid(polygon: readonly [number, number][]): [number, number] | null {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (!a || !b) continue
    const cross = b[0] * a[1] - a[0] * b[1]
    area += cross
    cx += (a[0] + b[0]) * cross
    cy += (a[1] + b[1]) * cross
  }
  if (Math.abs(area) < 1e-9) {
    const n = polygon.length
    if (n === 0) return null
    return [
      polygon.reduce((s, p) => s + p[0], 0) / n,
      polygon.reduce((s, p) => s + p[1], 0) / n,
    ]
  }
  return [cx / (3 * area), cy / (3 * area)]
}
