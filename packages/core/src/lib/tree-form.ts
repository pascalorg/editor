import type { Rgb } from './foliage'

export const TREE_FORMS = ['round', 'spreading', 'upright', 'weeping', 'multistem'] as const
export type TreeForm = (typeof TREE_FORMS)[number]
export const TREE_MAX_TRIANGLES = 12_000
export const TREE_FAR_MAX_TRIANGLES = 600

export type TreeParameters = {
  form: TreeForm
  heightM: number
  spreadM: number
  foliage: string
  density: number
  seed: number
  gen: 1
}

type Habit = {
  spread: number
  stems: number
  stemVariation: number
  clear: number
  leader: number
  scaffolds: number
  rise: number
  pull: number
  droop: number
  taper: number
  cluster: number
}

/** All silhouettes use the same branching rule; only these proportions change. */
export const TREE_HABITS: Readonly<Record<TreeForm, Readonly<Habit>>> = {
  round: {
    spread: 0.8,
    stems: 1,
    stemVariation: 0,
    clear: 0.24,
    leader: 0.77,
    scaffolds: 7,
    rise: 0.16,
    pull: 0.55,
    droop: 0,
    taper: 0,
    cluster: 1.15,
  },
  spreading: {
    spread: 1.2,
    stems: 1,
    stemVariation: 0,
    clear: 0.23,
    leader: 0.67,
    scaffolds: 8,
    rise: 0.13,
    pull: 0.3,
    droop: 0.05,
    taper: 0,
    cluster: 1.1,
  },
  upright: {
    spread: 0.36,
    stems: 1,
    stemVariation: 0,
    clear: 0.14,
    leader: 0.88,
    scaffolds: 9,
    rise: 0.12,
    pull: 0.55,
    droop: 0,
    taper: 0.15,
    cluster: 1.4,
  },
  weeping: {
    spread: 1.05,
    stems: 1,
    stemVariation: 0,
    clear: 0.3,
    leader: 0.79,
    scaffolds: 8,
    rise: 0.24,
    pull: 0.25,
    droop: 1,
    taper: 0,
    cluster: 1.2,
  },
  multistem: {
    spread: 0.85,
    stems: 3,
    stemVariation: 2,
    clear: 0.18,
    leader: 0.76,
    scaffolds: 3,
    rise: 0.14,
    pull: 0.5,
    droop: 0,
    taper: 0,
    cluster: 1.1,
  },
}

export function defaultTreeSpread(form: TreeForm, heightM: number): number {
  return heightM * TREE_HABITS[form].spread
}

export type TreeMesh = {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  index: Uint16Array | Uint32Array
}

export type TreeEstimate = {
  triangles: number
  farTriangles: number
  woodTriangles: number
  leaves: number
}

export type TreeBranch = {
  points: Rgb[]
  radius: number
  tipRadius: number
  sides: number
}

export type TreeCluster = { center: Rgb; radius: Rgb; axis: Rgb; seed: number }
export type TreeSkeleton = {
  branches: TreeBranch[]
  clusters: TreeCluster[]
  crowns: TreeCluster[]
  trunks: TreeBranch[]
}
