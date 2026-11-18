import {
  type FoliagePalette,
  foliageTone,
  linearColor,
  type MeshWriter,
  type Rgb,
  writeTriangle,
  writeVertex,
} from './foliage'
import { randomStream } from './seeded-noise'
import { along, treeCircle, treeUnit } from './tree-branches'
import {
  TREE_HABITS,
  type TreeBranch,
  type TreeMesh,
  type TreeParameters,
  type TreeShoot,
} from './tree-form'

type TreeWriter = MeshWriter & { barkUV: Float32Array; sprigs: Uint8Array; cards: number }
export function treeWriter(triangles: number, cards: number): TreeWriter {
  // Tubes share their rings and each indexed quad owns exactly four vertices.
  const woodTriangles = triangles - cards * 2
  const vertices = woodTriangles + 4 * cards
  return {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    color: new Float32Array(vertices * 3),
    index: new Uint16Array(triangles * 3),
    barkUV: new Float32Array(woodTriangles * 2),
    sprigs: new Uint8Array(cards),
    vertices: 0,
    indices: 0,
    cards: 0,
  }
}
export function finishTreeMesh(out: TreeWriter): TreeMesh {
  return {
    position: out.position.subarray(0, out.vertices * 3),
    normal: out.normal.subarray(0, out.vertices * 3),
    color: out.color.subarray(0, out.vertices * 3),
    index: out.index,
    barkUV: out.barkUV.subarray(0, (out.vertices - out.cards * 4) * 2),
    sprigs: out.sprigs,
  }
}

const BARK = linearColor('#a39785')

export function writeTreeBranch(out: TreeWriter, branch: TreeBranch, far = false) {
  const trunk = branch.sides === 9
  const sides = far ? (trunk ? 4 : 3) : branch.sides
  const segments = far ? (trunk ? 2 : 1) : branch.points.length - 1
  const first = out.vertices
  for (let row = 0; row <= segments; row++) {
    const t = row / segments
    const source = Math.round(t * (branch.points.length - 1))
    const point = branch.points[source] as Rgb
    const before = branch.points[Math.max(0, source - 1)] as Rgb
    const after = branch.points[Math.min(branch.points.length - 1, source + 1)] as Rgb
    const [dx, dy, dz] = treeUnit(after[0] - before[0], after[1] - before[1], after[2] - before[2])
    const u = treeUnit(dy, -dx, 0)
    const v: Rgb = [dz * -u[1], dz * u[0], dx * u[1] - dy * u[0]]
    const heightFraction = trunk
      ? (point[1] - (branch.points[0] as Rgb)[1]) /
        ((branch.points[branch.points.length - 1] as Rgb)[1] - (branch.points[0] as Rgb)[1])
      : t
    const taper =
      branch.tipRadius +
      (branch.radius - branch.tipRadius) * (1 - heightFraction) * (1 - 0.16 * heightFraction)
    for (let side = 0; side < sides; side++) {
      const [x, z] = treeCircle(side / sides)
      const normal: Rgb = [u[0] * x + v[0] * z, u[1] * x + v[1] * z, u[2] * x + v[2] * z]
      const foot = trunk ? Math.max(0, 1 - heightFraction * 8) ** 2 : 0
      const radius = taper * (1 + foot * (side % 2 === 0 ? 0.71 : 0.24))
      const shade = 0.84 + (0.11 * (side % 3)) / 2 + 0.05 * t
      const index = writeVertex(
        out,
        point[0] + normal[0] * radius,
        point[1] + (trunk && row === 0 ? 0 : normal[1] * radius),
        point[2] + normal[2] * radius,
        ...normal,
        BARK[0] * shade,
        BARK[1] * shade,
        BARK[2] * shade,
      )
      // An even mirrored repeat lets the last side meet the first without a duplicated seam.
      out.barkUV[2 * index] = 1 - Math.abs((2 * side) / sides - 1)
      out.barkUV[2 * index + 1] = branch.sides >= 6 ? row % 2 : t
    }
  }
  for (let row = 0; row < segments; row++)
    for (let side = 0; side < sides; side++) {
      const a = first + row * sides + side
      const b = first + row * sides + ((side + 1) % sides)
      writeTriangle(out, a, b, b + sides)
      writeTriangle(out, a, b + sides, a + sides)
    }
}

export function writeTreeSprigs(
  out: TreeWriter,
  shoot: TreeShoot,
  input: TreeParameters,
  palette: FoliagePalette,
  count: number,
  far: boolean,
) {
  const random = randomStream(shoot.seed + 109)
  const [sx, sy, sz] = treeUnit(
    shoot.end[0] - shoot.start[0],
    shoot.end[1] - shoot.start[1],
    shoot.end[2] - shoot.start[2],
  )
  const habit = TREE_HABITS[input.form]
  const pine = input.form === 'conifer'
  const radius = input.spreadM / 2
  const formScale =
    input.form === 'weeping' ? 1.48 : pine ? 1.28 : input.form === 'multistem' ? 1.07 : 1.27
  const length = (0.044 * input.heightM + 0.018 * input.spreadM) * formScale
  for (let i = 0; i < count; i++) {
    const t = random()
    const root = along(shoot.start, shoot.end, t)
    const [x, z] = treeCircle(random())
    const outward = treeUnit(
      root[0] / radius,
      (root[1] / input.heightM - 0.56) * 2.5,
      root[2] / radius,
    )
    const axis = treeUnit(
      sx * 0.75 + x * 0.85,
      sy * 0.38 + (random() - 0.31) * 1.4 - habit.pendulous * 1.7,
      sz * 0.75 + z * 0.85,
    )
    const cross = treeUnit(axis[2], 0, -axis[0])
    const roll = (random() - 0.5) * 1.65
    const widthAxis = treeUnit(
      cross[0] - axis[1] * cross[2] * roll,
      (axis[0] * cross[2] - axis[2] * cross[0]) * roll,
      cross[2] + axis[1] * cross[0] * roll,
    )
    const size =
      length *
      (0.68 + 0.58 * random()) *
      (far ? 3.05 : 1) *
      (pine ? Math.max(0.37, 1.36 - root[1] / input.heightM) : 1)
    const halfWidth = size * 0.48
    const normal = treeUnit(
      outward[0] * 0.8 + axis[0] * 0.2,
      outward[1] * 0.7 + 0.4 + random() * 0.22,
      outward[2] * 0.8 + axis[2] * 0.2,
    )
    // Orient the front toward the crown normal so two-sided lighting is coherent on the exterior.
    const nx = widthAxis[1] * axis[2] - widthAxis[2] * axis[1]
    const ny = widthAxis[2] * axis[0] - widthAxis[0] * axis[2]
    const nz = widthAxis[0] * axis[1] - widthAxis[1] * axis[0]
    const front = nx * normal[0] + ny * normal[1] + nz * normal[2] >= 0
    const tilt = front ? 0.28 : -0.28
    const litNormal = treeUnit(normal[0] + nx * tilt, normal[1] + ny * tilt, normal[2] + nz * tilt)
    const exposure = Math.min(
      1,
      (Math.sqrt(root[0] * root[0] + root[2] * root[2]) / radius) * 0.7 +
        (0.42 * root[1]) / input.heightM,
    )
    const tint = (pine ? 0.13 : 0.27) + 0.3 * exposure + 0.25 * random()
    const tone = foliageTone(palette, tint, (pine ? 0.73 : 0.83) + 0.15 * exposure)
    // Needles and the undersides of willow foliage carry a cooler reflected tone.
    const cool = pine ? 0.17 : input.form === 'weeping' ? 0.11 : 0
    tone[2] += (tone[1] - tone[2]) * cool
    const first = out.vertices
    out.sprigs[out.cards++] = far ? 3 : Math.floor(random() * 3)
    for (let corner = 0; corner < 4; corner++) {
      // At the coarse level a card carries several shoots and straddles the twig.
      const tip = corner > 1 ? 1 : 0
      const forward = (tip - (far ? 0.41 : 0.04)) * size
      const across = (corner === 0 || corner === 3 ? -1 : 1) * halfWidth
      writeVertex(
        out,
        root[0] + axis[0] * forward + widthAxis[0] * across,
        root[1] + axis[1] * forward + widthAxis[1] * across,
        root[2] + axis[2] * forward + widthAxis[2] * across,
        ...litNormal,
        tone[0] * (tip ? 1 : 0.8),
        tone[1] * (tip ? 1 : 0.85),
        tone[2] * (tip ? 1 : 0.88),
      )
    }
    if (front) {
      writeTriangle(out, first, first + 1, first + 2)
      writeTriangle(out, first, first + 2, first + 3)
    } else {
      writeTriangle(out, first, first + 2, first + 1)
      writeTriangle(out, first, first + 3, first + 2)
    }
  }
}
