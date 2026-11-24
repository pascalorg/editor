import type { AnyNode, HedgeNode } from '../schema'
import { resolveSiteGround } from './ground-read'
import { planHedge } from './hedge-build'
import { hedgeGroundRange } from './hedge-ground'
import type { HedgeGapFact } from './hedge-line'

type Nodes = Readonly<Record<string, AnyNode>>

export type HedgeFacts = {
  /** Length of the smoothed line, openings included, and the length that is planted. */
  lengthM: number
  plantedM: number
  /** Planted stretches between the openings. */
  runs: number
  heightM: number
  widthM: number
  clip: number
  closed: boolean
  curve: boolean
  /** Every opening asked for: where it was left on the line, or why it was not. */
  gaps: HedgeGapFact[]
  /** Stretches between two openings too short to plant, left open. */
  notPlanted: { fromM: number; toM: number }[]
  /** The ground under the hedge, in metres above the Site's datum. */
  groundM: { lowest: number; highest: number }
  triangles: number
  trianglesPerM: number
  meshes: number
  /** Single generator version (1). */
  gen: number
}

const round = (value: number) => Math.round(value * 100) / 100

/** What a hedge is, on the ground its Site has stored: facts, not judgements. */
export function hedgeFacts(hedge: HedgeNode, nodes: Nodes): HedgeFacts {
  const { line, runs, estimate } = planHedge(hedge, resolveSiteGround(hedge.parentId, nodes))
  const ground = hedgeGroundRange(runs)
  return {
    lengthM: round(line.length),
    plantedM: round(line.planted),
    runs: line.runs.length,
    heightM: hedge.height,
    widthM: hedge.width,
    clip: hedge.clip,
    closed: line.closed,
    curve: hedge.curve,
    gaps: line.gaps.map((gap) => ({
      ...gap,
      atM: round(gap.atM),
      ...(gap.fromM === undefined ? {} : { fromM: round(gap.fromM) }),
      ...(gap.toM === undefined ? {} : { toM: round(gap.toM) }),
    })),
    notPlanted: line.tooShort.map(({ fromM, toM }) => ({ fromM: round(fromM), toM: round(toM) })),
    groundM: { lowest: round(ground.lowest), highest: round(ground.highest) },
    triangles: estimate.triangles,
    trianglesPerM: line.planted > 0 ? Math.round(estimate.triangles / line.planted) : 0,
    meshes: estimate.meshes,
    gen: 1,
  }
}
