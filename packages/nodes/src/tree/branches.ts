import {
  hash3,
  hashSeed,
  type Rgb,
  randomStream,
  TREE_HABITS,
  type TreeBranch,
  type TreeParameters,
  type TreeSkeleton,
} from '@pascal-app/core'

const TRUNK_RINGS = [0, 0.045, 0.16, 0.29, 0.44, 0.6, 0.75, 0.88, 1] as const

export function treeStemCount(input: Pick<TreeParameters, 'form' | 'seed'>): number {
  const habit = TREE_HABITS[input.form]
  return habit.stems + Math.floor(hash3(input.seed, 1, 2, 3) * (habit.stemVariation + 1))
}

export function treeUnit(x: number, y: number, z: number): Rgb {
  const length = Math.sqrt(x * x + y * y + z * z)
  return length < 1e-10 ? [0, 1, 0] : [x / length, y / length, z / length]
}

/** Rational parametrisation of the unit circle keeps seeded geometry bit-reproducible. */
export function treeCircle(turn: number): [number, number] {
  const phase = (turn - Math.floor(turn)) * 4
  const quadrant = Math.floor(phase)
  const t = phase - quadrant
  const x = (1 - t * t) / (1 + t * t)
  const z = (2 * t) / (1 + t * t)
  return quadrant === 0 ? [x, z] : quadrant === 1 ? [-z, x] : quadrant === 2 ? [-x, -z] : [z, -x]
}

export function along(start: Rgb, end: Rgb, t: number): Rgb {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
    start[2] + (end[2] - start[2]) * t,
  ]
}

function onBranch(branch: TreeBranch, fraction: number): Rgb {
  const t = fraction * (branch.points.length - 1)
  const i = Math.min(branch.points.length - 2, Math.floor(t))
  return along(branch.points[i] as Rgb, branch.points[i + 1] as Rgb, t - i)
}

// Bend is the offset at the midpoint. Children attach to this curved centreline.
function limb(
  start: Rgb,
  end: Rgb,
  bend: Rgb,
  radius: number,
  tip: number,
  sides: number,
  segments: number,
): TreeBranch {
  const points: Rgb[] = []
  for (let row = 0; row <= segments; row++) {
    const t = sides === 9 ? (TRUNK_RINGS[row] as number) : row / segments
    const arc = 4 * t * (1 - t)
    const p = along(start, end, t)
    const wave = sides === 9 ? arc * (1.5 - 3 * t) : arc
    const twist = arc * (1 - 2 * t) * 0.72
    points.push([
      p[0] + bend[0] * wave - bend[2] * twist,
      p[1] + bend[1] * arc,
      p[2] + bend[2] * wave + bend[0] * twist,
    ])
  }
  return { points, radius, tipRadius: radius * tip, sides }
}

export function branchRadius(branch: TreeBranch, t: number): number {
  return branch.tipRadius + (branch.radius - branch.tipRadius) * (1 - t) * (1 - 0.16 * t)
}

// Ease the new axis away from its parent. The first ring starts inside the parent
// and the collar follows the grain before turning out toward the crown.
function joinLimb(branch: TreeBranch, parent: TreeBranch, at: number) {
  const before = onBranch(parent, Math.max(0, at - 0.04))
  const after = onBranch(parent, Math.min(1, at + 0.04))
  const axis = treeUnit(after[0] - before[0], after[1] - before[1], after[2] - before[2])
  const base = branch.points[0]!
  const next = branch.points[1]!
  const length = Math.sqrt(
    (next[0] - base[0]) ** 2 + (next[1] - base[1]) ** 2 + (next[2] - base[2]) ** 2,
  )
  // A quadratic joins the two tangents without a sharp elbow at the collar.
  const handle = Math.min(length * 0.47, branch.radius * 2.6)
  const control: Rgb = [
    base[0] + axis[0] * handle,
    base[1] + axis[1] * handle,
    base[2] + axis[2] * handle,
  ]
  const curve = (t: number) => along(along(base, control, t), along(control, next, t), t)
  const bottom = parent.points[0]![1]
  const t =
    parent.sides === 9
      ? (base[1] - bottom) / (parent.points[parent.points.length - 1]![1] - bottom)
      : at
  branch.collar = {
    axis,
    rings: [curve(0.32), curve(0.66)],
    parentRadius: branchRadius(parent, t),
  }
}

function trunkFraction(trunk: TreeBranch, y: number): number {
  const i = trunk.points.findIndex((p) => p[1] >= y)
  if (i < 1) return i === 0 ? 0 : 1
  const a = trunk.points[i - 1]!,
    b = trunk.points[i]!
  return (i - 1 + (y - a[1]) / (b[1] - a[1])) / (trunk.points.length - 1)
}

function growBough(
  tree: TreeSkeleton,
  input: TreeParameters,
  parent: TreeBranch,
  heading: number,
  reach: number,
  lift: number,
  radius: number,
  seed: number,
  depth: number,
) {
  const random = randomStream(seed)
  const pine = input.form === 'conifer'
  const droop = TREE_HABITS[input.form].pendulous
  const count = pine ? 6 : depth === 1 ? 4 : 3
  for (let i = 0; i < count; i++) {
    const base = pine ? 0.06 : 0.34
    const t = base + ((1 - base) * (i + random() * 0.7)) / count
    const side = i % 2 === 0 ? -1 : 1
    const turn = heading + side * (0.07 + random() * 0.17) * (1.15 - t * 0.45)
    const [dx, dz] = treeCircle(turn)
    const start = onBranch(parent, t)
    const run = reach * (0.7 + random() * 0.55) * (pine ? 1.35 - t * 0.8 : 1)
    const rise =
      lift * (0.36 + random() * 1.27) +
      (random() - 0.47) * input.heightM * (pine ? 0.025 : 0.065) -
      (depth === 2 ? droop * input.heightM * (0.1 + random() * 0.19) : 0)
    const end: Rgb = [start[0] + dx * run, start[1] + rise, start[2] + dz * run]
    const branch = limb(
      start,
      end,
      [-dz * run * 0.08, Math.abs(rise) * (droop > 0.7 ? 0.3 : 0.13), dx * run * 0.08],
      radius * (1.08 - t * 0.43),
      0.18,
      depth === 1 && !pine ? 4 : 3,
      depth === 1 && !pine ? 3 : 2,
    )
    tree.branches.push(branch)
    const childSeed = hashSeed(seed, i, depth, 33)
    if (depth === 2 || pine)
      tree.shoots.push({ start: onBranch(branch, pine ? 0.08 : 0.47), end, seed: childSeed })
    else {
      tree.shoots.push({ start: onBranch(branch, 0.67), end, seed: hashSeed(childSeed, 9, 1, 3) })
      growBough(
        tree,
        input,
        branch,
        turn,
        reach * (0.58 + random() * 0.32),
        lift * 0.64,
        radius * 0.42,
        childSeed,
        2,
      )
    }
  }
}

function growStem(tree: TreeSkeleton, input: TreeParameters, stem: number, stems: number) {
  const habit = TREE_HABITS[input.form]
  const pine = input.form === 'conifer'
  const weeping = input.form === 'weeping'
  const random = randomStream(hashSeed(input.seed, stem, habit.scaffolds, 23))
  const h = input.heightM,
    r = input.spreadM / 2
  const rotation = hash3(input.seed, habit.clear * 100, 1, 2) + stem / stems
  const [lx, lz] = treeCircle(rotation)
  const lean = (stems > 1 ? 0.32 + random() * 0.12 : pine ? 0 : 0.16 + random() * 0.14) * r
  const rootOffset = stems > 1 ? r * 0.042 : 0
  const root: Rgb = [lx * rootOffset, -0.002 * h, lz * rootOffset]
  const height = habit.leader * h * (stems > 1 ? 0.88 + 0.12 * random() : 1)
  const top: Rgb = [lx * lean, height, lz * lean]
  const baseRadius =
    Math.min(r * 0.14, h * (stems > 1 ? 0.012 : pine ? 0.016 : 0.023)) * (0.9 + 0.2 * random())
  const trunk = limb(root, top, [-lz * lean * 0.53, 0, lx * lean * 0.53], baseRadius, 0.025, 9, 8)
  tree.trunks.push(trunk)
  const forks: { branch: TreeBranch; dx: number; dz: number }[] = []
  // Each pair of growth seasons produces ten boughs, distributed unevenly.
  // The shared annual height keeps real whorls while varying the gaps between them.
  let tier = -1
  let whorlStart = 0
  let whorlEnd = 0
  let whorlHeight = 0
  for (let i = 0; i < habit.scaffolds; i++) {
    const seed = hashSeed(input.seed, stem, i, 11)
    if (pine) {
      if (i === whorlEnd) {
        tier++
        whorlStart = i
        whorlEnd = tier % 2 === 0 ? i + 3 + Math.floor(random() * 5) : (tier + 1) * 5
        whorlHeight = (tier + 0.12 + random() * 0.68) / 8
      }
      const t = whorlHeight + (random() - 0.5) * 0.045
      const turn =
        rotation + tier * 0.381966 + (i - whorlStart + random() * 0.56) / (whorlEnd - whorlStart)
      const [dx, dz] = treeCircle(turn)
      const y = habit.clear + (0.98 - habit.clear) * t
      const start = onBranch(trunk, trunkFraction(trunk, h * y))
      const run = r * (1 - t) * (0.51 + 0.65 * random())
      const drop = run * (0.15 + 0.38 * random())
      const lift = run * t * t * (0.5 + 0.57 * random())
      const end: Rgb = [start[0] + dx * run, start[1] + lift - drop, start[2] + dz * run]
      const radius = baseRadius * 0.34 * (1 - 0.86 * t)
      const branch = limb(
        start,
        end,
        [dz * run * 0.055, drop * 0.24, -dx * run * 0.055],
        radius,
        0.12,
        4,
        3,
      )
      tree.scaffolds.push(branch)
      growBough(
        tree,
        input,
        branch,
        turn,
        run * 0.39,
        lift * 0.55 - h * (0.008 + 0.035 * random()) * (1 - t),
        radius * 0.42,
        seed,
        1,
      )
      tree.shoots.push({ start: onBranch(branch, 0.08), end, seed })
      continue
    }
    // Each scaffold grows toward a pocket in the crown. The first three can
    // become co-dominant limbs from which later scaffolds fork in the same sector.
    const major = stems === 1 && i < 3
    const t = major
      ? 0.28 + random() * 0.32
      : (i - (stems === 1 ? 3 : 0) + random()) / (habit.scaffolds - (stems === 1 ? 3 : 0))
    const turn = rotation + i * 0.381966 + (random() - 0.5) * 0.12
    const [dx, dz] = treeCircle(turn)
    const base = habit.clear + habit.rise * (weeping ? 0.86 : 0.58)
    const targetY = (base + (0.92 - base) * t) * h
    const shape = 0.05 + 0.89 * t
    const width = Math.sqrt(1 - (2 * shape - 1) ** 2)
    const reach =
      r *
      (0.42 + 0.58 * width) *
      (stems > 1 ? 0.78 : 1) *
      (1 - 0.48 * Math.max(0, (t - 0.67) / 0.33))
    const radial = reach * (0.55 + 0.33 * random())
    const end: Rgb = [dx * radial + top[0] * 0.66, targetY, dz * radial + top[2] * 0.66]
    const startY = major
      ? h * (habit.clear + i * 0.065 + random() * 0.035)
      : Math.max((habit.clear + 0.052 * random()) * h, targetY - h * (0.16 + 0.21 * random()))
    let parentBranch = trunk
    let attachment = trunkFraction(trunk, Math.min(startY, height * 0.85))
    let radius = baseRadius * (major ? 0.64 : 0.52) * (1 - (0.86 * startY) / h)
    if (!major && targetY > h * 0.54) {
      const parent = forks.find((fork) => dx * fork.dx + dz * fork.dz > 0.54)
      if (parent) {
        const at = 0.36 + 0.38 * random()
        parentBranch = parent.branch
        attachment = at
        radius = parent.branch.radius * (1 - at * 0.84) * 0.71
      }
    }
    const start = onBranch(parentBranch, attachment)
    const arc = reach * (random() - 0.5) * 0.29
    const bend: Rgb = [-dz * arc, (end[1] - start[1]) * (weeping ? 0.15 : -0.09), dx * arc]
    const branch = limb(start, end, bend, radius, 0.13, 6, 4)
    joinLimb(branch, parentBranch, attachment)
    tree.scaffolds.push(branch)
    if (major) forks.push({ branch, dx, dz })
    const lift = h * habit.rise * (0.24 + 0.3 * random()) * (1 - 0.73 * t)
    growBough(
      tree,
      input,
      branch,
      turn,
      reach * (0.32 + 0.12 * random()),
      lift,
      radius * 0.45,
      seed,
      1,
    )
    tree.shoots.push({ start: onBranch(branch, 0.75), end, seed })
  }
  // The youngest shoots clothe the leader too, including the tip between the last whorl and the apex.
  const leaders = pine ? 13 : 6
  for (let i = 0; i < leaders; i++) {
    const t = (i + 1) / leaders
    const start = onBranch(
      trunk,
      trunkFraction(trunk, height * (pine ? 0.51 + t * 0.46 : 0.67 + t * 0.3)),
    )
    const [dx, dz] = treeCircle(rotation + i * 0.381966)
    const run = r * (pine ? 0.31 * (0.55 + 0.7 * random()) : 0.28) * (1 - 0.82 * t)
    const end: Rgb = [
      start[0] + dx * run,
      start[1] + height * (pine ? 0.03 : 0.07),
      start[2] + dz * run,
    ]
    const shoot = limb(
      start,
      end,
      [dz * run * 0.12, 0, -dx * run * 0.12],
      baseRadius * 0.14 * (1 - 0.85 * t),
      0.1,
      3,
      2,
    )
    tree.branches.push(shoot)
    tree.shoots.push({ start, end, seed: hashSeed(input.seed, stem, i, 71) })
  }
}

export function treeSkeleton(input: TreeParameters): TreeSkeleton {
  const tree: TreeSkeleton = { trunks: [], scaffolds: [], branches: [], shoots: [] }
  const stems = treeStemCount(input)
  for (let stem = 0; stem < stems; stem++) growStem(tree, input, stem, stems)
  return tree
}
