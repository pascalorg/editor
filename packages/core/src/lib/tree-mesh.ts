import {
  foliagePalette,
  foliageTone,
  type LeafLook,
  linearColor,
  type MeshWriter,
  type Rgb,
  writeLeaf,
  writeTriangle,
  writeVertex,
} from './foliage'
import { hash3, randomStream } from './seeded-noise'
import { treeClusterFrame, treeUnit } from './tree-branches'
import type { TreeBranch, TreeCluster, TreeMesh, TreeParameters } from './tree-form'

const CIRCLE: readonly (readonly [number, number])[] = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
]

function circle(side: number, sides: number): readonly [number, number] {
  if (sides === 8) return CIRCLE[side] as readonly [number, number]
  const angle = (side / sides) * 4
  const quadrant = Math.floor(angle)
  const t = angle - quadrant
  const x = (1 - t * t) / (1 + t * t)
  const z = (2 * t) / (1 + t * t)
  return quadrant === 0 ? [x, z] : quadrant === 1 ? [-z, x] : quadrant === 2 ? [-x, -z] : [z, -x]
}

export function treeWriter(triangles: number): MeshWriter {
  const vertices = triangles * 3
  return {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    color: new Float32Array(vertices * 3),
    index: new Uint16Array(triangles * 3),
    vertices: 0,
    indices: 0,
  }
}

export function finishTreeMesh(out: MeshWriter): TreeMesh {
  return {
    position: out.position.subarray(0, out.vertices * 3),
    normal: out.normal.subarray(0, out.vertices * 3),
    color: out.color.subarray(0, out.vertices * 3),
    index: out.index,
  }
}

function branchRing(
  out: MeshWriter,
  branch: TreeBranch,
  row: number,
  sides: number,
  segments: number,
) {
  const source = Math.round((row / segments) * (branch.points.length - 1))
  const point = branch.points[source] as Rgb
  const before = branch.points[Math.max(0, source - 1)] as Rgb
  const after = branch.points[Math.min(branch.points.length - 1, source + 1)] as Rgb
  const direction = treeUnit(after[0] - before[0], after[1] - before[1], after[2] - before[2])
  const u = treeUnit(direction[1], -direction[0], 0)
  const v: Rgb = [
    direction[1] * u[2] - direction[2] * u[1],
    direction[2] * u[0] - direction[0] * u[2],
    direction[0] * u[1] - direction[1] * u[0],
  ]
  const t = row / segments
  const flare = branch.sides === 8 ? 1 + 0.45 * (1 - t) * (1 - t) : 1
  const radius = (branch.radius + (branch.tipRadius - branch.radius) * t) * flare
  const bark = linearColor('#776650')
  for (let side = 0; side < sides; side++) {
    const [x, z] = circle(side, sides)
    const normal: Rgb = [u[0] * x + v[0] * z, u[1] * x + v[1] * z, u[2] * x + v[2] * z]
    const shade = 0.65 + 0.28 * (side % 2) + 0.12 * t
    writeVertex(
      out,
      point[0] + normal[0] * radius,
      point[1] + normal[1] * radius,
      point[2] + normal[2] * radius,
      ...normal,
      bark[0] * shade,
      bark[1] * shade,
      bark[2] * shade,
    )
  }
}

export function writeTreeBranch(out: MeshWriter, branch: TreeBranch, far = false) {
  const sides = far ? 4 : branch.sides
  const segments = far ? 2 : branch.points.length - 1
  const first = out.vertices
  for (let row = 0; row <= segments; row++) branchRing(out, branch, row, sides, segments)
  for (let row = 0; row < segments; row++)
    for (let side = 0; side < sides; side++) {
      const a = first + row * sides + side
      const b = first + row * sides + ((side + 1) % sides)
      writeTriangle(out, a, b + sides, b)
      writeTriangle(out, a, a + sides, b + sides)
    }
}

function clusterPoint(cluster: TreeCluster, direction: Rgb, scale: number): Rgb {
  const noise =
    0.86 +
    0.28 *
      hash3(
        cluster.seed,
        Math.round(direction[0] * 9),
        Math.round(direction[1] * 9),
        Math.round(direction[2] * 9),
      )
  const [across, axis, side] = treeClusterFrame(cluster.axis)
  const point: Rgb = [...cluster.center]
  for (const component of [0, 1, 2] as const)
    point[component] +=
      (across[component] * direction[0] * cluster.radius[0] +
        axis[component] * direction[1] * cluster.radius[1] +
        side[component] * direction[2] * cluster.radius[2]) *
      scale *
      noise
  return point
}

function clusterNormal(cluster: TreeCluster, normal: Rgb): Rgb {
  const frame = treeClusterFrame(cluster.axis)
  return treeUnit(
    (frame[0][0] * normal[0]) / cluster.radius[0] +
      (frame[1][0] * normal[1]) / cluster.radius[1] +
      (frame[2][0] * normal[2]) / cluster.radius[2],
    (frame[0][1] * normal[0]) / cluster.radius[0] +
      (frame[1][1] * normal[1]) / cluster.radius[1] +
      (frame[2][1] * normal[2]) / cluster.radius[2],
    (frame[0][2] * normal[0]) / cluster.radius[0] +
      (frame[1][2] * normal[1]) / cluster.radius[1] +
      (frame[2][2] * normal[2]) / cluster.radius[2],
  )
}

export function writeTreeCrown(out: MeshWriter, cluster: TreeCluster, foliage: string) {
  const palette = foliagePalette(foliage)
  const first = out.vertices
  const sides = 6
  for (const y of [-0.52, 0.52])
    for (let side = 0; side < sides; side++) {
      const [x, z] = circle(side, sides)
      const direction: Rgb = [x * 0.854, y, z * 0.854]
      const point = clusterPoint(cluster, direction, 1)
      const tone = foliageTone(palette, 0.3, 0.9)
      writeVertex(out, ...point, ...clusterNormal(cluster, direction), ...tone)
    }
  const bottom = writeVertex(
    out,
    ...clusterPoint(cluster, [0, -1, 0], 1),
    ...clusterNormal(cluster, [0, -1, 0]),
    ...palette.shade,
  )
  const top = writeVertex(
    out,
    ...clusterPoint(cluster, [0, 1, 0], 1),
    ...clusterNormal(cluster, [0, 1, 0]),
    ...palette.shade,
  )
  for (let side = 0; side < sides; side++) {
    const a = first + side
    const b = first + ((side + 1) % sides)
    writeTriangle(out, a, a + sides, b + sides)
    writeTriangle(out, a, b + sides, b)
    writeTriangle(out, bottom, a, b)
    writeTriangle(out, a + sides, top, b + sides)
  }
}

export function writeTreeLeaves(
  out: MeshWriter,
  cluster: TreeCluster,
  input: TreeParameters,
  count: number,
) {
  const random = randomStream(cluster.seed + 109)
  const palette = foliagePalette(input.foliage)
  const look: LeafLook = {
    size: Math.min(0.28, 0.07 + input.heightM * 0.018),
    tiltLow: 0.12,
    tiltHigh: 0.7,
    roll: 1.5,
    lift: 0.015,
    bodyNormal: 0.65,
  }
  for (let leaf = 0; leaf < count; leaf++) {
    const direction = treeUnit(random() - 0.5, random() - 0.5, random() - 0.5)
    const point = clusterPoint(cluster, direction, 0.16 + random() * 0.9)
    const normal = treeUnit(
      (point[0] - cluster.center[0]) / cluster.radius[0] + point[0] / input.spreadM,
      (point[1] - cluster.center[1]) / cluster.radius[1] + 0.3,
      (point[2] - cluster.center[2]) / cluster.radius[2] + point[2] / input.spreadM,
    )
    const tone = foliageTone(
      palette,
      0.2 + random() * 0.62,
      0.7 + 0.3 * (cluster.center[1] / input.heightM),
    )
    writeLeaf(out, random, look, point, normal, [
      Math.min(1 / 1.1, tone[0]),
      Math.min(1 / 1.1, tone[1]),
      Math.min(1 / 1.1, tone[2]),
    ])
  }
}
