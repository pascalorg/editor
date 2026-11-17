import type { RampNode } from '../schema'
import { rampBounds, rampLength, rampProjectPoint } from './ramp'
import type { TerrainNodes, TerrainSite } from './terrain-tiles'

/**
 * A ramp's graded corridor, seen from the ground around it.
 *
 * Grading writes the corridor's lattice samples, so a lattice triangle that straddles the
 * corridor's edge reads a mix of lowered and natural samples and the ground beside the cut dips
 * toward the roadway by up to a cell. The ground outside the corridor is the natural ground: the
 * authority reads it from the tiles with the ramp's graded samples put back (see
 * `terrainAuthorityField`), and the corridor itself keeps the graded samples.
 */
export type RampCut = {
  ramp: RampNode
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
  /** The centreline's length: the roadway's two ends are cut edges like its sides. */
  length: number
}

/**
 * How far inside the corridor's edge, along a side or at an end, still reads as the ground beside
 * it, metres. The edge a mesh clips on is a chord of the true curve, up to a few millimetres
 * inside it.
 */
export const RAMP_EDGE_BAND_M = 0.02

/** The ramps whose grading the ground under `site` carries: cut-fill with a receipt of samples. */
export function rampsGradingOf(
  site: Pick<TerrainSite, 'id'> | null | undefined,
  nodes?: TerrainNodes,
): RampNode[] {
  if (!site?.id || !nodes) return []
  return Object.values(nodes)
    .filter(
      (node): node is RampNode =>
        node.type === 'ramp' &&
        node.parentId === site.id &&
        node.terrainMode === 'cut-fill' &&
        (node.terrainEffect?.samples.length ?? 0) > 0,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

const cutCache = new WeakMap<RampNode, RampCut | null>()

/** A ramp that cannot be measured has no corridor to protect: the ground never fails for it. */
export function rampCutOf(ramp: RampNode): RampCut | null {
  if (cutCache.has(ramp)) return cutCache.get(ramp) ?? null
  let cut: RampCut | null = null
  try {
    cut = { ramp, bounds: rampBounds(ramp), length: rampLength(ramp) }
  } catch {
    cut = null
  }
  cutCache.set(ramp, cut)
  return cut
}

/**
 * Whether the graded samples decide the height at a point: inside the corridor, clear of the
 * band along its edge. The band and everything beyond it is the ground beside the cut, a lattice
 * sample on the edge included: a tile write reads the stored samples through `readStoredHeightAt`.
 */
export function insideRampCut(cut: RampCut, x: number, z: number): boolean {
  const { bounds } = cut
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false
  const projected = rampProjectPoint(cut.ramp, [x, z])
  return (
    projected.inside &&
    cut.ramp.width / 2 - projected.lateral > RAMP_EDGE_BAND_M &&
    projected.distance > RAMP_EDGE_BAND_M &&
    projected.distance < cut.length - RAMP_EDGE_BAND_M
  )
}

export type GradedSample = { x: number; z: number; previousM: number; appliedM: number }

/** Every lattice sample the ramps' receipts recorded, with the height before and after. */
export function gradedSamplesOf(ramps: readonly RampNode[]): GradedSample[] {
  const samples: GradedSample[] = []
  for (const ramp of ramps) {
    const effect = ramp.terrainEffect
    if (!effect) continue
    const count = effect.cols * effect.rows
    for (const [index, previous, applied] of effect.samples) {
      if (!Number.isInteger(index) || index < 0 || index >= count) continue
      samples.push({
        x: effect.origin[0] + (index % effect.cols) * effect.spacing,
        z: effect.origin[1] + Math.floor(index / effect.cols) * effect.spacing,
        previousM: previous * effect.step,
        appliedM: applied * effect.step,
      })
    }
  }
  return samples
}
