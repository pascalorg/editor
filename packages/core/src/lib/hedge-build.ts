import type { HedgeNode } from '../schema'
import type { GroundRead } from './ground-read'
import { HEDGE_MAX_TRIANGLES, type HedgeEstimate, type HedgeFormInput } from './hedge-form'
import { type HedgeFootRun, standHedgeLine } from './hedge-ground'
import { type HedgeLine, hedgeLine } from './hedge-line'

/** About 3,800 triangles a metre including the body at the 0.7 m by 1.2 m reference section. */
const LEAVES_PER_M = 1800
const REFERENCE_GIRTH = 3.1
const LEAF_SCALE = 0.65
const LEAF_COVER = 1.5
const LEAF_ASPECT = 0.6
const SHOOTS_PER_M = 3
const SPRIG_LEAVES = 7
const SHOOT_LEAVES = 3 * SPRIG_LEAVES
/** Station steps a mesh: a chunk a camera can cull, about 7 m of a hedge 0.7 m wide. */
export const HEDGE_CHUNK_ROWS = 48

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const cellRowsOf = (run: HedgeFootRun) => (run.ring ? run.stations.length : run.stations.length - 1)
const lengthOf = (run: HedgeFootRun) => run.to - run.from
const leavesOf = (run: HedgeFootRun, perM: number) =>
  cellRowsOf(run) > 0 ? Math.floor(perM * lengthOf(run)) : 0
const shootsOf = (run: HedgeFootRun, perM: number) =>
  cellRowsOf(run) > 0 ? Math.floor(perM * lengthOf(run)) : 0

/** Columns across the section, bottom of one side over the top to the bottom of the other. */
export function hedgeColumnsOf(input: HedgeFormInput): number {
  const columns = 2 * Math.round((2 * input.height + input.width) / 0.52) + 1
  return Math.min(19, Math.max(11, columns))
}

/** What a hedge of these numbers is given: its columns, and leaves and shoots a metre of run. */
export function hedgeBudgetOf(input: HedgeFormInput) {
  const columns = hedgeColumnsOf(input)
  let [bodyTriangles, planted] = [0, 0]
  for (const run of input.runs) {
    bodyTriangles += Math.max(0, cellRowsOf(run)) * (columns - 1) * 2
    planted += lengthOf(run)
  }
  const girth = 2 * input.height + input.width
  const size = input.leafSize * LEAF_SCALE * mix(1.4, 1, input.clip)
  const leafArea = (size * size * LEAF_ASPECT) / 2
  const wanted = Math.min(
    LEAVES_PER_M * Math.min(2.2, Math.max(0.6, girth / REFERENCE_GIRTH)),
    (LEAF_COVER * girth) / leafArea,
  )
  const loose = (1 - input.clip) * (1 - input.clip)
  const shoots = SHOOTS_PER_M * loose
  const room = Math.max(0, (HEDGE_MAX_TRIANGLES - bodyTriangles) / 2)
  const asked = (wanted + shoots * SHOOT_LEAVES) * planted
  const share = asked > room ? room / asked : 1
  return { columns, bodyTriangles, leavesPerM: wanted * share, shootsPerM: shoots * share }
}

/** Numeric estimate over a planned hedge: allocates only constant storage. */
export function estimateHedge(input: HedgeFormInput): HedgeEstimate {
  const { columns, bodyTriangles, leavesPerM, shootsPerM } = hedgeBudgetOf(input)
  let [leaves, vertices, meshes] = [0, 0, 0]
  for (const run of input.runs) {
    const cellRows = cellRowsOf(run)
    if (cellRows <= 0) continue
    const chunks = Math.ceil(cellRows / HEDGE_CHUNK_ROWS)
    meshes += chunks
    vertices += (cellRows + chunks) * columns
    leaves += leavesOf(run, leavesPerM) + shootsOf(run, shootsPerM) * SHOOT_LEAVES
  }
  return {
    triangles: bodyTriangles + leaves * 2,
    vertices: vertices + leaves * 4,
    bodyTriangles,
    leaves,
    meshes,
  }
}

export type HedgePlan = {
  line: HedgeLine
  runs: HedgeFootRun[]
  input: HedgeFormInput
  estimate: HedgeEstimate
  /** False when the estimate is over the cap: nothing is built. */
  withinBudget: boolean
}

/**
 * What a hedge would be built as, on a ground: its line, its runs standing on that ground, and
 * the count of what it would emit. Allocates only the stations (bounded by `HEDGE_MAX_STATIONS`); no mesh.
 */
export function planHedge(node: HedgeNode, ground: GroundRead): HedgePlan {
  const line = hedgeLine(node)
  const runs = standHedgeLine(line, node.width, ground)
  const input: HedgeFormInput = {
    height: node.height,
    width: node.width,
    clip: node.clip,
    leafSize: node.leafSize,
    leafColor: node.leafColor,
    seed: node.seed,
    runs,
    endRadius: line.endRadius,
  }
  const estimate = estimateHedge(input)
  return {
    line,
    runs,
    input,
    estimate,
    withinBudget: estimate.triangles <= HEDGE_MAX_TRIANGLES,
  }
}
