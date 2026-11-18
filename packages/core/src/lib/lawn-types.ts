import type { LawnStroke } from '../schema/nodes/lawn'
import type { LawnExclusion } from './lawn-scene'
import type { MultiPolygon } from './polygon-boolean'

export type LawnMesh = {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  indices: Uint32Array
}
export type LawnChunk = {
  key: string
  start: number
  count: number
  midCount: number
  bounds: [number, number, number, number]
}
export const LAWN_MAX_STROKE_WORK = 32_000_000

export function assertLawnStrokeWork(work: number): void {
  if (work > LAWN_MAX_STROKE_WORK)
    throw new LawnBuildError(
      'lawn_work_budget',
      `Lawn combined stroke work requires ${work} segment visits; the compute budget is 32,000,000. Use fewer brush points or a smaller lawn.`,
    )
}

export type LawnFacts = {
  requestedAreaM2: number
  retainedAreaM2: number
  coverageFraction: number
  exclusions: LawnExclusion[]
  excludedUnionAreaM2: number
  bladeCount: number
  flowerCount: number
  gen: number
  budget: {
    candidateCount: number
    maxCandidates: number
    baseTriangles: number
    maxBaseTriangles: number
    requestedFlowers: number
    flowerThinned: boolean
    /** Conservative candidate, topology, base-vertex, flower and area-probe segment visits. */
    strokeWorkEstimate: number
    maxStrokeWork: number
  }
  strokeAreas: {
    estimated: true
    samplingResolutionM: number
    minimumSamplingResolutionM: number
    sampleCount: number
    byEffect: Record<LawnStroke['effect'], number>
    unionAreaM2: number
  }
}
export type LawnBuild = {
  polygons: MultiPolygon
  base: LawnMesh & { cover?: Float32Array }
  blades: {
    rootHeight: Float32Array
    traits: Float32Array
    count: number
    chunks: LawnChunk[]
    tuftWidthScale: number
  }
  flowers: LawnMesh & {
    uv: Uint16Array
    count: number
    speciesCounts: Record<'daisy' | 'clover' | 'yarrow', number>
    headIndexEnds: Uint32Array
  }
  facts: LawnFacts
}
export class LawnBuildError extends Error {
  constructor(
    readonly code: 'lawn_work_budget' | 'lawn_empty' | 'lawn_terrain_budget',
    message: string,
  ) {
    super(message)
    this.name = 'LawnBuildError'
  }
}
