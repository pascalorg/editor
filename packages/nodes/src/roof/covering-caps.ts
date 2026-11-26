import {
  type AnyNode,
  getRoofModuleFaces,
  getRoofShingleModules,
  type RoofCovering,
  type RoofNode,
  type RoofSegmentNode,
} from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'

const EPSILON = 1e-6
const MAX_CAP_PIECES = 512
/** A face this much upward (unit normal Y) is shingle surface, not an edge band. */
const UPWARD = 0.02

type Face = { points: Vector3[]; normal: Vector3; center: Vector3 }
type Edge = { a: Vector3; b: Vector3; face: Face }

function supportsCaps(
  segment: RoofSegmentNode,
  nodes?: Readonly<Record<string, AnyNode>>,
): boolean {
  return (
    (segment.roofType === 'gable' || segment.roofType === 'hip') &&
    segment.roofSystem !== 'glazed' &&
    !segment.arc &&
    // Native drainage has no roofAccessory.buildCut. Unknown/unresolved children
    // remain unsupported rather than guessing whether the finished shell was cut.
    segment.children.every((id) => {
      const child = nodes?.[id]
      return child?.type === 'gutter' || child?.type === 'downspout'
    }) &&
    Object.values(segment.trim).every((value) => value === 0) &&
    [...segment.position, segment.rotation].every(Number.isFinite) &&
    [segment.width, segment.depth, segment.pitch].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
}

/** Conservative eligibility: never dress an uncut module where the shell has CSG cuts. */
export function getRoofCoveringCapSegment(
  roof: RoofNode,
  nodes: Readonly<Record<string, AnyNode>>,
): RoofSegmentNode | null {
  if (roof.children.length !== 1 || ![...roof.position, roof.rotation].every(Number.isFinite))
    return null
  const segment = nodes[roof.children[0]!]
  if (segment?.type !== 'roof-segment' || !supportsCaps(segment, nodes)) return null
  // Even disjoint sibling roofs are left unsupported until cap clipping shares their union.
  if (
    Object.values(nodes).some(
      (node) => node.type === 'roof' && node.id !== roof.id && node.parentId === roof.parentId,
    )
  )
    return null
  return segment
}

/** The finished shingle's upward module faces, segment-local (the brush's top module). */
function shingleTopFaces(segment: RoofSegmentNode): { x: number; y: number; z: number }[][] {
  const { top, shiftZ } = getRoofShingleModules(segment)
  return getRoofModuleFaces(top)
    .map((face) => face.map((vertex) => ({ ...vertex, z: vertex.z + shiftZ })))
    .filter((face) => {
      const normal = [0, 0, 0]
      for (let i = 0; i < face.length; i++) {
        const p = face[i]!
        const q = face[(i + 1) % face.length]!
        normal[0]! += (p.y - q.y) * (p.z + q.z)
        normal[1]! += (p.z - q.z) * (p.x + q.x)
        normal[2]! += (p.x - q.x) * (p.y + q.y)
      }
      const length = Math.hypot(normal[0]!, normal[1]!, normal[2]!)
      const distinct = new Set(face.map(({ x, z }) => `${x.toFixed(6)},${z.toFixed(6)}`))
      // Faces that look up (as the placement surface reads them), with a real plan outline.
      return length > EPSILON * EPSILON && normal[1]! / length > UPWARD && distinct.size >= 3
    })
}

function topFaces(segment: RoofSegmentNode): Face[] | null {
  const faces: Face[] = []
  for (const vertices of shingleTopFaces(segment)) {
    const face = { vertices }
    if (face.vertices.some(({ x, y, z }) => ![x, y, z].every(Number.isFinite))) return null
    const points = face.vertices.map(({ x, y, z }) => new Vector3(x, y, z))
    const normal = new Vector3()
    const center = new Vector3()
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      const q = points[(i + 1) % points.length]!
      normal.x += (p.y - q.y) * (p.z + q.z)
      normal.y += (p.z - q.z) * (p.x + q.x)
      normal.z += (p.x - q.x) * (p.y + q.y)
      center.add(p)
    }
    if (normal.lengthSq() <= EPSILON * EPSILON || normal.y <= 0) return null
    faces.push({ points, normal: normal.normalize(), center: center.divideScalar(points.length) })
  }
  return faces.length >= 2 && faces.length <= 4 ? faces : null
}

function sharedConvexEdges(faces: Face[]): Array<[Edge, Edge]> {
  const edges = faces.flatMap((face) =>
    face.points.map(
      (a, index): Edge => ({ a, b: face.points[(index + 1) % face.points.length]!, face }),
    ),
  )
  const same = (a: Vector3, b: Vector3) => a.distanceToSquared(b) <= EPSILON * EPSILON
  const result: Array<[Edge, Edge]> = []
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!
    if (same(edge.a, edge.b)) continue
    const matches = edges.filter(
      (other) =>
        other !== edge &&
        other.face !== edge.face &&
        ((same(edge.a, other.a) && same(edge.b, other.b)) ||
          (same(edge.a, other.b) && same(edge.b, other.a))),
    )
    const other = matches[0]
    if (matches.length !== 1 || !other || edges.indexOf(other) <= i) continue
    if (edge.face.normal.dot(other.face.normal) >= 1 - EPSILON) continue
    // At a convex ridge both finite faces lie below the other's extended plane.
    // A valley has the opposite sign and must never receive a cap.
    if (
      edge.face.points.some((p) => p.clone().sub(other.a).dot(other.face.normal) > EPSILON) ||
      other.face.points.some((p) => p.clone().sub(edge.a).dot(edge.face.normal) > EPSILON)
    )
      continue
    result.push([edge, other])
  }
  return result
}

/** Distance available on a finite convex face, not its infinite supporting plane. */
function faceReach(face: Face, origin: Vector3, direction: Vector3, width: number): number {
  let reach = width
  for (let i = 0; i < face.points.length; i++) {
    const a = face.points[i]!
    const edge = face.points[(i + 1) % face.points.length]!.clone().sub(a)
    const rate = edge.clone().cross(direction).dot(face.normal)
    if (rate >= -EPSILON) continue
    const inside = edge.cross(origin.clone().sub(a)).dot(face.normal)
    reach = Math.min(reach, Math.max(0, inside / -rate))
  }
  return reach
}

/** One portable, segment-local mesh worth of finite ridge/hip cap courses; caller owns it. */
export function createRoofCoveringCapGeometry(
  segment: RoofSegmentNode,
  covering: RoofCovering,
  nodes?: Readonly<Record<string, AnyNode>>,
): BufferGeometry | null {
  if (!covering.caps || !supportsCaps(segment, nodes)) return null
  const faces = topFaces(segment)
  if (!faces) return null
  const edges = sharedConvexEdges(faces)
  const course = covering.course
  if (!Number.isFinite(course) || course <= 0) return null
  const pieces = edges.reduce(
    (total, [edge]) => total + Math.ceil(edge.a.distanceTo(edge.b) / course),
    0,
  )
  if (pieces === 0 || pieces > MAX_CAP_PIECES) return null
  const positions: number[] = []
  const uvs: number[] = []
  const tile = covering.profile !== 'slate'
  const steps = tile ? 8 : 2
  const halfWidth = Math.min(0.2, Math.max(0.06, covering.width / 2))
  const thickness = tile ? 0.009 : 0.006
  const crown = tile ? 0.055 : 0.018

  for (const [left, right] of edges) {
    const length = left.a.distanceTo(left.b)
    const axis = left.b.clone().sub(left.a).normalize()
    const outward = left.face.normal.clone().add(right.face.normal).normalize()
    const inward = (face: Face) => {
      const direction = face.center.clone().sub(left.a)
      return direction.addScaledVector(axis, -direction.dot(axis)).normalize()
    }
    const acrossLeft = inward(left.face)
    const acrossRight = inward(right.face)
    const triangle = (a: Vector3, b: Vector3, c: Vector3, normal: Vector3) => {
      const cross = b.clone().sub(a).cross(c.clone().sub(a))
      if (cross.lengthSq() <= EPSILON * EPSILON) return
      const points = cross.dot(normal) < 0 ? [a, c, b] : [a, b, c]
      for (const p of points) {
        positions.push(p.x, p.y, p.z)
        uvs.push(p.dot(acrossLeft), p.dot(axis))
      }
    }
    const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, normal: Vector3) => {
      triangle(a, b, c, normal)
      triangle(a, c, d, normal)
    }
    const section = (distance: number, lap: number) => {
      const origin = left.a.clone().addScaledVector(axis, distance)
      const widths = [
        faceReach(left.face, origin, acrossLeft, halfWidth),
        faceReach(right.face, origin, acrossRight, halfWidth),
      ]
      // A hip ends at a finite face corner. Collapsing only its width leaves the
      // round section doubled back along a tall, zero-width fin at that corner.
      const taper = Math.min(...widths) / halfWidth
      return Array.from({ length: steps + 1 }, (_, index) => {
        const t = index / steps
        const side = t <= 0.5 ? 0 : 1
        const direction = side === 0 ? acrossLeft : acrossRight
        const arch = tile ? Math.sin(Math.PI * t) : 1 - Math.abs(2 * t - 1)
        const bottom = origin
          .clone()
          .addScaledVector(direction, widths[side]! * Math.abs(2 * t - 1))
          .addScaledVector(outward, 0.003 + (crown * arch + lap) * taper)
        return { bottom, top: bottom.clone().addScaledVector(outward, thickness * taper) }
      })
    }
    const count = Math.ceil(length / course)
    for (let index = 0; index < count; index++) {
      // Short last pieces are cut, never stretched; small laps keep the course joint legible.
      const start = index * course
      const end = Math.min(length, (index + 1) * course + 0.015)
      const front = section(start, tile ? 0.004 : 0.002)
      const back = section(end, 0)
      for (let i = 0; i < steps; i++) {
        const a = front[i]!
        const b = front[i + 1]!
        const c = back[i + 1]!
        const d = back[i]!
        quad(a.top, b.top, c.top, d.top, outward)
        quad(a.bottom, b.bottom, c.bottom, d.bottom, outward.clone().negate())
        quad(a.bottom, b.bottom, b.top, a.top, axis.clone().negate())
        quad(d.bottom, c.bottom, c.top, d.top, axis)
      }
      for (const i of [0, steps]) {
        const a = front[i]!
        const b = back[i]!
        quad(a.bottom, b.bottom, b.top, a.top, i === 0 ? acrossLeft : acrossRight)
      }
    }
  }
  if (!positions.length || !positions.every(Number.isFinite)) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
