import type { AnyNode } from '../schema'
import type { RoofNode } from '../schema/nodes/roof'
import {
  getRoofSegmentDeckReach,
  getSegmentSlopeFrame,
  type RoofSegmentNode,
} from '../schema/nodes/roof-segment'
import {
  getDutchRoofShapeMetrics,
  type RoofShapeFaceVertex,
  type RoofShapeRatios,
} from '../schema/nodes/roof-segment-shape'
import { type EavePoint, type RoofEaveProfile, roofSegmentEaveProfile } from './roof-eave'

// The back embeds into the deck; meeting boards leave a gap for a stable CSG union.
const FASCIA_EMBED = 0.002
const BOARD_GAP = 0.0001
const DUTCH_RAKE_SLOPE_SEAT_OFFSET = 0.0002
type Vertex = RoofShapeFaceVertex
type Edge = { axis: 'x' | 'z'; sign: 1 | -1 }
const EDGES_Z: readonly Edge[] = [
  { axis: 'z', sign: 1 },
  { axis: 'z', sign: -1 },
]
const EDGES_X: readonly Edge[] = [
  { axis: 'x', sign: 1 },
  { axis: 'x', sign: -1 },
]

/** A lean-to supplies its own trim; legacy composite sheds must not board their shared edges. */
export function wearsRoofFascia(
  segment: RoofSegmentNode,
  roof?: RoofNode,
  nodes?: Readonly<Record<string, AnyNode>>,
): boolean {
  if (segment.fascia !== true) return false
  if (segment.roofType !== 'shed') return true
  if (
    segment.shedSideInfillSpan !== undefined ||
    segment.shedSideInfillMinX !== undefined ||
    segment.shedSideInfillMaxX !== undefined ||
    segment.shedFootprintPieces !== undefined ||
    segment.shedOpenEndSides !== undefined
  ) {
    return false
  }
  const children = roof?.children ?? []
  return (
    (nodes ? children.filter((id) => nodes[id]?.type === 'roof-segment') : children).length <= 1
  )
}

function cross(a: Vertex, b: Vertex, c: Vertex): Vertex {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const uz = b.z - a.z
  const vx = c.x - a.x
  const vy = c.y - a.y
  const vz = c.z - a.z
  return { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx }
}

function centre(points: Vertex[]): Vertex {
  const sum = points.reduce((v, p) => ({ x: v.x + p.x, y: v.y + p.y, z: v.z + p.z }), {
    x: 0,
    y: 0,
    z: 0,
  })
  const n = Math.max(1, points.length)
  return { x: sum.x / n, y: sum.y / n, z: sum.z / n }
}

function edgePrism(
  node: RoofSegmentNode,
  edge: Edge,
  plateY: number,
  section: readonly EavePoint[],
  from: (point: EavePoint) => number,
  to: (point: EavePoint) => number,
): Vertex[][] {
  const point = ([s, y]: EavePoint, u: number): Vertex => {
    const out = edge.sign * ((edge.axis === 'z' ? node.depth : node.width) / 2 + s)
    return edge.axis === 'z' ? { x: u, y: plateY + y, z: out } : { x: out, y: plateY + y, z: u }
  }
  const a = section.map((p) => point(p, from(p)))
  const b = section.map((p) => point(p, to(p)))
  const faces = [a, b]
  for (let i = 0; i < section.length; i++) {
    const j = (i + 1) % section.length
    faces.push([a[i]!, a[j]!, b[j]!, b[i]!])
  }
  const solidCentre = centre(faces.flat())
  return faces.map((face) => {
    const normal = cross(face[0]!, face[1]!, face[2]!)
    const p = centre(face)
    const outward =
      normal.x * (p.x - solidCentre.x) +
      normal.y * (p.y - solidCentre.y) +
      normal.z * (p.z - solidCentre.z)
    return outward < 0 ? [...face].reverse() : face
  })
}

function sAtHeight([s0, y0]: EavePoint, [s1, y1]: EavePoint, y: number): number {
  return Math.abs(y1 - y0) < 1e-9 ? s0 : s0 + ((y - y0) * (s1 - s0)) / (y1 - y0)
}

function embeddedFascia(profile: RoofEaveProfile): EavePoint[] {
  const [backTop, frontTop, frontBottom, backBottom] = profile.fascia.corners
  const [nx, ny] = profile.fascia.square ? [profile.cos, -profile.sin] : [1, 0]
  const back = ([s, y]: EavePoint): EavePoint => [s - nx * FASCIA_EMBED, y - ny * FASCIA_EMBED]
  return [back(backTop), frontTop, frontBottom, back(backBottom)]
}

function rakeSection(profile: RoofEaveProfile, inner: number): EavePoint[] {
  const { top, cos, sin, tan } = profile
  const depth = profile.rake.height
  const bottom = (s: number) => top(s) - depth
  const pull = FASCIA_EMBED + BOARD_GAP
  const [s0, y0] = profile.end[0] as EavePoint
  const corner: EavePoint = profile.fascia.square
    ? [s0 - pull * cos, y0 + pull * sin]
    : [s0 - pull, top(s0 - pull)]
  const section: EavePoint[] = [corner]
  if (profile.cut === 'square') {
    const along = depth * cos
    section.push([corner[0] - along * sin, corner[1] - along * cos])
  } else if (profile.cut === 'plumb-level') {
    const level = profile.fascia.corners[3][1]
    const s = tan > 1e-9 ? (top(0) - depth - level) / tan : corner[0]
    if (bottom(corner[0]) < level && s < corner[0]) section.push([corner[0], level], [s, level])
    else section.push([corner[0], bottom(corner[0])])
  } else section.push([corner[0], bottom(corner[0])])
  section.push([inner, bottom(inner)], [inner, top(inner)])
  return section
}

/** Native fascia/rake solids, segment-local and untrimmed. Eligibility is wearsRoofFascia's policy. */
export function getRoofFasciaBoardFaces(node: RoofSegmentNode): Vertex[][] {
  const { roofType, width, depth } = node
  if (!['gable', 'hip', 'shed', 'flat'].includes(roofType)) return []
  const reach = getRoofSegmentDeckReach(node)
  const eave = roofSegmentEaveProfile(node)
  const plateY = node.wallHeight
  const board = embeddedFascia(eave)
  const faces: Vertex[][] = []
  const rakeFace = width / 2 + reach.x + eave.fascia.thickness
  if (roofType === 'gable' || roofType === 'shed') {
    const sides = roofType === 'gable' ? EDGES_Z : [EDGES_Z[0]!]
    for (const edge of sides)
      faces.push(
        ...edgePrism(
          node,
          edge,
          plateY,
          board,
          () => -rakeFace,
          () => rakeFace,
        ),
      )
    if (roofType === 'shed' && (node.fasciaHighEdge ?? true)) {
      const high = roofSegmentEaveProfile(node, 'high')
      const highY = plateY + getSegmentSlopeFrame(node).activeRh
      faces.push(
        ...edgePrism(
          node,
          EDGES_Z[1]!,
          highY,
          embeddedFascia(high),
          () => -rakeFace,
          () => rakeFace,
        ),
      )
    }
    const inner =
      roofType === 'gable' ? -depth / 2 + BOARD_GAP : -depth - reach.z + FASCIA_EMBED + BOARD_GAP
    const section = rakeSection(eave, inner)
    const back = width / 2 + reach.x - FASCIA_EMBED
    for (const edge of sides)
      for (const sx of [-1, 1] as const) {
        const [x0, x1] = sx === 1 ? [back, rakeFace] : [-rakeFace, -back]
        faces.push(
          ...edgePrism(
            node,
            edge,
            plateY,
            section,
            () => x0,
            () => x1,
          ),
        )
      }
  } else {
    const [, frontTop, frontBottom] = eave.fascia.corners
    const front = (y: number) => sAtHeight(frontTop, frontBottom, y)
    const back = (y: number) => sAtHeight(board[0]!, board[3]!, y) - BOARD_GAP
    for (const edge of EDGES_Z)
      faces.push(
        ...edgePrism(
          node,
          edge,
          plateY,
          board,
          ([, y]) => -(width / 2 + front(y)),
          ([, y]) => width / 2 + front(y),
        ),
      )
    for (const edge of EDGES_X)
      faces.push(
        ...edgePrism(
          node,
          edge,
          plateY,
          board,
          ([, y]) => -(depth / 2 + back(y)),
          ([, y]) => depth / 2 + back(y),
        ),
      )
  }
  return faces
}

/** Four native Dutch rake tops; the viewer supplies their vertical thickness and side materials. */
export function getDutchRakeBoardTops(input: {
  w: number
  d: number
  wh: number
  rh: number
  dutchI: number
  shapeRatios: RoofShapeRatios
  thickness: number
}): Vertex[][] {
  if (
    !(input.shapeRatios.dutchGabletRake > 0.001) ||
    !(input.thickness > 0.0001) ||
    !(input.dutchI > 0.001) ||
    !(input.rh > 0.001)
  ) {
    return []
  }
  const dutch = getDutchRoofShapeMetrics({ ...input, baseW: input.w, baseD: input.d })
  if (!dutch || !(dutch.rakeReach > 0.001)) return []
  const faces: Vertex[][] = []
  const widthAxis = dutch.axis === 'width'
  // Preserve the renderer's board order on each axis.
  for (const side of widthAxis ? [-1, 1] : [1, -1]) {
    for (const end of widthAxis ? [1, -1] : [-1, 1]) {
      const apex = widthAxis
        ? { x: side * dutch.innerWaistHalfX, y: dutch.peakHeight, z: 0 }
        : { x: 0, y: dutch.peakHeight, z: side * dutch.innerWaistHalfZ }
      const base = widthAxis
        ? { x: apex.x, y: dutch.middleHeight, z: end * dutch.innerWaistHalfZ }
        : { x: end * dutch.innerWaistHalfX, y: dutch.middleHeight, z: apex.z }
      const outer = (p: Vertex): Vertex => ({
        x: p.x + (widthAxis ? side * dutch.rakeReach : 0),
        y: p.y,
        z: p.z + (widthAxis ? 0 : side * dutch.rakeReach),
      })
      const face = [apex, base, outer(base), outer(apex)]
      const normal = cross(face[0]!, face[1]!, face[2]!)
      const length = Math.hypot(normal.x, normal.y, normal.z) || 1
      const direction = normal.y < 0 ? -1 : 1
      if (direction < 0) face.reverse()
      const offset = (direction * DUTCH_RAKE_SLOPE_SEAT_OFFSET) / length
      faces.push(
        face.map((p) => ({
          x: p.x + normal.x * offset,
          y: p.y + normal.y * offset,
          z: p.z + normal.z * offset,
        })),
      )
    }
  }
  return faces
}
