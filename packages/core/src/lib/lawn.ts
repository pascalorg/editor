import type { AnyNode } from '../schema'
import { LAWN_LIMITS, LawnNode } from '../schema/nodes/lawn'
import { type LawnCoverage, lawnCoverage } from './lawn-coverage'
import { lawnFlowerProbes, lawnFlowers } from './lawn-flowers'
import {
  type LawnGroundAxes,
  type LawnGroundTriangle,
  lawnGroundAxes,
  lawnGroundMesh,
  lawnGroundTriangles,
  lawnGroundTrianglesIn,
  lawnSwath,
} from './lawn-ground'
import { retainedLawn } from './lawn-scene'
import { lawnStrokeAreas } from './lawn-stroke-area'
import { sampleLawnStrokes } from './lawn-strokes'
import {
  assertLawnStrokeWork,
  LAWN_MAX_STROKE_WORK,
  type LawnBuild,
  LawnBuildError,
  type LawnChunk,
  type LawnFacts,
} from './lawn-types'
import { plantingBounds } from './planting-outline'
import type { MultiPolygon } from './polygon-boolean'
import { hash3, valueNoise3 } from './seeded-noise'
import { FLAT_GROUND_Y } from './site-ground-height'
import { heightAt } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

export { sampleLawnStrokes } from './lawn-strokes'
export type { LawnBuild, LawnChunk, LawnFacts, LawnMesh } from './lawn-types'
export { LawnBuildError } from './lawn-types'

export type LawnPlan = {
  node: LawnNode
  polygons: MultiPolygon
  triangles: LawnGroundTriangle[]
  coverage: LawnCoverage
  groundHeight: (x: number, z: number) => number
  facts: LawnFacts
}

// The live tuft spans this many individual blade widths. Its edge clearance and
// renderer must agree, including at the widest authored blade setting.
const TUFT_WIDTH_SCALE = 20
const EDGE_FAN_SHARE = 0.64

type Nodes = Readonly<Record<string, AnyNode>>
type Blade = {
  root: [number, number, number, number]
  traits: [number, number, number, number]
  bucket: number
}
type Chunk = { key: string; bounds: [number, number, number, number]; buckets: Blade[][] }

function candidateBounds(polygons: MultiPolygon) {
  const bounds = plantingBounds(polygons.flatMap((polygon) => polygon.outer))
  const minX = Math.floor(bounds.minX),
    maxX = Math.ceil(bounds.maxX)
  const minZ = Math.floor(bounds.minZ),
    maxZ = Math.ceil(bounds.maxZ)
  return { minX, minZ, maxX, maxZ, count: (maxX - minX) * (maxZ - minZ) * 100 }
}

export function planLawn(input: LawnNode, nodes: Nodes): LawnPlan {
  const node = LawnNode.parse(input)
  const retained = retainedLawn(node, nodes)
  if (retained.retainedAreaM2 < 1e-6)
    throw new LawnBuildError(
      'lawn_empty',
      'No lawn area remains after property and owner exclusions.',
    )
  const candidates = candidateBounds(retained.polygons)
  if (candidates.count > LAWN_LIMITS.maxCandidates)
    throw new LawnBuildError(
      'lawn_work_budget',
      `Lawn requires ${candidates.count} candidate cells; maximum ${LAWN_LIMITS.maxCandidates}.`,
    )
  const strokePoints = node.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0)
  assertLawnStrokeWork(candidates.count * strokePoints)
  const site = node.parentId ? nodes[node.parentId] : undefined
  const field = site?.type === 'site' ? persistedTerrainFieldOf(site) : null
  const groundHeight = field ? (x: number, z: number) => heightAt(field, x, z) : () => FLAT_GROUND_Y
  const coverage = lawnCoverage(retained.polygons)
  const topologyWork = { visits: candidates.count * strokePoints, points: strokePoints }
  const triangles = lawnGroundTriangles(retained.polygons, node, field, topologyWork)
  const flowerProbes = lawnFlowerProbes(
    node,
    candidates.maxX - candidates.minX,
    candidates.maxZ - candidates.minZ,
  )
  const strokeWork = topologyWork.visits + (triangles.length * 3 + flowerProbes) * strokePoints
  assertLawnStrokeWork(strokeWork)
  const sampledAreas = lawnStrokeAreas(node, coverage, candidates, strokeWork)
  const facts: LawnFacts = {
    requestedAreaM2: retained.requestedAreaM2,
    retainedAreaM2: retained.retainedAreaM2,
    coverageFraction: retained.retainedAreaM2 / retained.requestedAreaM2,
    exclusions: retained.exclusions,
    excludedUnionAreaM2: retained.requestedAreaM2 - retained.retainedAreaM2,
    bladeCount: 0,
    flowerCount: 0,
    gen: node.gen,
    budget: {
      candidateCount: candidates.count,
      maxCandidates: LAWN_LIMITS.maxCandidates,
      baseTriangles: triangles.length,
      maxBaseTriangles: LAWN_LIMITS.maxBaseTriangles,
      requestedFlowers: 0,
      flowerThinned: false,
      strokeWorkEstimate: sampledAreas.strokeWork,
      maxStrokeWork: LAWN_MAX_STROKE_WORK,
    },
    strokeAreas: sampledAreas.areas,
  }
  return { node, polygons: retained.polygons, triangles, coverage, groundHeight, facts }
}

function bladeAt(
  plan: Pick<LawnPlan, 'node' | 'coverage' | 'groundHeight'>,
  col: number,
  row: number,
  candidate: number,
  interior: boolean,
): Blade | null {
  const { node, coverage, groundHeight } = plan
  // Rotate a low-discrepancy patch independently in each metre square. Small jitter
  // breaks alignment while leaving room for adjacent tillers to overlap.
  const wrap = (v: number) => v - Math.floor(v)
  const x =
    col +
    wrap(
      hash3(node.seed, col, row, 0) +
        candidate * 0.754877666 +
        hash3(node.seed + 11, col, row, candidate) * 0.048,
    )
  const z =
    row +
    wrap(
      hash3(node.seed + 1, col, row, 0) +
        candidate * 0.569840291 +
        hash3(node.seed + 12, col, row, candidate) * 0.048,
    )
  if (!interior && !coverage.contains(x, z)) return null
  const strokes = sampleLawnStrokes(node.strokes, x, z)
  const threshold = hash3(node.seed + 2, col, row, candidate)
  if (threshold >= (node.density / 100) * strokes.coverage) return null
  const broad = valueNoise3(node.seed + 3, x / 3.7, 0, z / 3.7)
  const local = valueNoise3(node.seed + 4, x / 0.43, 0, z / 0.43)
  const random = hash3(node.seed + 5, col, row, candidate)
  const rawHeight =
    node.height *
    strokes.height *
    (1 + node.roughness * (broad * 0.3 + local * 0.2 + (random - 0.5) * 0.5))
  const restLean = 0.17 + node.roughness * (0.17 + random * 0.34)
  const bladeWidth = node.bladeWidth * (0.8 + hash3(node.seed + 7, col, row, candidate) * 0.4)
  const tuftRadius = (bladeWidth * TUFT_WIDTH_SCALE) / 2
  const sway = restLean * 1.6 + node.wind * 0.48
  const edgeDistance = coverage.distance(
    x,
    z,
    Math.max(node.edgeFade, tuftRadius / EDGE_FAN_SHARE, rawHeight * 1.38 * sway + tuftRadius),
  )
  if (edgeDistance <= bladeWidth * 0.5) return null
  const rim = node.edgeFade ? Math.max(0, 1 - edgeDistance / node.edgeFade) : 0
  // The uncut margin grows upright. Compress the whole fan first, then bound the
  // remaining tip travel, including both gust components, at the actual clipped edge.
  const width = Math.min(bladeWidth, (edgeDistance * EDGE_FAN_SHARE * 2) / TUFT_WIDTH_SCALE)
  const lean = restLean * (1 - rim * 0.8)
  const height = Math.min(
    rawHeight * (1 + rim * 0.38),
    (edgeDistance - (width * TUFT_WIDTH_SCALE) / 2) / (lean * 1.6 + node.wind * 0.48),
  )
  const swath = lawnSwath(node, x, z, broad)
  const yaw = hash3(node.seed + 6, col, row, candidate) * Math.PI * 2
  const tone =
    (0.94 + swath * 0.17 + broad * 0.16 + local * 0.13 + (random - 0.5) * 0.22) /
    (0.52 + strokes.height * 0.48)
  return {
    root: [x, groundHeight(x, z), z, height],
    traits: [yaw + swath * 0.72 * Math.sin(0.24 - yaw), lean, tone, width],
    bucket: Math.floor(hash3(node.seed + 8, col, row, candidate) * 256),
  }
}

function bladeChunks(plan: LawnPlan): { chunks: Chunk[]; count: number } {
  const bounds = candidateBounds(plan.polygons)
  const chunks = new Map<string, Chunk>()
  let count = 0
  for (let row = bounds.minZ; row < bounds.maxZ; row++)
    for (let col = bounds.minX; col < bounds.maxX; col++) {
      const status = plan.coverage.cell(col, row, col + 1, row + 1)
      if (status === 'outside') continue
      const chunkX = Math.floor(col / 8),
        chunkZ = Math.floor(row / 8)
      const key = `${chunkX},${chunkZ}`
      let chunk = chunks.get(key)
      for (let candidate = 0; candidate < 100; candidate++) {
        const blade = bladeAt(plan, col, row, candidate, status === 'inside')
        if (!blade) continue
        if (!chunk) {
          chunk = {
            key,
            bounds: [chunkX * 8, chunkZ * 8, chunkX * 8 + 8, chunkZ * 8 + 8],
            buckets: Array.from({ length: 256 }, () => []),
          }
          chunks.set(key, chunk)
        }
        chunk.buckets[blade.bucket]?.push(blade)
        count++
      }
    }
  return { chunks: [...chunks.values()], count }
}

function packedBlades(plan: LawnPlan): LawnBuild['blades'] {
  const population = bladeChunks(plan)
  const rootHeight = new Float32Array(population.count * 4),
    traits = new Float32Array(population.count * 4)
  const chunks: LawnChunk[] = []
  let offset = 0
  for (const chunk of population.chunks) {
    const start = offset
    for (const bucket of chunk.buckets)
      for (const blade of bucket) {
        rootHeight.set(blade.root, offset * 4)
        traits.set(blade.traits, offset * 4)
        offset++
      }
    const count = offset - start
    chunks.push({
      key: chunk.key,
      start,
      count,
      midCount: Math.floor(count * 0.2),
      bounds: chunk.bounds,
    })
  }
  return { rootHeight, traits, count: population.count, chunks, tuftWidthScale: TUFT_WIDTH_SCALE }
}

export function buildLawn(node: LawnNode, nodes: Nodes): LawnBuild {
  const plan = planLawn(node, nodes)
  const blades = packedBlades(plan)
  const flowers = lawnFlowers(plan.node, plan.polygons, plan.coverage, plan.groundHeight)
  const facts: LawnFacts = {
    ...plan.facts,
    bladeCount: blades.count,
    flowerCount: flowers.mesh.count,
    budget: {
      ...plan.facts.budget,
      requestedFlowers: flowers.requested,
      flowerThinned: flowers.requested > flowers.mesh.count,
    },
  }
  return {
    polygons: plan.polygons,
    base: lawnGroundMesh(plan.triangles, plan.node),
    blades,
    flowers: flowers.mesh,
    facts,
  }
}

export function lawnFacts(node: LawnNode, nodes: Nodes): LawnFacts {
  return buildLawn(node, nodes).facts
}

/** Blades are packed in square chunks of this many metres (`bladeChunks`). */
export const LAWN_CHUNK_M = 8

/** Everything a lawn's chunks need that brush strokes cannot change. */
export type LawnChunkContext = Pick<LawnPlan, 'polygons' | 'coverage' | 'groundHeight'> & {
  field: ReturnType<typeof persistedTerrainFieldOf>
  axes: LawnGroundAxes
  cells: ReturnType<typeof candidateBounds>
}
export type LawnChunkBuild = {
  key: string
  bounds: LawnChunk['bounds']
  rootHeight: Float32Array
  traits: Float32Array
  count: number
  midCount: number
  base: LawnBuild['base']
}

export function lawnChunkContext(input: LawnNode, nodes: Nodes): LawnChunkContext {
  const node = LawnNode.parse(input)
  const { polygons } = retainedLawn(node, nodes)
  const site = node.parentId ? nodes[node.parentId] : undefined
  const field = site?.type === 'site' ? persistedTerrainFieldOf(site) : null
  return {
    polygons,
    coverage: lawnCoverage(polygons),
    groundHeight: field ? (x: number, z: number) => heightAt(field, x, z) : () => FLAT_GROUND_Y,
    field,
    axes: lawnGroundAxes(polygons, field),
    cells: candidateBounds(polygons),
  }
}

/**
 * The chunks a change of strokes can alter. A stroke reaches a blade, a ground vertex or a ground
 * triangle only within its radius of a segment, so the chunks outside the changed segments' boxes
 * (grown by the radius and by half a ground cell, whose centre names its chunk) keep every byte.
 */
export function lawnChunksTouched(
  context: LawnChunkContext,
  before: LawnNode['strokes'],
  after: LawnNode['strokes'],
): [number, number][] {
  const { xs, zs } = context.axes
  let cell = 1
  for (const axis of [xs, zs])
    for (let index = 0; index + 1 < axis.length; index++)
      cell = Math.max(cell, (axis[index + 1] ?? 0) - (axis[index] ?? 0))
  const touched = new Map<string, [number, number]>()
  const grow = (stroke: LawnNode['strokes'][number], from: number) => {
    for (let index = Math.max(0, from); index < stroke.points.length; index++) {
      const start = stroke.points[index],
        end = stroke.points[index + 1] ?? start
      if (!start || !end) continue
      const reach = stroke.radiusM + cell / 2
      const minX = Math.max(context.cells.minX, Math.min(start[0], end[0]) - reach),
        maxX = Math.min(context.cells.maxX, Math.max(start[0], end[0]) + reach)
      const minZ = Math.max(context.cells.minZ, Math.min(start[1], end[1]) - reach),
        maxZ = Math.min(context.cells.maxZ, Math.max(start[1], end[1]) + reach)
      for (
        let chunkZ = Math.floor(minZ / LAWN_CHUNK_M);
        chunkZ <= Math.floor(maxZ / LAWN_CHUNK_M);
        chunkZ++
      )
        for (
          let chunkX = Math.floor(minX / LAWN_CHUNK_M);
          chunkX <= Math.floor(maxX / LAWN_CHUNK_M);
          chunkX++
        )
          touched.set(`${chunkX},${chunkZ}`, [chunkX, chunkZ])
    }
  }
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    const old = before[index],
      now = after[index]
    if (old === now) continue
    const same =
      old &&
      now &&
      old.radiusM === now.radiusM &&
      old.effect === now.effect &&
      old.strength === now.strength
    // A stroke in progress only grows or moves its tail: the segments before the first point that
    // differs are unchanged. Anything else redraws both strokes whole.
    let first = 0
    if (same)
      while (
        first < old.points.length &&
        first < now.points.length &&
        old.points[first]?.[0] === now.points[first]?.[0] &&
        old.points[first]?.[1] === now.points[first]?.[1]
      )
        first++
    if (same && first === old.points.length && first === now.points.length) continue
    if (old) grow(old, same ? first - 1 : 0)
    if (now) grow(now, same ? first - 1 : 0)
  }
  return [...touched.values()]
}

/** One chunk of a parsed lawn, cell for cell as `buildLawn` builds it (no blades: `count` 0). */
export function buildLawnChunk(
  context: LawnChunkContext,
  node: LawnNode,
  chunkX: number,
  chunkZ: number,
): LawnChunkBuild {
  const plan = { node, coverage: context.coverage, groundHeight: context.groundHeight }
  const bounds: LawnChunk['bounds'] = [
    chunkX * LAWN_CHUNK_M,
    chunkZ * LAWN_CHUNK_M,
    chunkX * LAWN_CHUNK_M + LAWN_CHUNK_M,
    chunkZ * LAWN_CHUNK_M + LAWN_CHUNK_M,
  ]
  const buckets: Blade[][] = Array.from({ length: 256 }, () => [])
  let count = 0
  for (
    let row = Math.max(context.cells.minZ, bounds[1]);
    row < Math.min(context.cells.maxZ, bounds[3]);
    row++
  )
    for (
      let col = Math.max(context.cells.minX, bounds[0]);
      col < Math.min(context.cells.maxX, bounds[2]);
      col++
    ) {
      const status = context.coverage.cell(col, row, col + 1, row + 1)
      if (status === 'outside') continue
      for (let candidate = 0; candidate < 100; candidate++) {
        const blade = bladeAt(plan, col, row, candidate, status === 'inside')
        if (!blade) continue
        buckets[blade.bucket]?.push(blade)
        count++
      }
    }
  const rootHeight = new Float32Array(count * 4),
    traits = new Float32Array(count * 4)
  let offset = 0
  for (const bucket of buckets)
    for (const blade of bucket) {
      rootHeight.set(blade.root, offset * 4)
      traits.set(blade.traits, offset * 4)
      offset++
    }
  return {
    key: `${chunkX},${chunkZ}`,
    bounds,
    rootHeight,
    traits,
    count,
    midCount: Math.floor(count * 0.2),
    base: lawnGroundMesh(
      lawnGroundTrianglesIn(
        context.polygons,
        context.coverage,
        context.axes,
        node,
        context.field,
        bounds,
      ),
      node,
    ),
  }
}

/** The chunk whose cells hold a ground point, by the centre of the point's ground cell. */
export function lawnGroundChunkAt(context: LawnChunkContext, x: number, z: number): string {
  const centre = (axis: number[], value: number) => {
    let low = 0,
      high = axis.length - 2
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((axis[middle] ?? 0) <= value) low = middle
      else high = middle - 1
    }
    return ((axis[low] ?? 0) + (axis[low + 1] ?? 0)) / 2
  }
  return `${Math.floor(centre(context.axes.xs, x) / LAWN_CHUNK_M)},${Math.floor(centre(context.axes.zs, z) / LAWN_CHUNK_M)}`
}

/** The whole flower population for the strokes as they stand: its thinning is not local. */
export function buildLawnChunkFlowers(context: LawnChunkContext, node: LawnNode) {
  return lawnFlowers(node, context.polygons, context.coverage, context.groundHeight).mesh
}
