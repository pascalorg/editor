import { z } from 'zod'
import { isAgentRefusal, refuse } from '../agent-tools/refusal'
import {
  carveTerrainPadTool,
  describeTerrainUnderHouseTool,
  gradeAroundHouseTool,
  readSiteTerrainTool,
  readTerrainContoursTool,
  sampleTerrainLineTool,
  shapeSiteTerrainTool,
} from '../agent-tools/terrain'
import { connectedHouseFootprint } from '../lib/house-footprint'
import { intersection, area as sharedArea } from '../lib/polygon-boolean'
import { segmentsIntersect } from '../lib/polygon-relations'
import { classifyEdges, edgeLength, outwardNormal, resolveFrontEdge } from '../lib/setback-envelope'
import { terrainBreakFacts, terrainBreaksOf, validateTerrainBreak } from '../lib/terrain-breaks'
import { diffuseHeights, RAISE_METRES_PER_STROKE } from '../lib/terrain-brush'
import { terrainContours } from '../lib/terrain-contours'
import {
  createTerrainField,
  DEFAULT_TERRAIN_SPACING,
  heightAt,
  normalAt,
  quantize,
  sampleRangeOver,
  slopeAt,
  type TerrainField,
} from '../lib/terrain-field'
import { persistedTerrainFieldOf } from '../lib/terrain-source-persisted'
import { planTerrainTileChanges } from '../lib/terrain-tile-changes'
import { terrainEditField } from '../lib/terrain-tile-write'
import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, SiteNode, ZoneNode } from '../schema'
import { TerrainBreakNode } from '../schema/nodes/terrain-break'
import { getLevelElevations } from '../services/storey'
import useLiveTerrain from '../store/use-live-terrain'
import { distance2D, pointInPolygon, polygonArea, polygonBounds, type Vec2 } from './plan-geometry'
import { addTerrainBreak, validateTerrainBreakPlacement } from './terrain-break'
import {
  bankRunM,
  convexHull,
  type GradeLowLine,
  type GradePad,
  type GradeRetain,
  gradeGround,
} from './terrain-grade'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'
import {
  type SlabSurface,
  slabSurfaces,
  UNGUARDED_DROP_THRESHOLD_M,
} from './unguarded-drop-observations'

const MAX_SAMPLES = 20_000
const MAX_EDIT_SAMPLES = 2_000_000
const MAX_CONTOUR_VISITS = 2_000_000
const readInput = z.strictObject(readSiteTerrainTool.input)
const lineInput = z.strictObject(sampleTerrainLineTool.input)
const contoursInput = z.strictObject(readTerrainContoursTool.input)
const shapeInput = z.strictObject(shapeSiteTerrainTool.input)
const padInput = z.strictObject(carveTerrainPadTool.input)
const underHouseInput = z.strictObject(describeTerrainUnderHouseTool.input)
const gradeInput = z.strictObject(gradeAroundHouseTool.input)

type TerrainPoint = { x: number; z: number; yM: number; slopeDeg: number }
type TerrainEdge = { from: Vec2; to: Vec2; dropM: number; maxSlopeDeg: number }
type TerrainSample = TerrainPoint & { areaM2: number }

export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  return parsed.data
}

/** What a read says where nobody has shaped the ground: it is the datum plane. */
const FLAT_GROUND_NOTE =
  'No relief is shaped on this site: the ground is the flat datum plane at y = 0. Relief is shaped with shape_site_terrain and carve_terrain_pad.'

/** The sampling label of a flat-datum answer: nothing was sampled, the plane is the same everywhere. */
const FLAT_SAMPLING = {
  approximate: true,
  method: 'flat_datum',
  spacingM: 0,
  heightStepM: 0,
} as const

/** No authored ground means datum; an unreadable legacy field must not masquerade as flat. */
export function groundOf(nodes: SceneNodes): { site: SiteNode; field: TerrainField | null } {
  const sites = queryNodes(nodes, { type: 'site' }).filter(
    (node): node is SiteNode => node.type === 'site',
  )
  if (!sites.length) refuse('no_site', 'The scene has no site to read terrain from.')
  if (sites.length > 1)
    refuse('ambiguous_site', 'The scene has more than one site; its terrain is ambiguous.')
  const site = sites[0]
  if (!site) refuse('no_site', 'The scene has no site to read terrain from.')
  const field = persistedTerrainFieldOf(site, nodes)
  if ((!field && site.terrain !== undefined) || (field && !finiteField(field)))
    refuse('no_terrain', 'The persisted terrain field of the site cannot be read.')
  return { site, field }
}

function finiteField(field: TerrainField): boolean {
  const maxX = field.origin[0] + (field.cols - 1) * field.spacing
  const maxZ = field.origin[1] + (field.rows - 1) * field.spacing
  return (
    Number.isFinite(maxX) &&
    Number.isFinite(maxZ) &&
    field.heights.every((height) => Number.isFinite(height * field.step))
  )
}

/** A datum field wide enough to hold the footprint: every height is 0, so any spacing is exact. */
function flatFieldOver(footprint: Vec2[]): TerrainField {
  const bounds = polygonBounds(footprint)
  const spacing = Math.max(DEFAULT_TERRAIN_SPACING, Math.max(bounds.width, bounds.depth) / 100)
  return createTerrainField({
    origin: [bounds.minX - spacing, bounds.minZ - spacing],
    spacing,
    cols: Math.ceil(bounds.width / spacing) + 3,
    rows: Math.ceil(bounds.depth / spacing) + 3,
  })
}

export function pointOf(point: number[]): Vec2 {
  const [x, z] = point
  if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z))
    refuse('invalid_input', 'A terrain point must be two finite coordinates [x,z].')
  return [x, z]
}

export function polygonEdges(polygon: Vec2[]): [Vec2, Vec2][] {
  return polygon.map((from, index) => {
    const to = polygon[(index + 1) % polygon.length]
    if (!to) refuse('footprint_empty', 'The footprint has no next corner.')
    return [from, to]
  })
}

export function footprintOf(points: number[][]): Vec2[] {
  if (points.length < 3)
    refuse('footprint_empty', 'A footprint needs at least three corners enclosing area.')
  if (points.length > 512) refuse('sampling_limit', 'A footprint can have at most 512 corners.')
  const polygon = points.map(pointOf)
  const edges = polygonEdges(polygon)
  for (const [index, [from, to]] of edges.entries()) {
    if (distance2D(from, to) === 0) refuse('invalid_polygon', 'The footprint has a collapsed edge.')
    for (let next = index + 2; next < edges.length; next++) {
      if (index === 0 && next === edges.length - 1) continue
      const edge = edges[next]
      if (edge && segmentsIntersect(from, to, edge[0], edge[1]))
        refuse('invalid_polygon', 'The footprint intersects itself.')
    }
  }
  const area = polygonArea(polygon)
  if (!Number.isFinite(area)) refuse('invalid_polygon', 'The footprint area is not finite.')
  if (area <= 1e-10) refuse('footprint_empty', 'The footprint encloses no measurable area.')
  return polygon
}

function requireBudget(count: number): void {
  if (!Number.isFinite(count) || count > MAX_SAMPLES)
    refuse(
      'sampling_limit',
      `The request exceeds ${MAX_SAMPLES} terrain samples; use a larger cellM or stepM.`,
    )
}

function samplePoint(field: TerrainField, point: Vec2): TerrainPoint {
  const [x, z] = point
  const yM = heightAt(field, x, z)
  const slopeDeg = (slopeAt(field, x, z) * 180) / Math.PI
  if (!Number.isFinite(yM) || !Number.isFinite(slopeDeg))
    refuse('no_terrain', 'The persisted terrain cannot produce finite ground facts.')
  return { x, z, yM, slopeDeg }
}

function segmentSteps(from: Vec2, to: Vec2, stepM: number): number {
  return Math.ceil(distance2D(from, to) / stepM)
}

function segmentPoints(from: Vec2, to: Vec2, steps: number): Vec2[] {
  if (steps === 0) return [from]
  return Array.from({ length: steps + 1 }, (_, index): Vec2 => {
    if (index === 0) return from
    if (index === steps) return to
    const fraction = index / steps
    return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction]
  })
}

function gridFor(polygon: Vec2[], cellM: number) {
  const bounds = polygonBounds(polygon)
  const cols = Math.max(1, Math.ceil(bounds.width / cellM))
  const rows = Math.max(1, Math.ceil(bounds.depth / cellM))
  const edgeCount = polygonEdges(polygon).reduce(
    (sum, [from, to]) => sum + segmentSteps(from, to, cellM) + 1,
    0,
  )
  requireBudget(cols * rows + edgeCount + polygon.length)
  return { ...bounds, cols, rows, widthM: bounds.width / cols, depthM: bounds.depth / rows }
}

function interiorSamples(
  field: TerrainField,
  polygon: Vec2[],
  grid: ReturnType<typeof gridFor>,
): TerrainSample[] {
  const samples: TerrainSample[] = []
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const point: Vec2 = [
        grid.minX + (col + 0.5) * grid.widthM,
        grid.minZ + (row + 0.5) * grid.depthM,
      ]
      if (!pointInPolygon(point, polygon)) continue
      samples.push({ ...samplePoint(field, point), areaM2: grid.widthM * grid.depthM })
    }
  }
  if (!samples.length)
    refuse(
      'sampling_insufficient',
      'No interior midpoint was sampled; ground areas and mean slope are unknown. Use a finer cellM.',
    )
  return samples
}

function edgeSamples(field: TerrainField, polygon: Vec2[], cellM: number) {
  const samples: TerrainPoint[] = []
  const edges: TerrainEdge[] = []
  for (const [from, to] of polygonEdges(polygon)) {
    const points = segmentPoints(from, to, segmentSteps(from, to, cellM)).map((point) =>
      samplePoint(field, point),
    )
    samples.push(...points)
    edges.push({
      from,
      to,
      dropM: heightAt(field, from[0], from[1]) - heightAt(field, to[0], to[1]),
      maxSlopeDeg: Math.max(...points.map((point) => point.slopeDeg)),
    })
  }
  return { samples, edges }
}

export function samplingOf(field: TerrainField, method: string, sampleCount: number) {
  return {
    approximate: true,
    method,
    spacingM: field.spacing,
    heightStepM: field.step,
    sampleCount,
  }
}

function cornerOf(field: TerrainField, point: Vec2) {
  const sampled = samplePoint(field, point)
  const normal = normalAt(field, point[0], point[1])
  if (!normal.every(Number.isFinite))
    refuse('no_terrain', 'The persisted terrain cannot produce a finite ground normal.')
  return { x: sampled.x, z: sampled.z, slopeDeg: sampled.slopeDeg, normal }
}

function summarizeSamples(samples: TerrainPoint[], interior: TerrainSample[]) {
  const minM = Math.min(...samples.map((point) => point.yM))
  const maxM = Math.max(...samples.map((point) => point.yM))
  const areaM2 = interior.reduce((sum, point) => sum + point.areaM2, 0)
  if (!Number.isFinite(maxM - minM) || !Number.isFinite(areaM2) || areaM2 <= 0)
    refuse(
      'sampling_insufficient',
      'Sampled relief or area is not representable; terrain facts are unknown.',
    )
  return {
    hasTerrain: true,
    flat: minM === maxM,
    reliefM: maxM - minM,
    minM,
    maxM,
    datumM: 0,
    slopeMeanDeg: interior.reduce(
      (sum, point) => sum + point.slopeDeg * (point.areaM2 / areaM2),
      0,
    ),
    slopeMaxDeg: Math.max(...samples.map((point) => point.slopeDeg)),
    areaAboveGradeM2: interior.reduce((sum, point) => sum + (point.yM > 0 ? point.areaM2 : 0), 0),
    areaBelowGradeM2: interior.reduce((sum, point) => sum + (point.yM < 0 ? point.areaM2 : 0), 0),
  }
}

/** The facts of ground nobody has shaped: level at the datum over the whole footprint. */
function flatSiteTerrain(footprint: Vec2[], cellM: number | undefined) {
  return {
    hasTerrain: false,
    flat: true,
    reliefM: 0,
    minM: 0,
    maxM: 0,
    datumM: 0,
    slopeMeanDeg: 0,
    slopeMaxDeg: 0,
    slopeAtCorners: footprint.map(([x, z]) => ({ x, z, slopeDeg: 0, normal: [0, 1, 0] })),
    edgeDrops: polygonEdges(footprint).map(([from, to]) => ({
      from,
      to,
      dropM: 0,
      maxSlopeDeg: 0,
    })),
    areaAboveGradeM2: 0,
    areaBelowGradeM2: 0,
    note: FLAT_GROUND_NOTE,
    sampling: { ...FLAT_SAMPLING, sampleCount: 0, cellM: cellM ?? 0 },
  }
}

export const readSiteTerrain: AgentOperation<z.infer<typeof readInput>> = (nodes, raw) => {
  const input = parseInput(readInput, raw)
  const { site, field } = groundOf(nodes)
  const footprint = footprintOf(input.footprint ?? site.polygon.points)
  if (!field) return { result: flatSiteTerrain(footprint, input.cellM) }
  const cellM = input.cellM ?? field.spacing
  const interior = interiorSamples(field, footprint, gridFor(footprint, cellM))
  const boundary = edgeSamples(field, footprint, cellM)
  const samples = [...interior, ...boundary.samples]
  const slopeAtCorners = footprint.map((point) => cornerOf(field, point))
  return {
    result: {
      ...summarizeSamples(samples, interior),
      breaks: terrainBreaksOf(site, nodes).map((terrainBreak) =>
        terrainBreakFacts(terrainBreak, field),
      ),
      slopeAtCorners,
      edgeDrops: boundary.edges,
      sampling: {
        ...samplingOf(field, 'midpoint_grid_and_boundary', samples.length + slopeAtCorners.length),
        cellM,
      },
    },
  }
}

export const sampleTerrainLine: AgentOperation<z.infer<typeof lineInput>> = (nodes, raw) => {
  const input = parseInput(lineInput, raw)
  const { site, field } = groundOf(nodes)
  const from = pointOf(input.from)
  const to = pointOf(input.to)
  const stepM = input.stepM ?? field?.spacing ?? DEFAULT_TERRAIN_SPACING
  const steps = segmentSteps(from, to, stepM)
  requireBudget(steps + 1)
  const points = segmentPoints(from, to, steps).map((point) =>
    field ? samplePoint(field, point) : { x: point[0], z: point[1], yM: 0, slopeDeg: 0 },
  )
  const actualStepM = steps ? distance2D(from, to) / steps : 0
  if (!field)
    return {
      result: {
        points,
        note: FLAT_GROUND_NOTE,
        sampling: { ...FLAT_SAMPLING, sampleCount: points.length, stepM, actualStepM },
      },
    }
  return {
    result: {
      points,
      breaks: terrainBreaksOf(site, nodes).map((terrainBreak) =>
        terrainBreakFacts(terrainBreak, field),
      ),
      sampling: {
        ...samplingOf(field, 'even_segment_samples', points.length),
        stepM,
        actualStepM,
      },
    },
  }
}

function requireContourBudget(field: TerrainField, intervalM: number): void {
  const sampleCount = field.cols * field.rows
  if (!Number.isSafeInteger(sampleCount) || sampleCount > MAX_CONTOUR_VISITS)
    refuse(
      'contour_limit',
      'The contour extent exceeds 2,000,000 samples; request contours on a smaller terrain extent.',
    )
  let minM = Infinity
  let maxM = -Infinity
  for (let row = 0; row < field.rows; row++) {
    for (let col = 0; col < field.cols; col++) {
      const height = heightAt(
        field,
        field.origin[0] + col * field.spacing,
        field.origin[1] + row * field.spacing,
      )
      minM = Math.min(minM, height)
      maxM = Math.max(maxM, height)
    }
  }
  const first = Math.ceil(minM / intervalM)
  const last = Math.floor(maxM / intervalM)
  const levelCount = Math.max(0, last - first + 1)
  // The primitive silently returns [] past 400 intervals; never mistake that for no contours.
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    last - first > 400 ||
    levelCount * (field.cols - 1) * (field.rows - 1) > MAX_CONTOUR_VISITS
  )
    refuse(
      'contour_limit',
      'The contour request exceeds 400 level intervals or 2,000,000 cell-level visits; use a larger intervalM.',
    )
}

export const readTerrainContours: AgentOperation<z.infer<typeof contoursInput>> = (nodes, raw) => {
  const input = parseInput(contoursInput, raw)
  const { site, field } = groundOf(nodes)
  const lot = footprintOf(site.polygon.points)
  const intervalM = input.intervalM ?? 1
  if (!field)
    return {
      result: {
        datum: 0,
        lines: [],
        note: FLAT_GROUND_NOTE,
        sampling: { ...FLAT_SAMPLING, sampleCount: 0, intervalM },
      },
    }
  requireContourBudget(field, intervalM)
  const lines = terrainContours(field, intervalM, lot).map(({ levelM, points }) => ({
    levelM,
    points,
  }))
  const sampleCount = lines.reduce((sum, line) => sum + line.points.length, 0)
  if (sampleCount > MAX_SAMPLES)
    refuse(
      'contour_limit',
      `The contour result exceeds ${MAX_SAMPLES} vertices; use a larger intervalM.`,
    )
  return {
    result: {
      datum: 0,
      lines,
      breaks: terrainBreaksOf(site, nodes).map((terrainBreak) =>
        terrainBreakFacts(terrainBreak, field),
      ),
      sampling: {
        ...samplingOf(
          field,
          field.terrainBreaks?.length
            ? 'marching_squares_break_cells_omitted'
            : 'marching_squares_midpoint_mask',
          sampleCount,
        ),
        intervalM,
      },
    },
  }
}

export type ShapingArea =
  | { kind: 'polygon'; polygon: Vec2[] }
  | { kind: 'circle'; center: Vec2; radiusM: number }

export type FieldSample = { index: number; point: Vec2 }

function pointToSegmentDistance(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const lengthSq = dx * dx + dz * dz
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / lengthSq))
  return distance2D(point, [from[0] + dx * t, from[1] + dz * t])
}

export function distanceToPolygonEdge(point: Vec2, polygon: Vec2[]): number {
  return Math.min(
    ...polygonEdges(polygon).map(([from, to]) => pointToSegmentDistance(point, from, to)),
  )
}

export function areaBounds(area: ShapingArea) {
  if (area.kind === 'polygon') return polygonBounds(area.polygon)
  const [x, z] = area.center
  return {
    minX: x - area.radiusM,
    maxX: x + area.radiusM,
    minZ: z - area.radiusM,
    maxZ: z + area.radiusM,
  }
}

export function insideArea(area: ShapingArea, point: Vec2): boolean {
  return area.kind === 'polygon'
    ? pointInPolygon(point, area.polygon)
    : distance2D(point, area.center) <= area.radiusM
}

/** How far inside the area boundary a point sits; negative outside it. */
export function depthInsideArea(area: ShapingArea, point: Vec2): number {
  if (area.kind === 'circle') return area.radiusM - distance2D(point, area.center)
  const edge = distanceToPolygonEdge(point, area.polygon)
  return pointInPolygon(point, area.polygon, false) ? edge : -edge
}

export function shapingAreaOf(area: z.infer<typeof shapeInput>['area']): ShapingArea {
  if (Array.isArray(area)) return { kind: 'polygon', polygon: footprintOf(area) }
  if (!Number.isFinite(area.radiusM) || area.radiusM <= 0)
    refuse('invalid_input', 'A circle area needs a positive finite radiusM.')
  return { kind: 'circle', center: pointOf([area.x, area.z]), radiusM: area.radiusM }
}

export function propertyOf(site: SiteNode): Vec2[] {
  return footprintOf(site.polygon.points)
}

/** A crossing through both segments' interiors. Touching at a corner or
 * running along the boundary is not a crossing: a pad may share the
 * property line. (`segmentsIntersect` counts touching, which is what a
 * self-intersection check wants and a containment check does not.) */
function edgesCrossProperly(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  return abC * abD < 0 && cdA * cdB < 0
}

/**
 * The whole area must sit on the property: vertices inside is not enough on a
 * non-convex lot, so edges may not cross the boundary and no boundary corner
 * may poke into the area either.
 */
export function requireInsideProperty(area: ShapingArea, property: Vec2[]): void {
  const outside = () =>
    refuse('outside_property', 'The area reaches outside the site polygon; nothing was written.')
  if (area.kind === 'circle') {
    if (!pointInPolygon(area.center, property)) outside()
    if (distanceToPolygonEdge(area.center, property) < area.radiusM - 1e-9) outside()
    return
  }
  if (!area.polygon.every((point) => pointInPolygon(point, property))) outside()
  for (const [from, to] of polygonEdges(area.polygon)) {
    const midpoint: Vec2 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    if (!pointInPolygon(midpoint, property)) outside()
    for (const [edgeFrom, edgeTo] of polygonEdges(property))
      if (edgesCrossProperly(from, to, edgeFrom, edgeTo)) outside()
  }
  if (property.some((point) => pointInPolygon(point, area.polygon, false))) outside()
}

export function fieldSamplesIn(
  field: TerrainField,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): FieldSample[] {
  const range = sampleRangeOver(field, bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ)
  if (!range) return []
  const samples: FieldSample[] = []
  for (let row = range.row0; row <= range.row1; row++)
    for (let col = range.col0; col <= range.col1; col++)
      samples.push({
        index: row * field.cols + col,
        point: [field.origin[0] + col * field.spacing, field.origin[1] + row * field.spacing],
      })
  return samples
}

const metresOf = (field: TerrainField, quantized: number) => quantized * field.step

/** Persist only changed tiles, leaving the legacy ground byte-for-byte intact. */
export function terrainWriteOutcome(
  site: SiteNode,
  nodes: SceneNodes,
  before: TerrainField,
  heights: Int16Array,
  result: Record<string, unknown>,
  extra?: Pick<SceneChanges, 'create' | 'delete'>,
) {
  const tiles = planTerrainTileChanges(site, nodes, before, { ...before, heights })
  if (
    !tiles.create?.length &&
    !tiles.update?.length &&
    !extra?.create?.length &&
    !extra?.delete?.length
  )
    refuse('no_change', 'No terrain sample would move; nothing was written.')
  useLiveTerrain.getState().end(site.id)
  const changes: SceneChanges = {
    ...tiles,
    create: [...(tiles.create ?? []), ...(extra?.create ?? [])],
    ...(extra?.delete?.length ? { delete: extra.delete } : {}),
  }
  return { result, changes }
}

export function editingField(
  site: SiteNode,
  nodes: SceneNodes,
  area: ShapingArea,
  haloM = 0,
): TerrainField {
  const bounds = areaBounds(area)
  const rect = {
    minX: bounds.minX - haloM,
    minZ: bounds.minZ - haloM,
    maxX: bounds.maxX + haloM,
    maxZ: bounds.maxZ + haloM,
  }
  const count =
    (Math.ceil((rect.maxX - rect.minX) / DEFAULT_TERRAIN_SPACING) + 2) *
    (Math.ceil((rect.maxZ - rect.minZ) / DEFAULT_TERRAIN_SPACING) + 2)
  if (!Number.isFinite(count) || count > MAX_EDIT_SAMPLES)
    refuse(
      'sampling_limit',
      `The edit exceeds ${MAX_EDIT_SAMPLES} terrain samples; use a smaller area.`,
    )
  return terrainEditField(site, nodes, rect)
}

function shapedHeight(
  verb: z.infer<typeof shapeInput>['verb'],
  currentM: number,
  weight: number,
  heightM: number,
  smoothedM: number,
): number {
  switch (verb) {
    case 'flatten':
      return currentM + (heightM - currentM) * weight
    case 'raise':
      return currentM + heightM * weight
    case 'lower':
      return currentM - heightM * weight
    case 'smooth':
      return currentM + (smoothedM - currentM) * weight
  }
}

/**
 * The height a shaping verb works with, validated: flatten's target height
 * (required), or the metres raise/lower move — direction comes from the verb,
 * so a negative distance is meaningless. Defaults to the sculpt stroke's metre.
 */
function shapeHeightMOf(input: z.infer<typeof shapeInput>): number {
  if (input.verb === 'flatten' && input.heightM === undefined)
    refuse('invalid_input', 'flatten needs heightM, the height to flatten to.')
  if (
    (input.verb === 'raise' || input.verb === 'lower') &&
    input.heightM !== undefined &&
    input.heightM < 0
  )
    refuse(
      'invalid_input',
      'heightM for raise/lower is the metres to move, 0 or more; the verb gives the direction.',
    )
  return input.heightM ?? RAISE_METRES_PER_STROKE
}

/** The shaped field plus the height range it moved, over the touched samples. */
function applyShaping(
  field: TerrainField,
  area: ShapingArea,
  samples: FieldSample[],
  input: z.infer<typeof shapeInput>,
  heightM: number,
) {
  const strength = input.strength ?? 1
  const softness = input.softness ?? 0
  const smoothed = input.verb === 'smooth' ? diffuseHeights(field) : null
  const heights = new Int16Array(field.heights)
  let beforeMin = Infinity
  let beforeMax = -Infinity
  let afterMin = Infinity
  let afterMax = -Infinity
  let changedSamples = 0
  for (const sample of samples) {
    const beforeQ = field.heights[sample.index] ?? 0
    const edgeWeight =
      softness > 0 ? Math.max(0, Math.min(1, depthInsideArea(area, sample.point) / softness)) : 1
    const nextM = shapedHeight(
      input.verb,
      metresOf(field, beforeQ),
      strength * edgeWeight,
      heightM,
      metresOf(field, smoothed?.[sample.index] ?? beforeQ),
    )
    const nextQ = quantize(field, nextM)
    heights[sample.index] = nextQ
    if (nextQ !== beforeQ) changedSamples++
    beforeMin = Math.min(beforeMin, metresOf(field, beforeQ))
    beforeMax = Math.max(beforeMax, metresOf(field, beforeQ))
    afterMin = Math.min(afterMin, metresOf(field, nextQ))
    afterMax = Math.max(afterMax, metresOf(field, nextQ))
  }
  return {
    heights,
    changedSamples,
    beforeMinMaxM: { minM: beforeMin, maxM: beforeMax },
    afterMinMaxM: { minM: afterMin, maxM: afterMax },
  }
}

export const shapeSiteTerrain: AgentOperation<z.infer<typeof shapeInput>> = (nodes, raw) => {
  const input = parseInput(shapeInput, raw)
  const { site } = groundOf(nodes)
  const property = propertyOf(site)
  const area = shapingAreaOf(input.area)
  if (input.scope !== 'context') requireInsideProperty(area, property)
  const field = editingField(site, nodes, area, input.verb === 'smooth' ? 4 : 0.5)
  const heightM = shapeHeightMOf(input)
  const samples = fieldSamplesIn(field, areaBounds(area)).filter(
    (sample) =>
      insideArea(area, sample.point) &&
      (input.scope === 'context' || pointInPolygon(sample.point, property)),
  )
  if (!samples.length)
    refuse(
      'no_change',
      'The area holds no terrain sample inside the property; nothing was written.',
    )
  const shaped = applyShaping(field, area, samples, input, heightM)
  return terrainWriteOutcome(site, nodes, field, shaped.heights, {
    changedSamples: shaped.changedSamples,
    beforeMinMaxM: shaped.beforeMinMaxM,
    afterMinMaxM: shaped.afterMinMaxM,
    touchedM2: samples.length * field.spacing * field.spacing,
    sampling: samplingOf(field, 'field_samples_in_area', samples.length),
  })
}

function retainingHeights(field: TerrainField, pad: Vec2[], padHeightM: number) {
  return polygonEdges(pad).map(([from, to]) => {
    const points = segmentPoints(from, to, segmentSteps(from, to, field.spacing))
    const highest = Math.max(...points.map((point) => heightAt(field, point[0], point[1])))
    return { from, to, heightM: Math.max(0, highest - padHeightM) }
  })
}

function steepestBlendSlopeDeg(
  after: TerrainField,
  padArea: ShapingArea,
  ring: FieldSample[],
): number {
  const outside = ring.filter((sample) => !insideArea(padArea, sample.point))
  const points = outside.length
    ? outside.map((sample) => sample.point)
    : polygonEdges(padArea.kind === 'polygon' ? padArea.polygon : []).flatMap(([from, to]) =>
        segmentPoints(from, to, segmentSteps(from, to, after.spacing)),
      )
  if (!points.length) return 0
  return points.reduce(
    (max, point) => Math.max(max, (slopeAt(after, point[0], point[1]) * 180) / Math.PI),
    0,
  )
}

/** Samples in the pad plus its blend ring, clipped to the property. */
function padRingSamples(
  field: TerrainField,
  padArea: { kind: 'polygon'; polygon: Vec2[] },
  blendM: number,
  property: Vec2[] | null,
) {
  const bounds = polygonBounds(padArea.polygon)
  const ring = fieldSamplesIn(field, {
    minX: bounds.minX - blendM,
    minZ: bounds.minZ - blendM,
    maxX: bounds.maxX + blendM,
    maxZ: bounds.maxZ + blendM,
  }).filter((sample) => !property || pointInPolygon(sample.point, property))
  const padSamples = ring.filter((sample) => insideArea(padArea, sample.point))
  if (!padSamples.length)
    refuse(
      'pad_too_small',
      'No field sample falls inside the pad; at this spacing the pad cannot be levelled.',
    )
  return { ring, padSamples }
}

/** The carved field plus its earthwork, integrated sample by sample. */
function carvedHeights(
  field: TerrainField,
  padArea: ShapingArea,
  ring: FieldSample[],
  targetQ: number,
  blendM: number,
  property: Vec2[],
) {
  const padHeightM = metresOf(field, targetQ)
  const heights = new Int16Array(field.heights)
  const cellM2 = field.spacing * field.spacing
  let cutVolumeM3 = 0
  let fillVolumeM3 = 0
  let changedSamples = 0
  for (const sample of ring) {
    const beforeQ = field.heights[sample.index] ?? 0
    let nextQ = beforeQ
    if (insideArea(padArea, sample.point)) {
      nextQ = targetQ
    } else if (blendM > 0) {
      const depth = depthInsideArea(padArea, sample.point)
      if (depth > -blendM) {
        const weight = 1 + depth / blendM
        const blendedQ = quantize(
          field,
          metresOf(field, beforeQ) + (padHeightM - metresOf(field, beforeQ)) * weight,
        )
        // The ring only cuts: a sample below pad height would be raised by
        // the lerp, and raising ground outside the pad — filling a dip the
        // pad never asked about — is not this tool's to do.
        nextQ = Math.min(beforeQ, blendedQ)
      }
    }
    heights[sample.index] = nextQ
    const movedM = metresOf(field, nextQ - beforeQ)
    if (movedM !== 0) changedSamples++
    if (pointInPolygon(sample.point, property)) {
      if (movedM < 0) cutVolumeM3 += -movedM * cellM2
      else fillVolumeM3 += movedM * cellM2
    }
  }
  return { heights, cutVolumeM3, fillVolumeM3, changedSamples }
}

function closedCounterclockwise(pad: Vec2[]): Vec2[] {
  const signedArea = pad.reduce((sum, from, index) => {
    const to = pad[(index + 1) % pad.length]
    return to ? sum + from[0] * to[1] - to[0] * from[1] : sum
  }, 0)
  const ordered = signedArea >= 0 ? pad : [...pad].reverse()
  const first = ordered[0]
  return first ? [...ordered, first] : ordered
}

function sharpPadEarthwork(samples: TerrainSample[], property: Vec2[], padHeightM: number) {
  const lotSamples = samples.filter((sample) => pointInPolygon([sample.x, sample.z], property))
  const cutVolumeM3 = lotSamples.reduce(
    (sum, sample) => sum + Math.max(0, sample.yM - padHeightM) * sample.areaM2,
    0,
  )
  const fillVolumeM3 = lotSamples.reduce(
    (sum, sample) => sum + Math.max(0, padHeightM - sample.yM) * sample.areaM2,
    0,
  )
  return {
    cutVolumeM3,
    fillVolumeM3,
    netM3: cutVolumeM3 - fillVolumeM3,
    sampleCount: lotSamples.length,
  }
}

function sharpPadEdgeHeights(field: TerrainField, pad: Vec2[], padHeightM: number) {
  return polygonEdges(pad).map(([from, to]) => ({
    from,
    to,
    heightM: Math.max(
      ...segmentPoints(from, to, segmentSteps(from, to, field.spacing)).map(([x, z]) =>
        Math.abs(heightAt(field, x, z) - padHeightM),
      ),
    ),
  }))
}

type PadEdgeKind = 'cliff' | 'retaining' | 'soil'

function sharpPadOutcome(
  nodes: SceneNodes,
  input: z.infer<typeof padInput>,
  site: SiteNode,
  pad: Vec2[],
  context: Parameters<typeof addTerrainBreak>[2],
  kind: PadEdgeKind,
) {
  if (input.blendM) refuse('invalid_input', 'Sharp pad edges cannot also have a blendM slope.')
  const field = persistedTerrainFieldOf(site, nodes) ?? flatFieldOver(pad)
  const samples = interiorSamples(field, pad, gridFor(pad, DEFAULT_TERRAIN_SPACING))
  const boundary = edgeSamples(field, pad, DEFAULT_TERRAIN_SPACING)
  const highestM = Math.max(
    ...samples.map((sample) => sample.yM),
    ...boundary.samples.map((sample) => sample.yM),
  )
  const padHeightM = input.padHeightM ?? highestM - (input.padFromHighestM ?? 0)
  const { sampleCount, ...earthwork } = sharpPadEarthwork(samples, propertyOf(site), padHeightM)
  const retainingHeightM = sharpPadEdgeHeights(field, pad, padHeightM)
  // The lattice write refuses a pad that moves nothing, to the half centimetre of its height step;
  // the face of a pad that stands on the ground would be a break of no height.
  if (
    kind === 'soil' &&
    earthwork.cutVolumeM3 + earthwork.fillVolumeM3 < 0.005 * polygonArea(pad) &&
    retainingHeightM.every((edge) => edge.heightM <= 0.005)
  )
    refuse('no_change', 'The ground already stands at the pad height; nothing was written.')
  const outcome = addTerrainBreak(
    nodes,
    {
      line: closedCounterclockwise(pad),
      kind,
      left: padHeightM,
      right: 'ground',
      scope: input.scope,
    },
    context,
  )
  useLiveTerrain.getState().end(site.id)
  return {
    ...outcome,
    result: {
      ...earthwork,
      padAreaM2: polygonArea(pad),
      padHeightM,
      maxSlopeIntoPadDeg: retainingHeightM.some((edge) => edge.heightM > 0) ? 90 : 0,
      retainingHeightM,
      changedSamples: 0,
      breaks: [outcome.result],
      sampling: samplingOf(field, 'midpoint_plan_area_integral', sampleCount),
    },
  }
}

/** The write lattice has a sample in the pad: the contract of a pad, whatever its edge. */
function padHoldsLatticeSample(pad: Vec2[]): boolean {
  const bounds = polygonBounds(pad)
  const step = DEFAULT_TERRAIN_SPACING
  for (let ix = Math.ceil(bounds.minX / step); ix <= Math.floor(bounds.maxX / step); ix++)
    for (let iz = Math.ceil(bounds.minZ / step); iz <= Math.floor(bounds.maxZ / step); iz++)
      if (pointInPolygon([ix * step, iz * step], pad)) return true
  return false
}

function padIsConvex(pad: Vec2[]): boolean {
  try {
    validateTerrainBreak({ line: closedCounterclockwise(pad), left: 0, right: 'ground' })
    return true
  } catch {
    return false
  }
}

const LATTICE_EDGE_NOTE =
  'blendM is 0, so the pad edge is a vertical step; this pad could not be written as an exact soil face, so the step is written on the 0.5 m lattice: the ground between the pad height and the original passes through lattice triangles up to one cell wide, not along the pad line. A convex pad that crosses no other terrain break gets an exact soil face.'

/**
 * A zero-run slope is a vertical earth face: a convex pad with blendM 0 is written as an exact
 * closed break at the pad height, ground outside, with a soil face. A pad that cannot be (not
 * convex, or its break would cross another) keeps the lattice write and says so.
 */
function soilPadOutcome(
  nodes: SceneNodes,
  input: z.infer<typeof padInput>,
  site: SiteNode,
  pad: Vec2[],
  context: Parameters<typeof addTerrainBreak>[2],
): { outcome: ReturnType<typeof sharpPadOutcome> } | { reason: string } {
  if (!padIsConvex(pad)) return { reason: 'non_convex_pad' }
  try {
    return { outcome: sharpPadOutcome(nodes, input, site, pad, context, 'soil') }
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    // A refusal the lattice write would meet too is its own: it surfaces from there.
    return { reason: error.code }
  }
}

export const carveTerrainPad: AgentOperation<z.infer<typeof padInput>> = (nodes, raw, context) => {
  const input = parseInput(padInput, raw)
  const { site } = groundOf(nodes)
  const property = propertyOf(site)
  const pad = footprintOf(input.pad)
  const padArea: { kind: 'polygon'; polygon: Vec2[] } = { kind: 'polygon', polygon: pad }
  if (input.scope !== 'context') requireInsideProperty(padArea, property)
  if ((input.padHeightM === undefined) === (input.padFromHighestM === undefined))
    refuse('invalid_input', 'Give exactly one of padHeightM or padFromHighestM.')
  if (input.padFromHighestM !== undefined && input.padFromHighestM < 0)
    refuse('invalid_input', 'padFromHighestM is a depth below the highest ground, 0 or more.')
  if (input.edges === 'cliff' || input.edges === 'retaining')
    return sharpPadOutcome(nodes, input, site, pad, context, input.edges)
  const blendM = input.blendM ?? 0
  let latticeEdge: Record<string, unknown> | undefined
  if (blendM === 0) {
    if (!padHoldsLatticeSample(pad))
      refuse(
        'pad_too_small',
        'No field sample falls inside the pad; at this spacing the pad cannot be levelled.',
      )
    const soil = soilPadOutcome(nodes, input, site, pad, context)
    if ('outcome' in soil) return soil.outcome
    latticeEdge = {
      kind: 'lattice_step',
      exact: false,
      reason: soil.reason,
      resolutionM: DEFAULT_TERRAIN_SPACING,
      note: LATTICE_EDGE_NOTE,
    }
  }
  const field = editingField(site, nodes, padArea, blendM + 0.5)
  const { ring, padSamples } = padRingSamples(
    field,
    padArea,
    blendM,
    input.scope === 'context' ? null : property,
  )
  const highestM = padSamples.reduce(
    (max, sample) => Math.max(max, metresOf(field, field.heights[sample.index] ?? 0)),
    -Infinity,
  )
  const targetQ = quantize(field, input.padHeightM ?? highestM - (input.padFromHighestM ?? 0))
  const padHeightM = metresOf(field, targetQ)
  const carved = carvedHeights(field, padArea, ring, targetQ, blendM, property)
  const after = { ...field, heights: carved.heights }
  return terrainWriteOutcome(site, nodes, field, carved.heights, {
    cutVolumeM3: carved.cutVolumeM3,
    fillVolumeM3: carved.fillVolumeM3,
    netM3: carved.cutVolumeM3 - carved.fillVolumeM3,
    padAreaM2: polygonArea(pad),
    padHeightM,
    maxSlopeIntoPadDeg: steepestBlendSlopeDeg(after, padArea, ring),
    retainingHeightM: retainingHeights(field, pad, padHeightM),
    changedSamples: carved.changedSamples,
    sampling: samplingOf(field, 'quantized_sample_integral', ring.length),
    ...(latticeEdge ? { edge: latticeEdge } : {}),
  })
}

const GRADE_DEFAULTS = { padBelowSlabM: 0.15, marginM: 1, run: 2, reachM: 15 } as const

export type GradeInput = z.infer<typeof gradeInput>
type ResolvedPad = {
  levelId?: string
  slabId?: string
  slabTopM?: number
  outline: Vec2[]
  heightM: number
  marginM: number
}

/** One pad: a level's largest slab, or a given footprint with its height. */
function resolveGradePad(
  nodes: SceneNodes,
  surfaces: () => SlabSurface[],
  want: {
    levelId?: string
    footprint?: number[][]
    padHeightM?: number
    padBelowSlabM?: number
    marginM?: number
  },
  defaults: { padBelowSlabM: number; marginM: number },
): ResolvedPad {
  if (want.levelId !== undefined && want.footprint !== undefined)
    refuse('invalid_input', 'Give a levelId or a footprint, not both.')
  const marginM = want.marginM ?? defaults.marginM
  if (want.footprint !== undefined) {
    if (want.padHeightM === undefined)
      refuse(
        'invalid_input',
        'A given footprint has no slab to take the pad height from; give padHeightM.',
      )
    return { outline: footprintOf(want.footprint), heightM: want.padHeightM, marginM }
  }
  const all = surfaces()
  const levelId = houseLevelId(nodes, all, want.levelId)
  const surface = largestSlabOn(all, levelId)
  const framed = siteFrameFootprint(nodes, surface)
  return {
    levelId,
    slabId: surface.slab.id,
    slabTopM: framed.slabTopM,
    outline: framed.footprint,
    heightM: want.padHeightM ?? framed.slabTopM - (want.padBelowSlabM ?? defaults.padBelowSlabM),
    marginM,
  }
}

/** Two outlines sharing more than this share of the smaller one stand one over the other. */
const STACKED_PADS_SHARE = 0.1

/**
 * Pads are the levels of a split-level house, side by side. Storeys one over the other are not:
 * a sample follows the nearest outline, so the upper storey's pad would win over the whole plan
 * and the ground floor would be buried under a platform at the upper floor's height.
 */
function requirePadsSideBySide(pads: ResolvedPad[]): void {
  for (const [index, pad] of pads.entries())
    for (const other of pads.slice(index + 1)) {
      const shared = sharedArea(intersection(pad.outline, other.outline))
      const smaller = Math.min(polygonArea(pad.outline), polygonArea(other.outline))
      if (shared > STACKED_PADS_SHARE * smaller) {
        const name = (each: ResolvedPad) => each.levelId ?? 'a footprint'
        refuse(
          'invalid_input',
          `The outlines of ${name(pad)} and ${name(other)} stand one over the other (${shared.toFixed(1)} m2 in common): pads are the levels of a split-level house, side by side. Storeys one over the other share one seat, the level of the building that stands on the ground.`,
        )
      }
    }
}

const alongOf = (point: Vec2, normal: Vec2) => point[0] * normal[0] + point[1] * normal[1]

/** The straight edge a band grades along: its normal (from the house toward it) and where it stands. */
function resolveGradeEdge(
  site: SiteNode,
  property: Vec2[],
  outline: Vec2[],
  edge: NonNullable<GradeInput['edge']>,
) {
  if ([edge.facing, edge.direction, edge.line].filter((given) => given !== undefined).length !== 1)
    refuse('invalid_input', 'Give exactly one of facing, direction or line for an edge.')
  let normal: Vec2
  let role: string | undefined
  let lineOffsetM: number | undefined
  if (edge.facing !== undefined) {
    const roles = classifyEdges(
      property,
      resolveFrontEdge(property, site.frontEdge, site.northRotation),
      site.streetEdges,
    )
    const longest = roles
      .map((edgeRole, index) => ({ edgeRole, index }))
      .filter(({ edgeRole }) => edgeRole === edge.facing)
      .sort((a, b) => edgeLength(property, b.index) - edgeLength(property, a.index))[0]
    if (!longest) refuse('invalid_input', `The lot has no ${edge.facing} edge.`)
    const [x, z] = outwardNormal(property, longest.index)
    normal = [x, z]
    role = edge.facing
  } else if (edge.direction !== undefined) {
    const [dx, dz] = edge.direction as [number, number]
    const length = Math.hypot(dx, dz)
    if (length < 1e-9)
      refuse('invalid_input', 'The edge direction needs two coordinates that are not both zero.')
    normal = [dx / length, dz / length]
  } else {
    const [from, to] = edge.line as [number[], number[]]
    const dx = (to[0] as number) - (from[0] as number)
    const dz = (to[1] as number) - (from[1] as number)
    const length = Math.hypot(dx, dz)
    if (length < 1e-9) refuse('invalid_input', 'The edge line needs two different points.')
    const perpendicular: Vec2 = [-dz / length, dx / length]
    const centroid: Vec2 = [
      outline.reduce((sum, p) => sum + p[0], 0) / outline.length,
      outline.reduce((sum, p) => sum + p[1], 0) / outline.length,
    ]
    const offset = alongOf([from[0] as number, from[1] as number], perpendicular)
    normal =
      alongOf(centroid, perpendicular) > offset
        ? [-perpendicular[0], -perpendicular[1]]
        : perpendicular
    lineOffsetM = alongOf([from[0] as number, from[1] as number], normal)
  }
  const frontM = Math.min(...outline.map((point) => alongOf(point, normal)))
  const supportM = Math.max(...outline.map((point) => alongOf(point, normal)))
  if (lineOffsetM !== undefined && lineOffsetM < supportM - 1e-6)
    refuse(
      'invalid_input',
      'The edge line cuts across the house; it must lie on or beyond the outline.',
    )
  return { normal, frontM, edgeM: lineOffsetM ?? supportM, role }
}

const GRADE_WALL_SOURCE = 'grade_around_house'

/** The ring of a convex outline offset by `marginM`: straight beside each edge, an arc at each corner. */
function offsetRing(hull: Vec2[], marginM: number): Vec2[] {
  if (marginM <= 0) return hull
  const count = hull.length
  const normalOf = (index: number): Vec2 => {
    const from = hull[index] as Vec2
    const to = hull[(index + 1) % count] as Vec2
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    return [(to[1] - from[1]) / length, -(to[0] - from[0]) / length]
  }
  const ring: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const before = normalOf((i + count - 1) % count)
    const after = normalOf(i)
    const start = Math.atan2(before[1], before[0])
    let end = Math.atan2(after[1], after[0])
    while (end < start) end += 2 * Math.PI
    const steps = Math.max(1, Math.ceil((end - start) / (Math.PI / 12)))
    const corner = hull[i] as Vec2
    for (let k = 0; k <= steps; k++) {
      const angle = start + ((end - start) * k) / steps
      ring.push([corner[0] + marginM * Math.cos(angle), corner[1] + marginM * Math.sin(angle)])
    }
  }
  return ring
}

/** The faces a grading of this outline left on the site: the breaks it tagged with the outline. */
export function gradeWallsOf(nodes: SceneNodes, site: SiteNode, footprint: Vec2[]): string[] {
  const source = `${GRADE_WALL_SOURCE}:${gradeWallKey({ outline: footprint, heightM: 0, marginM: 0 })}`
  return queryNodes(nodes, { type: 'terrain-break', parentId: site.id })
    .filter((node) => node.metadata?.source === source)
    .map((node) => node.id)
}

function gradeWallKey(pad: ResolvedPad): string {
  return (
    pad.levelId ??
    `footprint:${pad.outline.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(';')}`
  )
}

/** The part of a convex or concave polygon on one side of a line `along(point) = offset` (Sutherland–Hodgman). */
function clipPolygonAlong(
  polygon: Vec2[],
  normal: Vec2,
  offset: number,
  keep: 'below' | 'above',
): Vec2[] {
  const sign = keep === 'below' ? 1 : -1
  const depth = (point: Vec2) => sign * (alongOf(point, normal) - offset)
  const out: Vec2[] = []
  polygon.forEach((point, i) => {
    const next = polygon[(i + 1) % polygon.length] as Vec2
    const here = depth(point)
    const there = depth(next)
    if (here <= 0) out.push(point)
    if ((here < 0 && there > 0) || (here > 0 && there < 0)) {
      const t = here / (here - there)
      out.push([point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t])
    }
  })
  return out
}

/** A ring's corners with repeats and the closing repeat dropped, counter-clockwise in the site frame. */
function counterClockwise(ring: Vec2[]): Vec2[] {
  const corners = ring.filter((point, i) => {
    const previous = ring[(i + ring.length - 1) % ring.length] as Vec2
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-9
  })
  const area = corners.reduce((sum, a, i) => {
    const b = corners[(i + 1) % corners.length] as Vec2
    return sum + a[0] * b[1] - b[0] * a[1]
  }, 0)
  return area < 0 ? corners.reverse() : corners
}

/**
 * The wall as a terrain-break. The pad is the numeric side (its whole region is the one plane), the
 * batter side is the ground the tiles describe: the face stands between them where the two heights differ.
 * Around a house the break is a ring (the convex hull, offset). Along a band it is a closed ring around
 * the pad strip, the strip clipped to `clip` (the property, or the written region), so the pad is level
 * across the lot between the strip's front and its edge and nowhere else.
 */
function gradeWallBreak(
  site: SiteNode,
  clip: Vec2[],
  pad: GradePad,
  key: string,
  band: { normal: Vec2; frontM: number; edgeM: number } | undefined,
): TerrainBreakNode {
  const metadata = { source: `${GRADE_WALL_SOURCE}:${key}` }
  let ring: Vec2[]
  if (!band) {
    if (pad.outline.length < 3)
      refuse(
        'unsupported_geometry',
        'The outline is a line or a point; a wall has no ring to stand on.',
      )
    ring = offsetRing(pad.outline, pad.marginM)
  } else {
    const rear = clipPolygonAlong(clip, band.normal, band.edgeM + pad.marginM, 'below')
    const strip = counterClockwise(
      clipPolygonAlong(rear, band.normal, band.frontM - pad.marginM, 'above'),
    )
    if (strip.length < 3) refuse('invalid_input', 'The pad strip does not cross the property.')
    const convex = strip.every((a, i) => {
      const b = strip[(i + 1) % strip.length] as Vec2
      return strip.every(
        (point) => (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) >= -1e-9,
      )
    })
    if (!convex)
      refuse(
        'unsupported_geometry',
        'The pad strip is not convex across this lot, so its wall cannot be one terrain-break ring; grade without exactWall.',
      )
    ring = strip
  }
  return TerrainBreakNode.parse({
    parentId: site.id,
    line: [...ring, ring[0]],
    kind: 'retaining',
    left: pad.heightM,
    right: 'ground',
    metadata,
  })
}

function lineLengthM(line: number[][]): number {
  return line
    .slice(1)
    .reduce(
      (sum, to, i) =>
        sum +
        Math.hypot(
          (to[0] as number) - (line[i]?.[0] as number),
          (to[1] as number) - (line[i]?.[1] as number),
        ),
      0,
    )
}

/**
 * Grade the ground around a house: a pad at the house's height, a batter to the ground that was there or to
 * a lawn, both as functions of the distance to the outline (terrain-grade.ts); one pad per level, a straight
 * band across the lot instead of the ring, and a wall as a real terrain-break. The footprint is read the way
 * describe_terrain_under_house reads it; the write is the tile write every terrain tool shares.
 */
export const gradeAroundHouse: AgentOperation<GradeInput> = (nodes, raw) =>
  gradeHouse(nodes, parseInput(gradeInput, raw))

/** What a caller that seats a house adds to the grading the tool's own input describes. */
export type GradeExtras = {
  /** The pad falls away from the walls by this many metres per metre (terrain-grade `padFallPerM`). */
  padFallPerM?: number
  /** The pad and its batter only cut (terrain-grade `cutOnly`). */
  cutOnly?: boolean
  /** Further pads graded with the house's, each on its own outline (an apron before a wall). */
  morePads?: GradePad[]
  /** A low line round the pad's high side (terrain-grade `lowLine`). */
  lowLine?: GradeLowLine
  /** The high side is held by a face, not battered back (terrain-grade `retain`): the face is a terrain break on the outline's hull. */
  retain?: GradeRetain
  /** Faces an earlier seating of this outline left are taken away, whether or not this one makes a face. */
  replaceWalls?: boolean
}

/** grade_around_house's grading, for the tool and for an operation that seats a house first. */
export function gradeHouse(nodes: SceneNodes, input: GradeInput, extras: GradeExtras = {}) {
  const { site } = groundOf(nodes)
  const property = propertyOf(site)
  const scope = input.scope ?? 'lot'
  if (input.pads !== undefined) {
    if (
      input.levelId !== undefined ||
      input.footprint !== undefined ||
      input.padHeightM !== undefined
    )
      refuse(
        'invalid_input',
        'pads gives each pad its own level, footprint and height; leave the top-level levelId, footprint and padHeightM out.',
      )
    if (input.pads.some((pad) => pad.levelId === undefined && pad.footprint === undefined))
      refuse('invalid_input', 'Each pad needs a levelId or a footprint.')
    const levels = input.pads.flatMap((pad) => (pad.levelId === undefined ? [] : [pad.levelId]))
    if (new Set(levels).size !== levels.length)
      refuse('invalid_input', 'Two pads name the same level.')
  }
  if (input.exactWall && !input.wallM) refuse('invalid_input', 'An exact wall needs wallM above 0.')
  const wanted = input.pads ?? [
    { levelId: input.levelId, footprint: input.footprint, padHeightM: input.padHeightM },
  ]
  if (wanted.length > 1 && (input.edge !== undefined || input.exactWall))
    refuse('invalid_input', 'edge and exactWall take one pad; pads has several.')
  const defaults = {
    padBelowSlabM: input.padBelowSlabM ?? GRADE_DEFAULTS.padBelowSlabM,
    marginM: input.marginM ?? GRADE_DEFAULTS.marginM,
  }
  let surfaces: SlabSurface[] | undefined
  const surfacesOf = () => {
    surfaces ??= slabSurfaces(nodes as Record<string, AnyNode>)
    return surfaces
  }
  const pads = wanted.map((want) => resolveGradePad(nodes, surfacesOf, want, defaults))
  requirePadsSideBySide(pads)
  if (scope !== 'context')
    for (const pad of pads)
      requireInsideProperty({ kind: 'polygon', polygon: pad.outline }, property)
  const run = input.run ?? GRADE_DEFAULTS.run
  const reachM = input.reachM ?? GRADE_DEFAULTS.reachM
  const band = input.edge
    ? resolveGradeEdge(site, property, (pads[0] as ResolvedPad).outline, input.edge)
    : undefined
  const lawn = input.upperLevelM !== undefined
  const lotWide = band !== undefined || (lawn && scope !== 'context')
  const maxMarginM = Math.max(
    ...pads.map((pad) => pad.marginM),
    ...(extras.morePads ?? []).map((pad) => pad.marginM),
  )
  const outlinePoints = [
    ...pads.flatMap((pad) => pad.outline),
    ...(extras.morePads ?? []).flatMap((pad) => pad.outline),
  ]
  const lotBounds = polygonBounds(property)
  const reachPad = scope === 'context' ? reachM + maxMarginM : 0
  const bounds = lotWide
    ? {
        minX: lotBounds.minX - reachPad,
        minZ: lotBounds.minZ - reachPad,
        maxX: lotBounds.maxX + reachPad,
        maxZ: lotBounds.maxZ + reachPad,
      }
    : polygonBounds(outlinePoints)
  const field = editingField(
    site,
    nodes,
    {
      kind: 'polygon',
      polygon: [
        [bounds.minX, bounds.minZ],
        [bounds.maxX, bounds.minZ],
        [bounds.maxX, bounds.maxZ],
        [bounds.minX, bounds.maxZ],
      ],
    },
    lotWide ? 0.5 : maxMarginM + reachM + 0.5,
  )
  const metresOf = (heightM: number) => quantize(field, heightM) * field.step
  let gradePads: GradePad[] = [
    ...pads.map((pad) => ({
      outline: pad.outline,
      heightM: metresOf(pad.heightM),
      marginM: pad.marginM,
      ...(extras.cutOnly ? { cutOnly: true } : {}),
    })),
    ...(extras.morePads ?? []).map((pad) => ({ ...pad, heightM: metresOf(pad.heightM) })),
  ]
  const upperLevelM = lawn ? metresOf(input.upperLevelM as number) : undefined
  let wall: TerrainBreakNode | undefined
  let replaced: string[] = []
  if (input.exactWall || extras.retain || extras.replaceWalls) {
    const key = gradeWallKey(pads[0] as ResolvedPad)
    replaced = queryNodes(nodes, { type: 'terrain-break', parentId: site.id })
      .filter(
        (node) =>
          node.type === 'terrain-break' &&
          node.parentId === site.id &&
          node.metadata?.source === `${GRADE_WALL_SOURCE}:${key}`,
      )
      .map((node) => node.id)
  }
  if (extras.retain) {
    // The face stands on the hull of the outline, `atM` beyond it: a break is a convex ring.
    const [pad, ...more] = gradePads as [GradePad, ...GradePad[]]
    const hull = convexHull(pad.outline)
    gradePads = [{ ...pad, outline: hull }, ...more]
    wall = gradeWallBreak(
      site,
      property,
      { ...pad, outline: hull, marginM: extras.retain.atM },
      gradeWallKey(pads[0] as ResolvedPad),
      undefined,
    )
    validateTerrainBreakPlacement(
      // biome-ignore lint/plugin: This pass needs the original scene record keys, including malformed records.
      Object.fromEntries(Object.entries(nodes).filter(([id]) => !replaced.includes(id))),
      site,
      wall,
      scope,
    )
  } else if (input.exactWall) {
    const pad = gradePads[0] as GradePad
    const key = gradeWallKey(pads[0] as ResolvedPad)
    if (!band) gradePads = [{ ...pad, outline: convexHull(pad.outline) }]
    const region: Vec2[] = [
      [bounds.minX, bounds.minZ],
      [bounds.maxX, bounds.minZ],
      [bounds.maxX, bounds.maxZ],
      [bounds.minX, bounds.maxZ],
    ]
    wall = gradeWallBreak(
      site,
      scope === 'context' ? region : property,
      gradePads[0] as GradePad,
      key,
      band,
    )
    validateTerrainBreakPlacement(
      // biome-ignore lint/plugin: This pass needs the original scene record keys, including malformed records.
      Object.fromEntries(Object.entries(nodes).filter(([id]) => !replaced.includes(id))),
      site,
      wall,
      scope,
    )
  }
  const outcome = gradeGround(
    field,
    {
      pads: gradePads,
      band,
      run,
      reachM,
      riserM: input.terraceRiserM,
      wallM: input.wallM,
      upperLevelM,
      lawnToEdge: lawn && scope !== 'context',
      exactWall: wall !== undefined,
      region: lotWide ? bounds : undefined,
      padFallPerM: extras.padFallPerM,
      retain: extras.retain,
      lowLine: extras.lowLine,
    },
    scope === 'context' ? () => true : (point) => pointInPolygon(point, property),
  )
  const cellM2 = field.spacing * field.spacing
  const treadM = input.terraceRiserM ? run * input.terraceRiserM : undefined
  const bankRun = lawn
    ? Math.max(
        ...gradePads.map((pad) =>
          bankRunM(
            Math.abs((upperLevelM as number) - pad.heightM) - (input.wallM ?? 0),
            run,
            input.terraceRiserM,
          ),
        ),
      )
    : 0
  const padFacts = pads.map((pad, index) => ({
    ...(pad.levelId !== undefined
      ? { levelId: pad.levelId, slabId: pad.slabId, slabTopM: pad.slabTopM }
      : {}),
    footprint: pad.outline,
    padHeightM: (gradePads[index] as GradePad).heightM,
    marginM: pad.marginM,
    padAreaM2: outcome.padAreasM2[index] ?? 0,
  }))
  const single = input.pads === undefined ? padFacts[0] : undefined
  return terrainWriteOutcome(
    site,
    nodes,
    field,
    outcome.heights,
    {
      ...(single ?? { pads: padFacts }),
      run,
      reachM,
      batterSlopeDeg: (Math.atan(1 / run) * 180) / Math.PI,
      padAreaM2: outcome.padAreaM2,
      cutVolumeM3: outcome.cutVolumeM3,
      fillVolumeM3: outcome.fillVolumeM3,
      netM3: outcome.cutVolumeM3 - outcome.fillVolumeM3,
      changedSamples: outcome.changedSamples,
      steepestSampledSlopeDeg: outcome.steepestSlopeDeg,
      daylight: {
        reached: lawn
          ? bankRun <= reachM || scope !== 'context'
          : outcome.farthestChangeM <= reachM - field.spacing,
        farthestChangeM: outcome.farthestChangeM,
        outsideLotM2: outcome.outsideLotSamples * cellM2,
        ...(extras.morePads || extras.cutOnly || extras.padFallPerM !== undefined
          ? { outsideLotMaxM: outcome.outsideLotMaxM }
          : {}),
      },
      ...(upperLevelM !== undefined
        ? { lawn: { levelM: upperLevelM, bankRunM: bankRun, areaM2: outcome.lawnAreaM2 } }
        : {}),
      ...(band
        ? {
            edge: {
              ...(band.role ? { role: band.role } : {}),
              normal: band.normal,
              frontM: band.frontM,
              edgeM: band.edgeM,
              padStripM: {
                fromM: band.frontM - (gradePads[0] as GradePad).marginM,
                toM: band.edgeM + (gradePads[0] as GradePad).marginM,
              },
            },
          }
        : {}),
      ...(input.terraceRiserM && treadM !== undefined
        ? { terraces: { riserM: input.terraceRiserM, treadM, resolutionM: field.spacing } }
        : {}),
      ...(input.wallM
        ? {
            wall: wall
              ? {
                  heightM: input.wallM,
                  exact: true,
                  kind: 'retaining',
                  breakId: wall.id,
                  lengthM: lineLengthM(wall.line),
                }
              : {
                  heightM: input.wallM,
                  exact: false,
                  resolutionM: field.spacing,
                  note: 'A vertical step at the pad edge on the side the ground leaves the pad, written on the 0.5 m lattice: a steep earth face of one cell, not a wall object. exactWall true writes a terrain-break.',
                },
          }
        : {}),
      ...(outcome.lowLine ? { lowLine: outcome.lowLine } : {}),
      ...(extras.retain && wall
        ? { face: { breakId: wall.id, lengthM: lineLengthM(wall.line), outline: wall.line } }
        : {}),
      sampling: samplingOf(field, 'quantized_sample_integral', outcome.changedSamples),
    },
    wall || replaced.length
      ? { ...(wall ? { create: [{ node: wall, parentId: site.id }] } : {}), delete: replaced }
      : undefined,
  )
}

/** A Boolean ring may repeat its first corner at the end; drop the repeat. */
function openRing(ring: Vec2[]): Vec2[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first && last && ring.length > 1 && first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring
}

/** The footprint's slab area: every solid piece, holes subtracted. */
function slabAreaM2(surface: SlabSurface): number {
  return surface.solid.reduce(
    (total, polygon) =>
      total +
      Math.abs(polygonArea(openRing(polygon.outer))) -
      polygon.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(openRing(hole))), 0),
    0,
  )
}

function houseLevelId(
  nodes: SceneNodes,
  surfaces: SlabSurface[],
  requested: string | undefined,
): string | undefined {
  if (requested !== undefined) {
    const node = nodes[requested]
    if (!node) refuse('level_not_found', `No node ${requested} in the scene.`)
    if (node.type !== 'level') refuse('not_a_level', `Node ${requested} is not a level.`)
    return requested
  }
  const elevations = getLevelElevations(nodes as Record<string, AnyNode>)
  return surfaces
    .map((surface) => surface.levelId)
    .sort(
      (a, b) =>
        (elevations.get(a)?.baseY ?? Infinity) - (elevations.get(b)?.baseY ?? Infinity) ||
        a.localeCompare(b),
    )[0]
}

/**
 * The level's largest slab, ranked by the slab's total area — ranking the
 * solid pieces instead would let a smaller intact slab outrank a larger slab
 * a through-cut happened to split, and the answer would silently describe
 * the wrong house. A largest slab in several pieces has no single footprint
 * outline to report, so it is refused rather than truncated to one piece.
 */
function largestSlabOn(surfaces: SlabSurface[], levelId: string | undefined): SlabSurface {
  const onLevel = surfaces
    .filter((surface) => surface.levelId === levelId)
    .sort((a, b) => slabAreaM2(b) - slabAreaM2(a))
  const chosen = onLevel[0]
  if (!chosen || levelId === undefined)
    refuse('footprint_empty', 'No slab footprint on the level to measure the ground under.')
  if (chosen.solid.length > 1)
    refuse(
      'disconnected_footprint',
      `Slab ${chosen.slab.id} is the largest on the level but lies in ${chosen.solid.length} disconnected pieces; there is no single footprint to measure under.`,
    )
  return chosen
}

/** The slab outline in site coordinates, through its building's Y-rotation and offset. */
function siteFrameFootprint(
  nodes: SceneNodes,
  surface: SlabSurface,
): { footprint: Vec2[]; slabTopM: number } {
  const building = surface.buildingId ? nodes[surface.buildingId] : undefined
  if (building?.type !== 'building')
    refuse('no_building', 'The slab level belongs to no building; its frame is unknown.')
  if (building.rotation[0] || building.rotation[2])
    refuse(
      'building_rotation_unsupported',
      'The building tips out of the site plane; its footprint has no site-frame outline.',
    )
  const ring = surface.solid[0]
  if (!ring)
    refuse('footprint_empty', 'No slab footprint on the level to measure the ground under.')
  const angle = building.rotation[1]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const footprint = footprintOf(
    openRing(ring.outer).map(([x, z]): [number, number] => [
      cos * x + sin * z + building.position[0],
      -sin * x + cos * z + building.position[2],
    ]),
  )
  return { footprint, slabTopM: building.position[1] + surface.top }
}

export function houseOutline(nodes: SceneNodes, levelId?: string) {
  const surfaces = slabSurfaces(nodes as Record<string, AnyNode>)
  const resolved = houseLevelId(nodes, surfaces, levelId)
  const surface = largestSlabOn(surfaces, resolved)
  const rooms = queryNodes<ZoneNode>(nodes, { type: 'zone', parentId: resolved })
  const { footprint, floorlessRooms } = connectedHouseFootprint(
    surface.solid[0]!,
    rooms,
    surfaces.flatMap((sibling) =>
      sibling !== surface && sibling.levelId === resolved && sibling.slab.plateRole === 'base'
        ? sibling.solid
        : [],
    ),
  )
  if (footprint.length !== 1)
    refuse('disconnected_footprint', 'The house has no single connected footprint to grade.')
  return {
    levelId: resolved as string,
    slabId: surface.slab.id,
    buildingId: surface.buildingId as string,
    ...siteFrameFootprint(
      nodes,
      floorlessRooms.length ? { ...surface, solid: footprint } : surface,
    ),
  }
}

/** Per footprint edge, the largest fall from slab top to terrain along it. */
function edgeDropsOf(field: TerrainField, footprint: Vec2[], slabTopM: number, cellM: number) {
  const edgeHeights: number[] = []
  const dropAtEdges = polygonEdges(footprint).map(([from, to]) => {
    const points = segmentPoints(from, to, segmentSteps(from, to, cellM))
    const heightsM = points.map((point) => heightAt(field, point[0], point[1]))
    edgeHeights.push(...heightsM)
    return { from, to, dropM: slabTopM - Math.min(...heightsM) }
  })
  return { dropAtEdges, edgeHeights }
}

export const describeTerrainUnderHouse: AgentOperation<z.infer<typeof underHouseInput>> = (
  nodes,
  raw,
) => {
  const input = parseInput(underHouseInput, raw)
  const { site, field: persisted } = groundOf(nodes)
  const surfaces = slabSurfaces(nodes as Record<string, AnyNode>)
  const levelId = houseLevelId(nodes, surfaces, input.levelId)
  const surface = largestSlabOn(surfaces, levelId)
  const { footprint, slabTopM } = siteFrameFootprint(nodes, surface)
  const field = persisted ?? flatFieldOver(footprint)
  const cellM = field.spacing
  const interior = interiorSamples(field, footprint, gridFor(footprint, cellM))
  const { dropAtEdges, edgeHeights } = edgeDropsOf(field, footprint, slabTopM, cellM)
  const sampled = [...interior.map((sample) => sample.yM), ...edgeHeights]
  const highestM = Math.max(...sampled)
  const lowestM = Math.min(...sampled)
  return {
    result: {
      levelId,
      slabId: surface.slab.id,
      footprint,
      slabTopM,
      highestM,
      lowestM,
      reliefM: highestM - lowestM,
      breaks: terrainBreaksOf(site, nodes).map((terrainBreak) =>
        terrainBreakFacts(terrainBreak, field),
      ),
      clearanceUnderSlabM: slabTopM - highestM,
      dropAtEdges,
      needsGuardAt: dropAtEdges.filter((edge) => edge.dropM > UNGUARDED_DROP_THRESHOLD_M),
      ...(persisted ? {} : { note: FLAT_GROUND_NOTE }),
      guardAdvisory: {
        advisory: true,
        thresholdM: UNGUARDED_DROP_THRESHOLD_M,
        basis:
          'The same 0.5 m drop threshold verify_scene uses for its unguarded_drop observation. Only the threshold is shared: these edges compare slab top against terrain alone, while verify_scene also accounts for landings, neighbouring surfaces and existing guards, so the two need not flag the same edges.',
        typicalRequirement:
          'A guard is typically required above about 0.76 m (IRC R312); an edge flagged here between the threshold and that height may not need one. Advisory only: nothing is built from this fact.',
      },
      sampling: {
        ...samplingOf(field, 'midpoint_grid_and_boundary', interior.length + edgeHeights.length),
        cellM,
      },
    },
  }
}
