import type { Rgb } from './foliage'
import { hash3, hashSeed, randomStream } from './seeded-noise'
import {
  TREE_HABITS,
  type TreeBranch,
  type TreeCluster,
  type TreeParameters,
  type TreeSkeleton,
} from './tree-form'

export function treeStemCount(input: TreeParameters): number {
  const habit = TREE_HABITS[input.form]
  return habit.stems + Math.floor(hash3(input.seed, 1, 2, 3) * (habit.stemVariation + 1))
}

export function treePrimaryCount(input: TreeParameters): number {
  const habit = TREE_HABITS[input.form]
  return treeStemCount(input) * habit.scaffolds
}

export function treeUnit(x: number, y: number, z: number): Rgb {
  const length = Math.sqrt(x * x + y * y + z * z)
  if (length < 1e-12) return [0, 1, 0]
  return [x / length, y / length, z / length]
}

export function treeClusterFrame(axis: Rgb): [Rgb, Rgb, Rgb] {
  const across = treeUnit(axis[1], -axis[0], 0)
  const side: Rgb = [
    axis[1] * across[2] - axis[2] * across[1],
    axis[2] * across[0] - axis[0] * across[2],
    axis[0] * across[1] - axis[1] * across[0],
  ]
  return [across, axis, side]
}

function envelope(input: TreeParameters, point: Rgb): Rgb {
  const habit = TREE_HABITS[input.form]
  const bottom = habit.clear * 0.55
  const y = Math.min(0.96, Math.max(bottom, point[1]))
  const t = (y - bottom) / (1 - bottom)
  const broad = Math.sqrt(Math.max(0.02, 1 - (2 * t - 1) * (2 * t - 1)))
  const radius = (broad * (1 - habit.taper) + (1 - t) * habit.taper) * 0.92
  const distance = Math.sqrt(point[0] * point[0] + point[2] * point[2])
  const scale = distance > radius ? radius / distance : 1
  return [point[0] * scale, y, point[2] * scale]
}

function metres(input: TreeParameters, [x, y, z]: Rgb): Rgb {
  return [(x * input.spreadM) / 2, y * input.heightM, (z * input.spreadM) / 2]
}

function limb(
  input: TreeParameters,
  start: Rgb,
  end: Rgb,
  radius: number,
  depth: number,
  seed: number,
): TreeBranch {
  const random = randomStream(seed)
  const segments = depth < 0 ? 5 : depth === 0 ? 4 : depth === 1 ? 3 : depth === 2 ? 2 : 1
  const points: Rgb[] = []
  const bend: Rgb = [(random() - 0.5) * 0.12, (random() - 0.5) * 0.05, (random() - 0.5) * 0.12]
  for (let segment = 0; segment <= segments; segment++) {
    const t = segment / segments
    const noise = t * (1 - t)
    points.push(
      metres(input, [
        start[0] + (end[0] - start[0]) * t + bend[0] * noise,
        start[1] + (end[1] - start[1]) * t + bend[1] * noise,
        start[2] + (end[2] - start[2]) * t + bend[2] * noise,
      ]),
    )
  }
  return {
    points,
    radius,
    tipRadius: radius * (depth < 0 ? 0.17 : 0.38 + random() * 0.12),
    sides: depth < 0 ? 8 : depth === 0 ? 6 : depth === 1 ? 5 : 3,
  }
}

function cluster(input: TreeParameters, start: Rgb, end: Rgb, seed: number): TreeCluster {
  const habit = TREE_HABITS[input.form]
  const size = habit.cluster * (0.8 + hash3(seed, 3, 5, 7) * 0.4)
  const bottom = metres(input, start)
  const top = metres(input, end)
  const delta: Rgb = [top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]]
  const length = Math.sqrt(delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2])
  const width = input.spreadM * 0.075 * size
  return {
    center: [bottom[0] + delta[0] * 0.4, bottom[1] + delta[1] * 0.4, bottom[2] + delta[2] * 0.4],
    radius: [width, length * 0.8 + input.heightM * 0.06 * size, width],
    axis: treeUnit(...delta),
    seed,
  }
}

function grow(
  input: TreeParameters,
  skeleton: TreeSkeleton,
  start: Rgb,
  end: Rgb,
  radius: number,
  depth: number,
  seed: number,
) {
  skeleton.branches.push(limb(input, start, end, radius, depth, seed))
  const habit = TREE_HABITS[input.form]
  if (depth === 2) skeleton.clusters.push(cluster(input, start, end, seed))
  if (depth === 3) return
  const random = randomStream(seed + 31)
  const children = depth === 0 ? 3 : 2
  const direction = treeUnit(end[0] - start[0], 0, end[2] - start[2])
  const ratio = depth === 0 ? 1 : depth === 1 ? 0.68 : 0.46
  const reach = (0.19 + random() * 0.16) * ratio
  for (let child = 0; child < children; child++) {
    const attach = child === 0 ? 1 : 0.5 + random() * 0.42
    const fork: Rgb = [
      start[0] + (end[0] - start[0]) * attach,
      start[1] + (end[1] - start[1]) * attach,
      start[2] + (end[2] - start[2]) * attach,
    ]
    const turn = (child - (children - 1) / 2) * (0.65 + random() * 0.5)
    const continuation = child === 0 ? 0.35 : 1
    const upward = (0.055 + random() * 0.16) * habit.pull * ratio * (child === 0 ? 1.3 : 0.85)
    const drop = habit.droop * (depth + 1) * (0.018 + random() * 0.035)
    const target = envelope(input, [
      fork[0] + (direction[0] - direction[2] * turn) * reach * continuation,
      fork[1] + upward - drop,
      fork[2] + (direction[2] + direction[0] * turn) * reach * continuation,
    ])
    grow(
      input,
      skeleton,
      fork,
      target,
      radius * (0.48 + random() * 0.12),
      depth + 1,
      hashSeed(seed, child, depth, 11),
    )
  }
}

function crownBounds(clusters: TreeCluster[], from: number, seed: number): TreeCluster {
  const low: Rgb = [Infinity, Infinity, Infinity]
  const high: Rgb = [-Infinity, -Infinity, -Infinity]
  for (let i = from; i < clusters.length; i++) {
    const clump = clusters[i] as TreeCluster
    const frame = treeClusterFrame(clump.axis)
    for (const axis of [0, 1, 2] as const) {
      const a = frame[0][axis] * clump.radius[0]
      const b = frame[1][axis] * clump.radius[1]
      const c = frame[2][axis] * clump.radius[2]
      const radius = Math.sqrt(a * a + b * b + c * c)
      low[axis] = Math.min(low[axis], clump.center[axis] - radius)
      high[axis] = Math.max(high[axis], clump.center[axis] + radius)
    }
  }
  return {
    center: [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2],
    radius: [(high[0] - low[0]) * 0.47, (high[1] - low[1]) * 0.47, (high[2] - low[2]) * 0.47],
    axis: [0, 1, 0],
    seed,
  }
}

function growStem(input: TreeParameters, skeleton: TreeSkeleton, stem: number, stems: number) {
  const habit = TREE_HABITS[input.form]
  const random = randomStream(hashSeed(input.seed, stem, 0, 17))
  let direction = treeUnit(random() - 0.5, 0, random() - 0.5)
  const offset = stems > 1 ? 0.035 : 0
  const lean = stems > 1 ? 0.28 : 0.045
  const root: Rgb = [direction[0] * offset, -0.002, direction[2] * offset]
  const top: Rgb = [direction[0] * lean, habit.leader, direction[2] * lean]
  const radius = input.heightM * (stems > 1 ? 0.012 : 0.019)
  const trunk = limb(input, root, top, radius, -1, hashSeed(input.seed, stem, 0, 23))
  skeleton.trunks.push(trunk)
  for (let tier = 0; tier < habit.scaffolds; tier++) {
    const t = (tier + 0.2 + random() * 0.55) / habit.scaffolds
    const y = habit.clear + (habit.leader - habit.clear - habit.rise) * t
    direction = treeUnit(
      -direction[0] * 0.737 - direction[2] * 0.675,
      0,
      direction[0] * 0.675 - direction[2] * 0.737,
    )
    const start: Rgb = [(top[0] * y) / habit.leader, y, (top[2] * y) / habit.leader]
    const reach = (0.3 + random() * 0.4) * (1 - t * 0.46)
    const end = envelope(input, [
      direction[0] * reach,
      y + habit.rise * (0.7 + random() * 0.6),
      direction[2] * reach,
    ])
    const seed = hashSeed(input.seed, stem, tier, 0)
    const from = skeleton.clusters.length
    grow(input, skeleton, start, end, radius * (0.36 + (1 - t) * 0.28), 0, seed)
    skeleton.crowns.push(crownBounds(skeleton.clusters, from, seed))
  }
}

export function treeSkeleton(input: TreeParameters): TreeSkeleton {
  const skeleton: TreeSkeleton = { trunks: [], branches: [], clusters: [], crowns: [] }
  const stems = treeStemCount(input)
  for (let stem = 0; stem < stems; stem++) growStem(input, skeleton, stem, stems)
  return skeleton
}
