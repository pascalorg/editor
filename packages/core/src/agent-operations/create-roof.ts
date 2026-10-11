import { refuse } from '../agent-tools/refusal'
import { gapBridges } from '../building/wall-gaps'
import { exteriorWallLoops, exteriorWallOutlines } from '../lib/exterior-wall-loops'
import {
  type AnyNode,
  getActiveRoofHeight,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  type RoofType,
  type WallNode,
} from '../schema'
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

/** A storey a roof can cover: rooms, or walls whose outline closes once their gaps are bridged. */
const hasFootprint = (nodes: SceneNodes, levelId: string) =>
  Object.values(nodes).some((node) => node.type === 'zone' && node.parentId === levelId) ||
  wallOutline(nodes, levelId).length > 0

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

/**
 * The storey a roof covers: the one named when it has rooms, else the highest storey of its
 * building with rooms; none named, the top storey with rooms of the building in view. A rectangle
 * of its own needs no rooms: the storey named, else the top one. The floor in view does not
 * decide: a person looking at the ground floor who asks for a roof means the house's.
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
  if (requested && (rectangle || hasFootprint(nodes, requested.id))) return { storey: requested }
  const viewed = context.activeLevelId ? nodes[context.activeLevelId] : undefined
  const candidates = requested
    ? buildingLevels(nodes, requested)
    : viewed?.type === 'level'
      ? buildingLevels(nodes, viewed)
      : levelsOf(nodes)
  if (rectangle) {
    const top = candidates.filter((candidate) => levelRole(nodes, candidate).role === 'occupied')
    if (!top.length) refuse('no_levels', 'The scene has no storey to roof yet.')
    return { storey: top.at(-1)! }
  }
  const storey = candidates.filter((candidate) => hasFootprint(nodes, candidate.id)).at(-1)
  if (!storey)
    refuse(
      'no_rooms',
      `No rooms or closed walls on ${requested ? `${requested.id} or any other level of its building` : 'any level'}: create rooms first, or pass width and depth to roof a rectangle of your own.`,
      requested ? { levelId: requested.id } : {},
    )
  return {
    storey,
    ...(requested && {
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

/** A polygon moved out by `distance` along each edge's outward normal, corners mitred. */
function grown(polygon: Pt[], distance: number): Pt[] {
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
  return polygon.map((point, i) => {
    const before = normal(polygon[(i - 1 + n) % n]!, point)
    const after = normal(point, polygon[(i + 1) % n]!)
    const sum: Pt = [before[0] + after[0], before[1] + after[1]]
    const dot = before[0] * after[0] + before[1] * after[1]
    // Along the bisector, as far as both edges move by `distance`.
    const scale = distance / (1 + dot)
    return [point[0] + sum[0] * scale, point[1] + sum[1] * scale]
  })
}

const NEAR_MISS = 0.1

/**
 * Rectangles in the storey's own frame and the turn back to the world: its walls' outline, else
 * its plates, else its rooms.
 */
function footprintOf(nodes: SceneNodes, storeyId: string) {
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
  const outline = wallOutline(nodes, storeyId)
  const frame = buildingFrame(
    outline.length ? outline : (plates.length ? plates : on('zone')).map((node) => node.polygon),
  )
  const { rectangles, roofType } = roofRectangles(frame.polygons)
  return { rectangles, roofType, angle: frame.angle, toWorld: frame.toWorld }
}

/**
 * `create_roof`: a roof over a storey, one segment per rectangle of its footprint (or the one
 * rectangle asked for), on a roof level above it.
 */
export const createRoof: AgentOperation<CreateRoofInput> = (nodes, input, context) => {
  const { width, depth } = input
  // A finish the library lacks renders as the default (main's build-off fix, on the shared tool).
  const materialPreset =
    input.materialPreset === undefined
      ? undefined
      : requireMaterialRef(input.materialPreset, 'materialPreset', finishSurface('roof'))
  if ((width === undefined) !== (depth === undefined))
    refuse(
      'rectangle_incomplete',
      'A rectangle of your own takes width and depth together; pass both, or neither to cover the footprint.',
      { width, depth },
    )
  const rectangle = width !== undefined && depth !== undefined
  const { storey, note } = coveredStorey(nodes, input, rectangle, context)

  // The roof stands on the level directly above: a roof level or an empty one. A storey there
  // means this is not the top one; a roof over it would cut through the storey above.
  const above = buildingLevels(nodes, storey).find((other) => other.level === storey.level + 1)
  if (above && levelRole(nodes, above).role === 'occupied' && above.children.length > 0)
    refuse(
      'storey_above',
      `${storey.name ?? storey.id} (${storey.id}) has a storey above it, ${above.name ?? above.id} (${above.id}): a roof caps the top storey. Pass the top storey (with width and depth when it has no rooms).`,
      { levelId: storey.id, storeyAboveId: above.id },
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
    return RoofSegmentNode.parse({
      ...size,
      roofType,
      wallHeight,
      position: [(r.minX + r.maxX) / 2 - centerX, 0, (r.minZ + r.maxZ) / 2 - centerZ],
      ...(input.pitch !== undefined && { pitch: input.pitch }),
      ...(input.overhang !== undefined && { overhang: input.overhang }),
      ...fasciaFields(input),
    })
  })

  const changes: Required<Pick<SceneChanges, 'create'>> = { create: [] }
  let roofLevelId = above?.id ?? storey.id
  let createdRoofLevelId: string | null = null
  if (!above && storey.parentId) {
    const peak = Math.max(...segments.map((segment) => getActiveRoofHeight(segment)))
    const roofLevel = LevelNode.parse({
      name: 'Roof',
      parentId: storey.parentId,
      level: storey.level + 1,
      height: Math.max(wallHeight + peak, 0.2),
      metadata: { role: 'roof', label: 'Roof', referenceLevelId: storey.id },
    })
    roofLevelId = createdRoofLevelId = roofLevel.id
    changes.create.push({ node: roofLevel, parentId: storey.parentId })
  }

  const [roofX, roofZ] = toWorld([centerX, centerZ])
  const roof = RoofNode.parse({
    name: input.name ?? 'Roof',
    parentId: roofLevelId,
    position: [roofX, 0, roofZ],
    rotation: angle,
    children: segments.map((segment) => segment.id),
    ...(materialPreset && { materialPreset }),
    metadata: { referenceLevelId: storey.id, roofLevelId },
  })
  changes.create.push({ node: roof, parentId: roofLevelId })
  for (const segment of segments)
    changes.create.push({ node: { ...segment, parentId: roof.id }, parentId: roof.id })

  return {
    result: {
      roofId: roof.id,
      roofLevelId,
      createdRoofLevelId,
      referenceLevelId: storey.id,
      segmentIds: segments.map((segment) => segment.id),
      roofType,
      message: `Created a ${roofType} roof of ${segments.length} segment${segments.length === 1 ? '' : 's'} over ${storey.name ?? storey.id}.`,
      ...(note && { note }),
    },
    changes,
  }
}
