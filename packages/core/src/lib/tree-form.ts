import type { TREE_FORMS } from '../schema/nodes/tree-limits'
import type { Rgb } from './foliage'

export { TREE_FORMS } from '../schema/nodes/tree-limits'
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

export type TreeInput = Omit<TreeParameters, 'spreadM'> & { spreadM?: number }

type Habit = {
  spread: number
  stems: number
  stemVariation: number
  scaffolds: number
  clear: number
  leader: number
  rise: number
  pendulous: number
}

/** Fractions of the requested height and crown diameter. */
export const TREE_HABITS: Readonly<Record<TreeForm, Habit>> = {
  round: {
    spread: 0.8,
    stems: 1,
    stemVariation: 0,
    scaffolds: 13,
    clear: 0.24,
    leader: 0.87,
    rise: 0.25,
    pendulous: 0,
  },
  spreading: {
    spread: 1.2,
    stems: 1,
    stemVariation: 0,
    scaffolds: 13,
    clear: 0.2,
    leader: 0.82,
    rise: 0.23,
    pendulous: 0.18,
  },
  upright: {
    spread: 0.36,
    stems: 1,
    stemVariation: 0,
    scaffolds: 16,
    clear: 0.14,
    leader: 0.94,
    rise: 0.25,
    pendulous: 0,
  },
  conifer: {
    spread: 0.57,
    stems: 1,
    stemVariation: 0,
    scaffolds: 40,
    clear: 0.17,
    leader: 1,
    rise: 0,
    pendulous: 0.35,
  },
  weeping: {
    spread: 1.05,
    stems: 1,
    stemVariation: 0,
    scaffolds: 12,
    clear: 0.23,
    leader: 0.9,
    rise: 0.38,
    pendulous: 1,
  },
  multistem: {
    spread: 0.85,
    stems: 3,
    stemVariation: 2,
    scaffolds: 4,
    clear: 0.16,
    leader: 0.86,
    rise: 0.24,
    pendulous: 0,
  },
}

export function defaultTreeSpread(form: TreeForm, heightM: number): number {
  return heightM * TREE_HABITS[form].spread
}

export function resolveTreeParameters(input: TreeInput): TreeParameters {
  return { ...input, spreadM: input.spreadM ?? defaultTreeSpread(input.form, input.heightM) }
}

export type TreeMesh = {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  /** Near sprigs are quads. A coarse bough fits a triangle. Both follow the wood vertices. */
  sprigCorners: 3 | 4
  sprigs: Uint8Array
  /** Local bark coordinates precede the sprigs. The renderer places them in its atlas. */
  barkUV: Float32Array
  index: Uint16Array | Uint32Array
}

export type TreeEstimate = {
  triangles: number
  farTriangles: number
  woodTriangles: number
  /** Number of two-triangle foliage primitives (sprig cards) at near detail. */
  leaves: number
}

export type TreeBranch = {
  points: Rgb[]
  radius: number
  tipRadius: number
  sides: number
  collar?: { axis: Rgb; parentRadius: number; rings: [Rgb, Rgb] }
}

export type TreeShoot = { start: Rgb; end: Rgb; seed: number }
export type TreeSkeleton = {
  branches: TreeBranch[]
  scaffolds: TreeBranch[]
  shoots: TreeShoot[]
  trunks: TreeBranch[]
}
