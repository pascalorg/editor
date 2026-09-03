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
 */
export function fade(geometry: FloorplanGeometry, factor: number): FloorplanGeometry {
  if (geometry.kind === 'group') {
    return { ...geometry, children: geometry.children.map((child) => fade(child, factor)) }
  }
  // Handles and hit targets carry no paint; leave them exactly as they are.
  if (!FADEABLE.has(geometry.kind)) return geometry
  const styled = geometry as FloorplanGeometry & { opacity?: number }
  const current = typeof styled.opacity === 'number' ? styled.opacity : 1
  return { ...geometry, opacity: current * factor } as FloorplanGeometry
}

export type BasePlan = {
  /** Null when the host drew nothing (no level geometry, or an empty registry). */
  geometry: FloorplanGeometry | null
  bounds: Bounds
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
    return { geometry: null, bounds: EMPTY_BOUNDS }
  }
  const models = entries.map((e) => e.model).filter((m): m is FloorplanGeometry => m !== null)
  if (models.length === 0) return { geometry: null, bounds: EMPTY_BOUNDS }
  const bounds = geometryListBounds(models)
  return {
    geometry: fade({ kind: 'group', children: models }, opacity),
    bounds: isEmpty(bounds) ? EMPTY_BOUNDS : bounds,
  }
}
