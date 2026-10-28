import type { FoundationMember } from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three'

/** The foundation members of one kind as one indexed mesh, in world coordinates. */
export type FoundationMesh = {
  positions: Float32Array
  normals: Float32Array
  /** Metres along the run, for the courses of block to bond along the wall. */
  along: Float32Array
  indices: Uint32Array
}

/** A built mesh as a three geometry; `null` for none. */
export function geometryOf(mesh: FoundationMesh | null): BufferGeometry | null {
  if (!mesh) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  geometry.setAttribute('along', new BufferAttribute(mesh.along, 1))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  return geometry
}

type Vec3 = readonly [number, number, number]

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Faces collected into one mesh, each with its own flat normal (a cylinder's sides share theirs). */
class MeshSink {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly along: number[] = []
  readonly indices: number[] = []

  /** A planar polygon facing `outward`, fanned from its first corner; `normals` per corner where it is curved. */
  face(corners: readonly Vec3[], outward: Vec3, alongAt: readonly number[], normals?: Vec3[]) {
    if (corners.length < 3) return
    const [a, b, c] = corners as [Vec3, Vec3, Vec3]
    const facing = dot(cross(sub(b, a), sub(c, a)), outward) >= 0
    const order = corners.map((_, index) =>
      facing ? index : (corners.length - index) % corners.length,
    )
    const base = this.positions.length / 3
    for (const index of order) {
      this.positions.push(...(corners[index] as Vec3))
      this.normals.push(...(normals?.[index] ?? outward))
      this.along.push(alongAt[index] ?? 0)
    }
    for (let k = 1; k + 1 < corners.length; k++) this.indices.push(base, base + k, base + k + 1)
  }

  /**
   * A flat polygon (a cap) of any shape, triangulated, facing `outward`; `corners` are the plan's
   * and then each hole's, in order.
   */
  cap(
    corners: readonly Vec3[],
    plan: readonly Vector2[],
    outward: Vec3,
    alongAt: number,
    holes: readonly (readonly Vector2[])[] = [],
  ) {
    const triangles = ShapeUtils.triangulateShape(plan as Vector2[], holes as Vector2[][])
    for (const [i = 0, j = 0, k = 0] of triangles) {
      this.face([corners[i] as Vec3, corners[j] as Vec3, corners[k] as Vec3], outward, [
        alongAt,
        alongAt,
        alongAt,
      ])
    }
  }

  mesh(): FoundationMesh | null {
    if (this.indices.length === 0) return null
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      along: new Float32Array(this.along),
      indices: new Uint32Array(this.indices),
    }
  }
}

/** A run's plan frame: its length, the direction along it and the one to its left. */
function frameOf({ from, to }: Pick<FoundationMember, 'from' | 'to'>) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return null
  const [ux, uz] = [dx / length, dz / length]
  return { length, ux, uz, nx: -uz, nz: ux }
}

/**
 * A run as a closed box, six faces each with its own flat normal: the plan line `from` to `to`,
 * `width` across, from `bottomY` to `topY`. Corners are closed by the runs themselves (they
 * overlap), so the boxes carry no joins.
 */
function writeBox(sink: MeshSink, member: FoundationMember) {
  const { from, to, width, bottomY, topY } = member
  const frame = frameOf(member)
  if (!frame || topY - bottomY < 1e-9) return
  const { length, ux, uz, nx, nz } = frame
  const half = width / 2
  const at = (end: [number, number], side: number, y: number): Vec3 => [
    end[0] + nx * half * side,
    y,
    end[1] + nz * half * side,
  ]
  const [a0, a1, a2, a3] = [
    at(from, 1, bottomY),
    at(to, 1, bottomY),
    at(to, -1, bottomY),
    at(from, -1, bottomY),
  ]
  const [b0, b1, b2, b3] = [
    at(from, 1, topY),
    at(to, 1, topY),
    at(to, -1, topY),
    at(from, -1, topY),
  ]
  const run = [0, length, length, 0]
  sink.face([b0, b1, b2, b3], [0, 1, 0], run)
  sink.face([a0, a1, a2, a3], [0, -1, 0], run)
  sink.face([a0, a1, b1, b0], [nx, 0, nz], run)
  sink.face([a3, a2, b2, b3], [-nx, 0, -nz], run)
  sink.face([a0, a3, b3, b0], [-ux, 0, -uz], [0, 0, 0, 0])
  sink.face([a1, a2, b2, b1], [ux, 0, uz], [length, length, length, length])
}

/** A run drawn as its `section` (`[across, y]`, across to the run's left), swept from `from` to `to`. */
function writeSection(sink: MeshSink, member: FoundationMember) {
  const frame = frameOf(member)
  const raw = member.section ?? []
  // Corners repeated in a row (a step that closed up) are one.
  const section = raw.filter((point, index) => {
    const next = raw[(index + 1) % raw.length]!
    return Math.hypot(point[0] - next[0], point[1] - next[1]) > 1e-9
  })
  if (!frame || section.length < 3) return
  const { length, ux, uz, nx, nz } = frame
  const at = (end: [number, number], [across, y]: [number, number]): Vec3 => [
    end[0] + nx * across,
    y,
    end[1] + nz * across,
  ]
  let area = 0
  for (let i = 0; i < section.length; i++) {
    const [ax, ay] = section[i]!
    const [bx, by] = section[(i + 1) % section.length]!
    area += ax * by - bx * ay
  }
  const turn = area >= 0 ? 1 : -1
  for (let i = 0; i < section.length; i++) {
    const p = section[i]!
    const q = section[(i + 1) % section.length]!
    // Out of a counter-clockwise outline is to the right of each side.
    const [dc, dy] = [q[0] - p[0], q[1] - p[1]]
    const size = Math.hypot(dc, dy)
    const [oc, oy] = [(dy / size) * turn, (-dc / size) * turn]
    sink.face(
      [at(member.from, p), at(member.to, p), at(member.to, q), at(member.from, q)],
      [nx * oc, oy, nz * oc],
      [0, length, length, 0],
    )
  }
  const plan = section.map(([across, y]) => new Vector2(across, y))
  sink.cap(
    section.map((point) => at(member.from, point)),
    plan,
    [-ux, 0, -uz],
    0,
  )
  sink.cap(
    section.map((point) => at(member.to, point)),
    plan,
    [ux, 0, uz],
    length,
  )
}

const PILE_SIDES = 16

/** A pile: a cylinder `width` across, standing on `from`. */
function writePile(sink: MeshSink, { from, width, bottomY, topY }: FoundationMember) {
  if (topY - bottomY < 1e-9 || width <= 0) return
  const radius = width / 2
  const ring = (y: number): Vec3[] =>
    Array.from({ length: PILE_SIDES }, (_, k) => {
      const angle = (k / PILE_SIDES) * Math.PI * 2
      return [from[0] + Math.cos(angle) * radius, y, from[1] + Math.sin(angle) * radius] as Vec3
    })
  const [low, high] = [ring(bottomY), ring(topY)]
  for (let k = 0; k < PILE_SIDES; k++) {
    const next = (k + 1) % PILE_SIDES
    const radial = (index: number): Vec3 => {
      const angle = (index / PILE_SIDES) * Math.PI * 2
      return [Math.cos(angle), 0, Math.sin(angle)]
    }
    const middle = ((k + 0.5) / PILE_SIDES) * Math.PI * 2
    sink.face(
      [low[k]!, low[next]!, high[next]!, high[k]!],
      [Math.cos(middle), 0, Math.sin(middle)],
      [0, 0, 0, 0],
      [radial(k), radial(next), radial(next), radial(k)],
    )
  }
  sink.face(high, [0, 1, 0], [])
  sink.face(low, [0, -1, 0], [])
}

/** The slab: its plan `outline` (less its `holes`) from `bottomY` to `topY`. */
function writeSlab(sink: MeshSink, { outline, holes = [], bottomY, topY }: FoundationMember) {
  if (!outline || outline.length < 3 || topY - bottomY < 1e-9) return
  const inner = holes.filter((hole) => hole.length >= 3)
  const corners = [...outline, ...inner.flat()]
  const plan = outline.map(([x, z]) => new Vector2(x, z))
  const holePlans = inner.map((hole) => hole.map(([x, z]) => new Vector2(x, z)))
  sink.cap(
    corners.map(([x, z]) => [x, topY, z] as Vec3),
    plan,
    [0, 1, 0],
    0,
    holePlans,
  )
  sink.cap(
    corners.map(([x, z]) => [x, bottomY, z] as Vec3),
    plan,
    [0, -1, 0],
    0,
    holePlans,
  )
  for (const [ring, hole] of [
    [outline, false],
    ...inner.map((ring) => [ring, true] as const),
  ] as const) {
    const clockwise = ShapeUtils.isClockWise(ring.map(([x, z]) => new Vector2(x, z)))
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i]!
      const [bx, bz] = ring[(i + 1) % ring.length]!
      const size = Math.hypot(bx - ax, bz - az)
      if (size < 1e-9) continue
      // Out of the slab: to the right of each side as the outline winds in the plan (x, z), into
      // a hole round its own.
      const side = (clockwise ? -1 : 1) * (hole ? -1 : 1)
      sink.face(
        [
          [ax, bottomY, az],
          [bx, bottomY, bz],
          [bx, topY, bz],
          [ax, topY, az],
        ],
        [((bz - az) / size) * side, 0, (-(bx - ax) / size) * side],
        [],
      )
    }
  }
}

/** The runs of `kind` as closed boxes: footings, stems and grade beams. */
export function buildFoundationMesh(
  members: readonly FoundationMember[],
  kind: FoundationMember['kind'],
): FoundationMesh | null {
  const sink = new MeshSink()
  for (const member of members) if (member.kind === kind && !member.section) writeBox(sink, member)
  return sink.mesh()
}

/**
 * What a designed foundation pours besides footings and stems, as one concrete mesh: a slab's
 * turned-down edge (its section), grade beams, piles and the slab itself.
 */
export function buildDesignedFoundationMesh(
  members: readonly FoundationMember[],
): FoundationMesh | null {
  const sink = new MeshSink()
  for (const member of members) {
    if (member.section) writeSection(sink, member)
    else if (member.kind === 'grade-beam') writeBox(sink, member)
    else if (member.kind === 'pile') writePile(sink, member)
    else if (member.kind === 'slab') writeSlab(sink, member)
  }
  return sink.mesh()
}

/** Every member as one mesh, each drawn as its kind is: boxes, sections, piles, the slab. */
export function buildFoundationMembersMesh(
  members: readonly FoundationMember[],
): FoundationMesh | null {
  const sink = new MeshSink()
  for (const member of members) {
    if (member.section) writeSection(sink, member)
    else if (member.kind === 'pile') writePile(sink, member)
    else if (member.kind === 'slab') writeSlab(sink, member)
    else writeBox(sink, member)
  }
  return sink.mesh()
}
