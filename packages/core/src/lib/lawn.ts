import type { AnyNode } from '../schema'
import { LAWN_LIMITS, LawnNode } from '../schema/nodes/lawn'
import { type LawnCoverage, lawnCoverage } from './lawn-coverage'
import { lawnFlowers } from './lawn-flowers'
import { type LawnGroundTriangle, lawnGroundMesh, lawnGroundTriangles } from './lawn-ground'
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
  const strokeWork =
    topologyWork.visits + (triangles.length * 3 + candidates.count / 50) * strokePoints
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
  plan: LawnPlan,
  col: number,
  row: number,
  candidate: number,
  interior: boolean,
): Blade | null {
  const { node, coverage, groundHeight } = plan
  // Independent points in metre cells avoid the rows of a jittered ten-centimetre lattice.
  const x = col + hash3(node.seed, col, row, candidate),
    z = row + hash3(node.seed + 1, col, row, candidate)
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
  const lean = 0.12 + node.roughness * (0.2 + random * 0.45)
  const width = node.bladeWidth * (0.8 + hash3(node.seed + 7, col, row, candidate) * 0.4)
  const sway = lean * 1.6 + node.wind * 0.48
  const edgeDistance = coverage.distance(
    x,
    z,
    Math.max(node.edgeFade, rawHeight * sway + width / 2),
  )
  if (edgeDistance <= width / 2) return null
  const fade = node.edgeFade ? Math.min(1, edgeDistance / node.edgeFade) : 1
  if (threshold >= (node.density / 100) * strokes.coverage * fade * fade * (3 - 2 * fade))
    return null
  // Bound the complete wind envelope, not only the root, at paths and bed rims.
  const height = Math.min(
    rawHeight * (0.65 + fade * 0.35),
    (edgeDistance - width / 2) / Math.max(0.001, sway),
  )
  const tone = 0.95 + broad * 0.22 + local * 0.065 + (random - 0.5) * 0.06
  return {
    root: [x, groundHeight(x, z), z, height],
    traits: [hash3(node.seed + 6, col, row, candidate) * Math.PI * 2, lean, tone, width],
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
  return { rootHeight, traits, count: population.count, chunks }
}

export function buildLawn(node: LawnNode, nodes: Nodes): LawnBuild {
  const plan = planLawn(node, nodes)
  const blades = packedBlades(plan)
  const flowers = lawnFlowers(plan.node, plan.polygons, plan.groundHeight)
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
