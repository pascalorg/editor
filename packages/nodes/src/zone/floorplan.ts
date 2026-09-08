import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  resolveAutoZonePolygon,
  type ZoneNode,
} from '@pascal-app/core'
import { floorplanGeometryMetadata, readFloorplanContext } from '@pascal-app/editor'
import {
  type ConstructionLengthProfile,
  formatConstructionLength,
} from '../shared/construction-length'
import { buildRoomClearDimensions } from './room-clear-dimensions'

/**
 * Stage C floor-plan builder for zone. Zones are colored polygons —
 * fill + outline both come from `zone.color`. Selection adds an
 * accent-colored outline.
 *
 * The zone's `name` renders as a centered text label at the polygon's
 * geometric centroid. The registry layer sorts zones before every
 * other kind so the label + polygon sit *under* walls / slabs /
 * furniture in the SVG document order (= z-order).
 */
export function buildZoneFloorplan(node: ZoneNode, ctx: GeometryContext): FloorplanGeometry | null {
  const ring = resolveAutoZonePolygon(node, ctx.resolve)
  if (!ring || ring.length < 3) return null

  const view = ctx.viewState
  const floorplanContext = readFloorplanContext(ctx)
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const points: FloorplanPoint[] = ring.map(([x, z]) => [x, z] as FloorplanPoint)
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : node.color
  const isRoom = node.spaceRole === 'room'
  const fillOpacity = isRoom ? (isSelected ? 0.12 : 0.04) : isSelected ? 0.28 : 0.16
  // On paper a room is its label, not a colour: the wash and the zone-coloured
  // text are editor chrome. Same ink the wall kind prints in.
  const onPaper = floorplanContext.purpose === 'document'

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill: onPaper && isRoom ? 'none' : node.color,
      fillOpacity,
      stroke,
      strokeWidth: showSelectedChrome ? 0.08 : 0.05,
      strokeOpacity: showSelectedChrome ? 0.96 : 0.72,
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
    },
  ]

  // Polygon editor — emitted only when the zone is the active
  // selection. Same three handle types slabs / ceilings expose:
  // edge-handle (drag whole edge), midpoint-handle (insert a vertex),
  // endpoint-handle (drag an existing vertex). Order matters for
  // hit-test layering: edges (large hit area) first, then midpoints,
  // then vertices on top.
  if (isSelected) {
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
        payload: { edgeIndex: i },
      })
    }
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      children.push({
        kind: 'midpoint-handle',
        point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        affordance: 'add-vertex',
        payload: { edgeIndex: i },
      })
    }
    for (let i = 0; i < ring.length; i++) {
      const [x, z] = ring[i]!
      children.push({
        kind: 'endpoint-handle',
        point: [x, z],
        state: 'idle',
        affordance: 'move-vertex',
        payload: { vertexIndex: i },
      })
    }
  }

  // Name label — white fill inside a zone-colored stroke (`paintOrder:
  // 'stroke'` paints the stroke first so the fill reads cleanly through
  // it). Mirrors the legacy `FloorplanZoneLabel` so the look is
  // consistent. Centered on the polygon's area-weighted centroid; the
  // bbox-center fallback handles degenerate rings without throwing.
  const [cx, cy] = polygonCentroid(ring)
  const name = node.name?.trim()
  if (isRoom) {
    children.push(
      ...buildRoomLabels(
        node,
        cx,
        cy,
        view?.unit ?? 'metric',
        floorplanContext.purpose === 'document' ? 'document' : 'editor',
        floorplanContext.metricNotation,
        DOCUMENT_INK,
        ring,
      ),
    )
    if (floorplanContext.automaticDimensions) {
      children.push(...buildRoomClearDimensions(node, ctx))
    }
  } else if (name) {
    children.push({
      kind: 'text',
      x: cx,
      y: cy,
      text: name,
      // Same constants the legacy `FLOORPLAN_ZONE_LABEL_FONT_SIZE` uses
      // (0.2 plan metres ≈ readable at typical building zooms).
      fontSize: ZONE_LABEL_FONT_SIZE,
      fill: '#ffffff',
      stroke: node.color,
      strokeWidth: ZONE_LABEL_FONT_SIZE * 0.35,
      paintOrder: 'stroke',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: 500,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      opacity: showSelectedChrome ? 1 : 0.92,
      upright: true,
    })
  }

  return { kind: 'group', children }
}

/** Plan ink on paper — the same hex `wall/floorplan.ts` prints in. */
const DOCUMENT_INK = '#111827'
const ZONE_LABEL_FONT_SIZE = 0.2
const ROOM_NAME_FONT_SIZE = 0.2
/** The smallest the name shrinks to fit a narrow room before it simply overflows. */
const ROOM_NAME_MIN_FONT_SIZE = 0.12
const ROOM_NUMBER_FONT_SIZE = 0.14
const ROOM_DETAIL_FONT_SIZE = 0.1
/** Line pitch as a multiple of the line's font size. */
const ROOM_LABEL_LEADING = 1.3
/** Bold sans sets at about this many ems per character. */
const ROOM_LABEL_EM_PER_CHAR = 0.62
/** The label may use this much of the room's width / height. */
const ROOM_LABEL_FIT = 0.86

function buildRoomLabels(
  node: ZoneNode,
  x: number,
  y: number,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: 'meters' | 'millimeters',
  color: string,
  ring: readonly (readonly [number, number])[] = [],
): FloorplanGeometry[] {
  // The room's plan extent: what the label has to fit into. Steve,
  // 2026-09-08: "all the labels overlapping and the plan doesn't look good
  // ... they need to be cleaner with bolder window labels and door labels".
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [px, py] of ring) {
    minX = Math.min(minX, px)
    maxX = Math.max(maxX, px)
    minY = Math.min(minY, py)
    maxY = Math.max(maxY, py)
  }
  const roomW = ring.length >= 3 ? (maxX - minX) * ROOM_LABEL_FIT : Number.POSITIVE_INFINITY
  const roomH = ring.length >= 3 ? (maxY - minY) * ROOM_LABEL_FIT : Number.POSITIVE_INFINITY
  const widthOf = (text: string, fontSize: number) => text.length * fontSize * ROOM_LABEL_EM_PER_CHAR
  const fits = (text: string, fontSize: number) => widthOf(text, fontSize) <= roomW

  type Line = { text: string; fontSize: number; fontWeight: number; detail: boolean }
  const lines: Line[] = []
  // The name: bold, upper-case, in plan ink. A long compound name
  // ("Great room / Kitchen") breaks at its slash when one line will not
  // fit; a name still too wide shrinks toward the minimum size.
  const name = node.name.trim().toUpperCase()
  if (name) {
    const parts =
      fits(name, ROOM_NAME_FONT_SIZE) || !name.includes('/')
        ? [name]
        : name.split('/').map((part) => part.trim()).filter(Boolean)
    const widest = parts.reduce((w, part) => Math.max(w, widthOf(part, 1)), 0)
    const size = Math.max(
      ROOM_NAME_MIN_FONT_SIZE,
      Math.min(ROOM_NAME_FONT_SIZE, widest > 0 ? roomW / widest : ROOM_NAME_FONT_SIZE),
    )
    for (const part of parts) lines.push({ text: part, fontSize: size, fontWeight: 700, detail: false })
  }
  if (node.roomNumber) {
    lines.push({ text: node.roomNumber, fontSize: ROOM_NUMBER_FONT_SIZE, fontWeight: 600, detail: false })
  }

  // The detail lines carry the 'room-detail' role — the clean plan hides
  // them (the finish schedule has them); the Expert plan and the sheets
  // choose. They are only set where they fit the room at all.
  const finishes = [
    node.floorFinish ? `FL: ${node.floorFinish}` : '',
    node.wallFinish ? `WL: ${node.wallFinish}` : '',
    node.ceilingFinish ? `CL: ${node.ceilingFinish}` : '',
  ].filter(Boolean)
  const detailLines: string[] = []
  if (finishes.length > 0) detailLines.push(finishes.join(' · '))
  const roomDetails = [
    `CH: ${formatConstructionLength(node.ceilingHeight, unit, profile, { metricNotation })}`,
  ]
  if (node.occupancy) roomDetails.push(node.occupancy)
  detailLines.push(roomDetails.join(' · '))
  const stackH = (all: Line[]) => all.reduce((h, l) => h + l.fontSize * ROOM_LABEL_LEADING, 0)
  for (const text of detailLines) {
    const candidate: Line = { text, fontSize: ROOM_DETAIL_FONT_SIZE, fontWeight: 500, detail: true }
    if (fits(text, ROOM_DETAIL_FONT_SIZE) && stackH([...lines, candidate]) <= roomH) lines.push(candidate)
  }

  const total = stackH(lines)
  let cursor = y - total / 2
  return lines.map((line) => {
    const pitch = line.fontSize * ROOM_LABEL_LEADING
    const lineY = cursor + pitch / 2
    cursor += pitch
    return {
      kind: 'text',
      x,
      y: lineY,
      text: line.text,
      fontSize: line.fontSize,
      fill: color,
      stroke: '#ffffff',
      strokeWidth: line.fontSize * 0.22,
      paintOrder: 'stroke',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: line.fontWeight,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      upright: true,
      metadata: floorplanGeometryMetadata({
        annotationRole: line.detail ? 'room-detail' : 'room-label',
      }),
    }
  })
}

/**
 * Area-weighted centroid of a simple polygon (Shoelace formula). Falls
 * back to the bounding-box center when the signed area is degenerate
 * (collinear vertices, zero-area polygon) so the label still has a
 * sensible anchor.
 */
function polygonCentroid(ring: ReadonlyArray<readonly [number, number]>): [number, number] {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!
    const [x1, y1] = ring[(i + 1) % ring.length]!
    const cross = x0 * y1 - x1 * y0
    area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  area *= 0.5
  if (Math.abs(area) < 1e-9) {
    // Degenerate — fall back to bbox center.
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2]
  }
  return [cx / (6 * area), cy / (6 * area)]
}
