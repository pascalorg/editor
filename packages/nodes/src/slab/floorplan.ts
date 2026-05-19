import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getRenderableSlabPolygon,
  type SlabNode,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for slab. Renders the slab polygon as a
 * filled path with holes cut out; when selected, overlays themed
 * chrome (accent stroke, hatch fill) plus the full boundary editor:
 *
 *   - Vertex handles on every polygon corner (orange dots).
 *   - Midpoint `+` handles between vertices to insert a new vertex.
 *   - Edge handles along each edge so the user can drag the whole
 *     edge perpendicular.
 *   - Same three handle sets for every hole in `node.holes`, with the
 *     `holeIndex` carried in each handle's payload.
 *
 * Uses `getRenderableSlabPolygon` for the visible fill (auto-slabs
 * generated from walls clip to wall footprints), but vertex / edge /
 * midpoint handles live on the **raw** `node.polygon` — matches the
 * legacy slab boundary editor which always operates on raw data.
 */
export function buildSlabFloorplan(node: SlabNode, ctx: GeometryContext): FloorplanGeometry | null {
  const polygon = node.polygon
  if (!polygon || polygon.length < 3) return null

  const visualPolygon = getRenderableSlabPolygon(node)
  if (!visualPolygon || visualPolygon.length < 3) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const outer: FloorplanPoint[] = visualPolygon.map(([x, z]) => [x, z] as FloorplanPoint)

  const ring = (points: FloorplanPoint[]) => {
    const [first, ...rest] = points
    if (!first) return ''
    return [`M ${first[0]} ${first[1]}`, ...rest.map(([x, y]) => `L ${x} ${y}`), 'Z'].join(' ')
  }
  const segments: string[] = [ring(outer)]

  const holes = node.holes ?? []
  for (const hole of holes) {
    if (hole.length < 3) continue
    const holePts: FloorplanPoint[] = hole.map(([x, z]) => [x, z] as FloorplanPoint)
    segments.push(ring(holePts))
  }

  const stroke = showSelectedChrome && palette ? palette.selectedStroke : '#475569'
  const fill = showSelectedChrome ? '#ffffff' : '#cbd5e1'

  // Slab body. Uses `fillOpacity` / `strokeOpacity` independently so the
  // outline stays crisp while the fill stays translucent — zones under
  // the slab read through, and on the selected state the hatch overlay
  // (`{ kind: 'hatch' }` below) carries the visual weight without the
  // background going opaque-white.
  const children: FloorplanGeometry[] = [
    {
      kind: 'path',
      d: segments.join(' '),
      fill,
      fillOpacity: showSelectedChrome ? 0.45 : 0.6,
      stroke,
      strokeWidth: showSelectedChrome ? 0.04 : 0.03,
      strokeOpacity: showSelectedChrome ? 0.96 : 0.85,
    },
  ]

  // Hatch overlay on selected — same `<defs>` pattern as the wall.
  if (isSelected && palette) {
    children.push({
      kind: 'hatch',
      points: outer,
      color: palette.selectedHatch,
      opacity: 0.7,
    })
  }

  // Boundary editor — visible only when the slab is the active selection.
  if (isSelected) {
    appendRingEditor(children, polygon, undefined)
    holes.forEach((hole, holeIndex) => {
      if (hole.length >= 3) appendRingEditor(children, hole, holeIndex)
    })
  }

  return { kind: 'group', children }
}

/**
 * Push vertex / midpoint / edge handles for a single ring (boundary or
 * hole). `holeIndex === undefined` targets `node.polygon`; otherwise
 * `node.holes[holeIndex]`. Emits in this order so the hit-test
 * priority is sensible: edges first (largest hit area, lowest z),
 * then midpoints, then vertices on top.
 */
function appendRingEditor(
  children: FloorplanGeometry[],
  ring: ReadonlyArray<readonly [number, number]>,
  holeIndex: number | undefined,
): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    children.push({
      kind: 'edge-handle',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      affordance: 'move-edge',
      payload: { holeIndex, edgeIndex: i },
    })
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    children.push({
      kind: 'midpoint-handle',
      point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      affordance: 'add-vertex',
      payload: { holeIndex, edgeIndex: i },
    })
  }
  for (let i = 0; i < ring.length; i++) {
    const [x, z] = ring[i]!
    children.push({
      kind: 'endpoint-handle',
      point: [x, z],
      state: 'idle',
      affordance: 'move-vertex',
      payload: { holeIndex, vertexIndex: i },
    })
  }
}
