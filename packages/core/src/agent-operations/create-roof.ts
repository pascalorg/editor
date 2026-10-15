import { refuse } from '../agent-tools/refusal'
import { gapBridges } from '../building/wall-gaps'
import { exteriorWallLoops, exteriorWallOutlines } from '../lib/exterior-wall-loops'
import {
  type AnyNode,
  type AnyNodeId,
  getActiveRoofHeight,
  getSegmentSlopeFrame,
  type RoofGlazing,
  RoofNode,
  RoofSegmentNode,
  type RoofSystemType,
  type RoofType,
  type WallNode,
} from '../schema'
import { planRoofLevel, roofsOver } from '../services/roof-level'
import { resolveRoofElevation } from '../systems/roof/roof-elevation'
import { applySceneChanges } from './apply-changes'
import { requireLevel } from './level-target'
import { finishSurface, requireMaterialRef } from './material-refs'
import { buildingFrame, type RoofRectangle, roofRectangles } from './roof-footprint'
import { levelRole, levelsOf } from './scene-queries'
import type { AgentContext, AgentOperation, SceneChanges, SceneNodes } from './types'

type Pt = [number, number]
const mm = (value: number) => Math.round(value * 1000) / 1000
type Level = AnyNode & { type: 'level' }

type CreateRoofInput = {
  levelId?: string
  level?: string
  roofSystem?: RoofSystemType
  glazing?: RoofGlazing
  barrelRise?: number
  barrelSegments?: number
  wallThickness?: number
  roofType?: RoofType
  pitch?: number
  overhang?: number
  wallHeight?: number
  width?: number
  depth?: number
  center?: number[]
  materialPreset?: string
  fasciaHeight?: number
  fasciaMaterialPreset?: string
  name?: string
}

/** A storey a roof can cover: one with a footprint (`footprintPolygons`). */
const hasFootprint = (nodes: SceneNodes, levelId: string) =>
  footprintPolygons(nodes, levelId).length > 0

const buildingLevels = (nodes: SceneNodes, level: Level) =>
  levelsOf(nodes).filter((other) => other.parentId === level.parentId)

/** The segment fields the fascia input writes: none without a band. */
function fasciaFields({ fasciaHeight, fasciaMaterialPreset }: CreateRoofInput) {
  if (fasciaHeight === undefined && !fasciaMaterialPreset) return {}
  return {
    fascia: true,
    ...(fasciaHeight !== undefined ? { fasciaHeight } : {}),
    ...(fasciaMaterialPreset ? { fasciaMaterialPreset } : {}),
  }
}

/** A level a roof can cap: not a roof level, not a support level. */
const isStorey = (nodes: SceneNodes, level: Level) => levelRole(nodes, level).role === 'occupied'

/**
 * The storey a roof covers: the one named when it has a footprint, else the highest storey of its
 * building with one; none named, the top storey with one of the building in view. A rectangle of
 * its own needs no footprint: the storey named, else the top one that holds something. The floor
 * in view does not decide: a person looking at the ground floor who asks for a roof means the
 * house's. A roof level named stands for the storey under it.
 */
function coveredStorey(
  nodes: SceneNodes,
  input: CreateRoofInput,
  rectangle: boolean,
  context: AgentContext,
) {
  const { levelId, level } = input
  if (levelId && level && levelId !== level)
    refuse(
      'conflicting_level',
      `levelId (${levelId}) and level (${level}) disagree; they are the same field, pass one.`,
      { levelId, level },
    )
  const named = levelId ?? level
  const requested = named ? requireLevel(nodes, named) : null
  if (requested && isStorey(nodes, requested) && (rectangle || hasFootprint(nodes, requested.id)))
    return { storey: requested }
  const viewed = context.activeLevelId ? nodes[context.activeLevelId] : undefined
  const scope = requested ?? (viewed?.type === 'level' ? viewed : null)
  const candidates = (scope ? buildingLevels(nodes, scope) : levelsOf(nodes)).filter((candidate) =>
    isStorey(nodes, candidate),
  )
  const eligible = rectangle
    ? candidates.filter((candidate) => candidate.children.length > 0)
    : candidates.filter((candidate) => hasFootprint(nodes, candidate.id))
  // With no level in view (the MCP), the last level by ordinal would pick a building by its id;
  // a rectangle with no level holding anything falls back to every candidate, so asks of those.
  const buildingIds = [
    ...new Set(
      (rectangle && !eligible.length ? candidates : eligible).map(
        (candidate) => candidate.parentId,
      ),
    ),
  ]
  if (!scope && buildingIds.length > 1)
    refuse(
      'building_required',
      `The scene has ${buildingIds.length} buildings to roof; pass a level of the one to roof: ${buildingIds.join(', ')}.`,
      { buildingIds },
    )
  if (rectangle) {
    const top = eligible.at(-1) ?? candidates.at(-1)
    if (!top) refuse('no_levels', 'The scene has no storey to roof yet.')
    return { storey: top }
  }
  const storey = eligible.at(-1)
  if (!storey)
    refuse(
      'no_rooms',
      `No rooms or closed walls on ${requested ? `${requested.id} or any other level of its building` : 'any level'}: create rooms first, or pass width and depth to roof a rectangle of your own.`,
      requested ? { levelId: requested.id } : {},
    )
  return {
    storey,
    ...(requested &&
      requested.id !== storey.id && {
        note: `Level ${requested.id} has no rooms or closed walls; the roof covers ${storey.name ?? storey.id} (${storey.id}), the highest level with rooms.`,
      }),
  }
}

/**
 * The storey's outline from its walls, every gap bridged as L5 finds them: a roof covers the
 * building, not only the rooms closed so far (the 290 traced from its PNG, its doors and windows
 * still gaps, got a roof over a few rooms only).
 */
function wallOutline(nodes: SceneNodes, storeyId: string) {
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === storeyId,
  )
  if (walls.length < 3) return []
  const bridges = gapBridges(walls).map(
    (gap, index) =>
      ({
        ...walls[0],
        id: `wall_roof_gap_${index}`,
        start: gap.start,
        end: gap.end,
        thickness: gap.thickness,
        curveOffset: 0,
      }) as WallNode,
  )
  // Ends a few centimetres apart are one corner: a vectorised plan's near-misses.
  const closed = [...walls, ...bridges]
  const outlines = exteriorWallOutlines(closed, NEAR_MISS)
  if (!outlines.length) return []
  // Out to the walls' outer faces, as a floor plate reaches: half the outline walls' thickness.
  const thickness = new Map(closed.map((wall) => [wall.id, wall.thickness ?? 0.2]))
  const onOutline = exteriorWallLoops(closed, NEAR_MISS)
    .flat()
    .map((face) => thickness.get(face.wallId) ?? 0.2)
    .sort((a, b) => a - b)
  const half = (onOutline[Math.floor(onOutline.length / 2)] ?? 0.2) / 2
  return outlines.map((polygon) => grown(polygon, half))
}

/**
 * How far a mitre may reach, in multiples of the distance moved: past it (a corner under about
 * 29°, or an edge folding back on itself) the corner is bevelled, as an SVG stroke's is.
 */
const MITER_LIMIT = 4

/** A polygon moved out by `distance` along each edge's outward normal, corners mitred up to the limit. */
export function grown(polygon: Pt[], distance: number): Pt[] {
  const n = polygon.length
  let area = 0
  for (let i = 0; i < n; i++) {
    const [ax, az] = polygon[i]!
    const [bx, bz] = polygon[(i + 1) % n]!
    area += ax * bz - bx * az
  }
  const side = area > 0 ? 1 : -1
  const normal = (a: Pt, b: Pt): Pt => {
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
    const length = Math.hypot(dx, dz) || 1
    return [(side * dz) / length, (-side * dx) / length]
  }
  return polygon.flatMap((point, i): Pt[] => {
    const before = normal(polygon[(i - 1 + n) % n]!, point)
    const after = normal(point, polygon[(i + 1) % n]!)
    const dot = before[0] * after[0] + before[1] * after[1]
    // The mitre reaches distance × √(2 / (1 + dot)): unbounded as the edges fold onto each other.
    if (1 + dot < 2 / MITER_LIMIT ** 2)
      return [
        [point[0] + before[0] * distance, point[1] + before[1] * distance],
        [point[0] + after[0] * distance, point[1] + after[1] * distance],
      ]
    // Along the bisector, as far as both edges move by `distance`.
    const scale = distance / (1 + dot)
    return [[point[0] + (before[0] + after[0]) * scale, point[1] + (before[1] + after[1]) * scale]]
  })
}

const NEAR_MISS = 0.1

/**
 * A storey's footprint: its walls' outline, every gap bridged, else its floor plates (a balcony's
 * left out; overlapping plates are one footprint), else its rooms.
 */
function footprintPolygons(nodes: SceneNodes, storeyId: string): Pt[][] {
  const outline = wallOutline(nodes, storeyId)
  if (outline.length) return outline
  const on = (type: 'slab' | 'zone') =>
    Object.values(nodes).filter(
      (node) =>
        node.type === type &&
        node.parentId === storeyId &&
        !(
          node.type === 'slab' &&
          node.metadata &&
          (node.metadata as { balcony?: unknown }).balcony
        ),
    ) as (AnyNode & { polygon: Pt[] })[]
  const plates = on('slab')
  return (plates.length ? plates : on('zone')).map((node) => node.polygon)
}

/** Rectangles in the storey's own frame and the turn back to the world, from its footprint. */
function footprintOf(nodes: SceneNodes, storeyId: string) {
  const frame = buildingFrame(footprintPolygons(nodes, storeyId))
  const { rectangles, roofType } = roofRectangles(frame.polygons)
  return { rectangles, roofType, angle: frame.angle, toWorld: frame.toWorld }
}

/**
 * `create_roof`: a roof over a storey, one segment per rectangle of its footprint (or the one
 * rectangle asked for), on the building's roof level above it, standing on the storey's walls.
 */
export const createRoof: AgentOperation<CreateRoofInput> = (nodes, input, context) => {
  const { width, depth } = input
  // A finish the library lacks would render as the default.
  const materialPreset =
    input.materialPreset === undefined
      ? undefined
      : requireMaterialRef(input.materialPreset, 'materialPreset', finishSurface('roof'))
  const fasciaMaterialPreset =
    input.fasciaMaterialPreset === undefined
      ? undefined
      : requireMaterialRef(
          input.fasciaMaterialPreset,
          'fasciaMaterialPreset',
          finishSurface('roof'),
        )
  if ((width === undefined) !== (depth === undefined))
    refuse(
      'rectangle_incomplete',
      'A rectangle of your own takes width and depth together; pass both, or neither to cover the footprint.',
      { width, depth },
    )
  const rectangle = width !== undefined && depth !== undefined
  const { storey, note } = coveredStorey(nodes, input, rectangle, context)

  if (!storey.parentId)
    refuse(
      'storey_without_building',
      `${storey.name ?? storey.id} (${storey.id}) is not in a building, so no roof level can stand above it. Put the level in a building first.`,
      { levelId: storey.id },
    )
  const existing = roofsOver(nodes, storey.id)
  if (existing.length)
    refuse(
      'roof_exists',
      `${storey.name ?? storey.id} (${storey.id}) already has a roof, ${existing.map((roof) => roof.id).join(', ')}: a storey takes one. Edit it, or delete_node it first if the person asked for a new one.`,
      { levelId: storey.id, roofIds: existing.map((roof) => roof.id) },
    )

  let rectangles: RoofRectangle[]
  let chosenType: RoofType
  let angle = 0
  let toWorld = ([x, z]: Pt): Pt => [x, z]
  if (rectangle) {
    const [x = 0, z = 0] = input.center ?? []
    const r = { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 }
    rectangles = [r]
    // The size as asked, the type as the footprint rule would give it.
    chosenType = roofRectangles([
      [
        [r.minX, r.minZ],
        [r.maxX, r.minZ],
        [r.maxX, r.maxZ],
        [r.minX, r.maxZ],
      ],
    ]).roofType
  } else {
    const footprint = footprintOf(nodes, storey.id)
    rectangles = footprint.rectangles
    chosenType = footprint.roofType
    angle = footprint.angle
    toWorld = footprint.toWorld
  }
  const roofType = input.roofType ?? chosenType
  if (input.roofSystem === 'glazed' && !['gable', 'shed', 'barrel'].includes(roofType))
    refuse('unsupported_glazing', 'Glazed roofs support gable, straight shed, and barrel shapes.')

  const minX = Math.min(...rectangles.map((r) => r.minX))
  const maxX = Math.max(...rectangles.map((r) => r.maxX))
  const minZ = Math.min(...rectangles.map((r) => r.minZ))
  const maxZ = Math.max(...rectangles.map((r) => r.maxZ))
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  const wallHeight = input.wallHeight ?? 0
  const segments = rectangles.map((r) => {
    // To the millimetre: snapped coordinates subtract to 6.199999…
    const span = { width: mm(r.maxX - r.minX), depth: mm(r.maxZ - r.minZ) }
    // A cone stands on a circle.
    const size =
      roofType === 'conical'
        ? { width: Math.max(span.width, span.depth), depth: Math.max(span.width, span.depth) }
        : span
    if (
      roofType === 'barrel' &&
      input.barrelRise !== undefined &&
      input.barrelRise > size.depth / 2
    )
      refuse('invalid_barrel_rise', 'Barrel rise must not exceed half the span.')
    const segment = RoofSegmentNode.parse({
      roofSystem: input.roofSystem,
      glazing: input.glazing,
      barrelRise: input.barrelRise,
      barrelSegments: input.barrelSegments,
      ...(input.wallThickness !== undefined && { wallThickness: input.wallThickness }),
      ...size,
      roofType,
      wallHeight,
      position: [(r.minX + r.maxX) / 2 - centerX, 0, (r.minZ + r.maxZ) / 2 - centerZ],
      ...(input.pitch !== undefined && { pitch: input.pitch }),
      ...(input.overhang !== undefined && { overhang: input.overhang }),
      ...fasciaFields({ ...input, fasciaMaterialPreset }),
    })
    // The overhang is asked as the eaves' reach past the walls, in plan, as a builder says it and
    // Architect's roofs take it; the segment stores it along the slope.
    // A barrel's overhang is at its ends, already in plan.
    if (roofType === 'barrel') return segment
    return { ...segment, overhang: segment.overhang / getSegmentSlopeFrame(segment).cosTheta }
  })

  const peak = Math.max(...segments.map((segment) => getActiveRoofHeight(segment)))
  const plan = planRoofLevel(nodes, storey.id, wallHeight + peak)
  if (plan.kind === 'storey') {
    const above = nodes[plan.levelId] as Level
    refuse(
      'storey_above',
      `${storey.name ?? storey.id} (${storey.id}) has a storey above it, ${above.name ?? above.id} (${above.id}): create_roof caps the top storey, and its roof covers the floors under it. A roof over a lower wing or a porch of ${storey.name ?? storey.id} stands on its walls, below the top storey's: do not roof it from the top storey; the person draws it with the Roof tool on ${storey.name ?? storey.id}.`,
      { levelId: storey.id, storeyAboveId: above.id },
    )
  }

  const changes: Required<Pick<SceneChanges, 'create' | 'update'>> = {
    create: plan.create ? [{ node: plan.create, parentId: plan.create.parentId ?? undefined }] : [],
    update: plan.update,
  }
  const [roofX, roofZ] = toWorld([centerX, centerZ])
  const placed = RoofNode.parse({
    name: input.name ?? 'Roof',
    parentId: plan.levelId,
    position: [roofX, 0, roofZ],
    rotation: angle,
    support: { kind: 'walls' },
    children: segments.map((segment) => segment.id),
    ...(materialPreset && { materialPreset }),
  })
  const draft = [
    { node: placed, parentId: plan.levelId },
    ...segments.map((segment) => ({
      node: { ...segment, parentId: placed.id } as AnyNode,
      parentId: placed.id,
    })),
  ]
  // The eave on the storey's wall tops, as the editor's own follow resolves it: walls taller than
  // their storey lift it, and the editor makes no second write after the call.
  const seated = applySceneChanges(nodes, { ...changes, create: [...changes.create, ...draft] })
  const elevation = resolveRoofElevation(
    seated[placed.id as AnyNodeId] as RoofNode,
    seated as Record<string, AnyNode>,
  )
  const roof = { ...placed, position: [roofX, elevation, roofZ] as [number, number, number] }
  // A roof level made for it is as tall as the roof rises over it, the eave's lift included.
  if (plan.create)
    changes.create[0] = {
      node: { ...plan.create, height: Math.max(elevation + wallHeight + peak, 0.2) },
      parentId: plan.create.parentId ?? undefined,
    }
  changes.create.push({ node: roof, parentId: plan.levelId }, ...draft.slice(1))

  return {
    result: {
      ok: true,
      roofId: roof.id,
      roofLevelId: plan.levelId,
      createdRoofLevelId: plan.create?.id ?? null,
      coveredLevelId: storey.id,
      segmentIds: segments.map((segment) => segment.id),
      roofType,
      message: `Created a ${roofType} roof of ${segments.length} segment${segments.length === 1 ? '' : 's'} over ${storey.name ?? storey.id}, on the roof level ${plan.levelId}.`,
      ...(note && { note }),
    },
    changes,
  }
}
