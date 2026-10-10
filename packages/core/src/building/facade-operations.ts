import type { AnyNode, AnyNodeId, BuildingNode, FacadeArea, WallNode } from '../schema'
import { FacadeNode } from '../schema'
import type { Camera } from '../schema/camera'
import { getLevelElevations } from '../services/storey'
import { type FacadeMode, readWallFacade } from '../systems/facade/facade-config'
import type { FacadeSet } from '../systems/facade/facade-set'
import type { FacadeBay, FacadeUnit } from '../systems/facade/facade-unit'
import { buildingLevels, outsideLoop, wallsByLevel } from './facade-loops'
import { facadeFace, facadeFaceNormal } from './facade-runs'
import {
  defaultFacadeAreas,
  facadeLevelRoles,
  facadeSegmentsFromWalls,
  planFacadeSet,
} from './facade-set'

/** A request a facade operation turns down: a code an agent can refuse with, and why. */
export class FacadeOperationError extends Error {
  constructor(
    readonly code: 'building_not_found' | 'wall_not_found' | 'not_a_wall' | 'no_storeys',
    message: string,
  ) {
    super(message)
  }
}

/** The facade node a set was applied as on this building, if any. */
export function buildingFacadeNode(nodes: Record<string, AnyNode>, buildingId: string) {
  const building = nodes[buildingId]
  if (building?.type !== 'building') return undefined
  return building.children
    .map((id) => nodes[id])
    .find((node): node is FacadeNode => node?.type === 'facade')
}

/** A free unit's area: walls picked on one storey, from that storey to the top one. */
export function facadeFreeArea({
  nodes,
  buildingId,
  unitKey,
  walls,
}: {
  nodes: Record<string, AnyNode>
  buildingId: string
  unitKey: string
  walls: readonly WallNode[]
}): FacadeArea | null {
  const { levels } = facadeLevelRoles(nodes, buildingId)
  const picked = levels.filter((level) => walls.some((wall) => wall.parentId === level.id))
  if (!picked.length || !levels.length) return null
  return {
    key: unitKey,
    unit: unitKey,
    from: picked[0]!.id,
    to: levels.at(-1)!.id,
    target: { kind: 'segments', segments: facadeSegmentsFromWalls(walls, nodes) },
  }
}

/**
 * The facade node a set applies as on a building: its storey roles, then its
 * free units' areas, all placing or keeping openings as asked. It reuses the
 * building's facade node, so applying again updates it.
 */
export function facadeNodeForSet({
  nodes,
  buildingId,
  set,
  freeAreas = [],
  mode = 'place',
  sourceItemId,
}: {
  nodes: Record<string, AnyNode>
  buildingId: string
  set: FacadeSet
  freeAreas?: readonly FacadeArea[]
  mode?: FacadeMode
  /** The catalog entry the set came from; null clears it, leaving it out keeps the building's. */
  sourceItemId?: string | null
}): FacadeNode {
  if (nodes[buildingId]?.type !== 'building')
    throw new FacadeOperationError('building_not_found', `Building not found: ${buildingId}.`)
  const free = new Set(set.units.filter((u) => u.role === 'free').map((u) => u.key))
  const name = set.name.trim() || 'Facade set'
  const { sourceItemId: kept, ...existing } = buildingFacadeNode(nodes, buildingId) ?? {}
  const source = sourceItemId === undefined ? kept : (sourceItemId ?? undefined)
  return FacadeNode.parse({
    ...existing,
    ...(source ? { sourceItemId: source } : {}),
    parentId: buildingId,
    name,
    set: { ...set, name },
    areas: [
      ...defaultFacadeAreas(set, nodes, buildingId),
      ...freeAreas.filter((area) => free.has(area.unit)),
    ].map((area) => ({ ...area, mode: mode === 'dress' ? mode : undefined })),
  })
}

/**
 * Apply a set to a building in one call: the facade node, the plan (one patch
 * batch), coverage and issues. Pure; the caller writes the patches.
 */
export function planBuildingFacade({
  nodes,
  buildingId,
  set,
  freeAreas,
  mode,
  force,
  replaceExisting,
}: Parameters<typeof facadeNodeForSet>[0] & { force?: boolean; replaceExisting?: boolean }) {
  const facade = facadeNodeForSet({ nodes, buildingId, set, freeAreas, mode })
  return { facade, ...planFacadeSet({ facade, nodes, force, replaceExisting }) }
}

const round = (value: number) => Math.round(value * 1000) / 1000
const size = (width: number, height: number) => `${round(width)} × ${round(height)} m`

function describeBay(bay: FacadeBay) {
  const { opening, balcony, infill, spandrel } = bay
  return {
    key: bay.key,
    ...(bay.name ? { name: bay.name } : {}),
    width: round(bay.width),
    widthMode: bay.widthMode,
    anchor: bay.horizontal,
    pier: round(bay.pier),
    endPier: round(bay.endPier),
    ...(opening
      ? {
          opening: {
            kind: opening.kind,
            width: round(opening.width),
            height: round(opening.height),
            sill: round(opening.sill),
            panes: `${opening.columnRatios?.length ?? opening.columns}×${opening.rowRatios?.length ?? opening.rows}`,
            ...(opening.rowRatios ? { rowRatios: opening.rowRatios } : {}),
            ...(opening.columnRatios ? { columnRatios: opening.columnRatios } : {}),
            type: opening.kind === 'door' ? opening.doorType : opening.windowType,
            ...(opening.recess === undefined ? {} : { recess: opening.recess }),
            ...(opening.sillDepth === undefined ? {} : { sillDepth: opening.sillDepth }),
            ...(opening.frameDepth === undefined ? {} : { frameDepth: opening.frameDepth }),
            ...(opening.shape ? { shape: opening.shape } : {}),
          },
        }
      : {}),
    ...(balcony
      ? {
          balcony: {
            depth: balcony.depth,
            railing: balcony.railing,
            span: balcony.span,
            ...(balcony.ornament ? { ornament: balcony.ornament } : {}),
          },
        }
      : {}),
    ...(infill
      ? {
          infill: {
            material: infill.material,
            sides: infill.sides,
            ...(infill.width === undefined ? {} : { width: infill.width }),
          },
        }
      : {}),
    ...(spandrel ? { spandrel: { material: spandrel.material, parts: spandrel.parts } } : {}),
    ...(bay.surround
      ? {
          surround: {
            material: bay.surround.material,
            width: bay.surround.width,
            head: bay.surround.head,
          },
        }
      : {}),
    ...(bay.variants?.length
      ? {
          variants: bay.variants.map((variant) => ({
            weight: variant.weight,
            ...(() => {
              const changes = (
                ['opening', 'balcony', 'infill', 'spandrel', 'surround'] as const
              ).filter((part) => variant[part] !== undefined)
              return changes.length ? { changes } : {}
            })(),
          })),
        }
      : {}),
  }
}

/** One line a model can read at a glance: what the unit's bays look like. */
function summarise(unit: FacadeUnit) {
  const bays = unit.bays.map((bay) => {
    const opening = bay.opening
      ? `${bay.opening.kind} ${size(bay.opening.width, bay.opening.height)}, ${bay.opening.columnRatios?.length ?? bay.opening.columns}×${bay.opening.rowRatios?.length ?? bay.opening.rows} panes`
      : 'blank'
    const extras = [
      bay.balcony && 'balcony',
      bay.infill && 'infill',
      bay.spandrel && 'spandrel',
      bay.surround && 'surround',
      bay.variants?.length && `${bay.variants.length} looks`,
    ].filter(Boolean)
    return `${bay.widthMode} ${round(bay.width)} m bay (${opening}${extras.length ? `; ${extras.join(', ')}` : ''}), piers ${round(bay.pier)} m`
  })
  return `${unit.name}: ${bays.join('; ') || 'no bays'}${unit.rhythm === 'side' ? ', one rhythm per side' : ''}`
}

/**
 * A set as data a model can read back: each unit's role, paint, rhythm,
 * variation and bays, plus the corner chain and bands. It carries no scene ids.
 */
export function describeFacadeSet(set: FacadeSet) {
  return {
    name: set.name,
    ...(set.style ? { style: set.style } : {}),
    ...(set.tags?.length ? { tags: set.tags } : {}),
    units: set.units.map(({ key, role, unit }) => ({
      key,
      role,
      name: unit.name,
      summary: summarise(unit),
      paint: unit.paint,
      rhythm: unit.rhythm ?? 'room',
      obstacles: unit.obstacles ?? 'skip',
      ...(unit.seed === undefined ? {} : { seed: unit.seed }),
      ...(unit.imperfection === undefined ? {} : { imperfection: unit.imperfection }),
      ...(unit.piers
        ? { piers: { material: unit.piers.material, thickness: unit.piers.thickness } }
        : {}),
      bays: unit.bays.map(describeBay),
    })),
    corners: set.corners ?? [],
    bands: set.bands ?? [],
  }
}

/** A facade node described: its set, then where each unit went, in storeys the model can name. */
export function describeFacade(facade: FacadeNode, nodes: Record<string, AnyNode>) {
  const name = (id: string) => {
    const level = nodes[id]
    return level?.type === 'level'
      ? (level.name ?? `Level ${level.level}`)
      : 'a storey that is gone'
  }
  return {
    ...describeFacadeSet(facade.set),
    areas: facade.areas.map((area) => ({
      key: area.key,
      unit: area.unit,
      storeys: area.from === area.to ? name(area.from) : `${name(area.from)} – ${name(area.to)}`,
      from: area.from,
      to: area.to,
      mode: area.mode ?? 'place',
      target:
        area.target.kind === 'loop'
          ? 'outside loop'
          : `${area.target.segments.length} plan segment${area.target.segments.length === 1 ? '' : 's'}`,
    })),
  }
}

type Vec3 = [number, number, number]

/**
 * A camera that sees one side of the building as a street photo did: from the
 * side's outside, turned `angle` degrees round it (positive to the right, seen
 * from the street), eyes at `height` above the ground, framing the whole side
 * over every storey. A camera, not a render: the caller renders it. Coordinates
 * are the scene's, so the building's place and turn on the site are applied.
 */
export function facadeViewpoint({
  nodes,
  wallId,
  angle = 0,
  height = 1.6,
  fov = 50,
  aspect = 4 / 3,
}: {
  nodes: Record<string, AnyNode>
  /** Any wall on the side, on any storey. */
  wallId: string
  /** Degrees between the photo's line of sight and the side's outward normal. */
  angle?: number
  /** Eye height above the building's ground, in metres. */
  height?: number
  /** Vertical field of view, in degrees. */
  fov?: number
  /** Width over height of the photo. */
  aspect?: number
}) {
  const wall = nodes[wallId]
  if (!wall) throw new FacadeOperationError('wall_not_found', `Wall not found: ${wallId}.`)
  if (wall.type !== 'wall')
    throw new FacadeOperationError('not_a_wall', `Node ${wallId} is a ${wall.type}, not a wall.`)
  const level = nodes[wall.parentId as string]
  const buildingId = level?.parentId as string | undefined
  const building = buildingId ? nodes[buildingId] : undefined
  if (building?.type !== 'building')
    throw new FacadeOperationError('building_not_found', 'This wall is not in a building.')

  // The side faces where the wall's facade faces, else out of its storey's loop.
  const byLevel = wallsByLevel(nodes)
  const onLoop = outsideLoop(byLevel.get(wall.parentId as string) ?? [wall])?.find(
    (face) => face.wallId === wall.id,
  )
  const face =
    readWallFacade(wall.metadata)?.face ?? onLoop?.face ?? facadeFace(wall, { surface: 'exterior' })
  const normal = facadeFaceNormal(wall, face)
  const direction: [number, number] = [-normal[1], normal[0]]
  const line = (wall.start[0] * normal[0] + wall.start[1] * normal[1]) as number

  // The side over every storey: the walls on the wall's line, facing the same way.
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const levels = buildingLevels(nodes, building.id)
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  let top = Number.NEGATIVE_INFINITY
  let bottom = Number.POSITIVE_INFINITY
  let depth = 0
  for (const storey of levels) {
    for (const other of byLevel.get(storey.id) ?? []) {
      const [ax, az] = other.start
      const [bx, bz] = other.end
      const offA = ax * normal[0] + az * normal[1] - line
      const offB = bx * normal[0] + bz * normal[1] - line
      if (Math.abs(offA) > 0.15 || Math.abs(offB) > 0.15) continue
      const half = (other.thickness ?? 0.2) / 2
      const alongA = ax * direction[0] + az * direction[1]
      const alongB = bx * direction[0] + bz * direction[1]
      lo = Math.min(lo, alongA - half, alongB - half)
      hi = Math.max(hi, alongA + half, alongB + half)
      depth = Math.max(depth, half)
      const elevation = elevations.get(storey.id)
      bottom = Math.min(bottom, elevation?.baseY ?? 0)
      top = Math.max(top, (elevation?.baseY ?? 0) + (elevation?.height ?? 3))
    }
  }
  if (!Number.isFinite(lo))
    throw new FacadeOperationError('no_storeys', 'This side has no walls to frame.')

  const centreAlong = (lo + hi) / 2
  const width = hi - lo
  const sideHeight = top - bottom
  // Building-local plan point of the side's centre, on its outer face.
  const faceLine = line + depth
  const centre: [number, number] = [
    direction[0] * centreAlong + normal[0] * faceLine,
    direction[1] * centreAlong + normal[1] * faceLine,
  ]
  const target: Vec3 = [centre[0], bottom + sideHeight / 2, centre[1]]
  // Seen from outside, right is the side's direction reversed (the viewer faces −normal).
  const turn = (angle * Math.PI) / 180
  const right: [number, number] = [-direction[0], -direction[1]]
  const out: [number, number] = [
    normal[0] * Math.cos(turn) + right[0] * Math.sin(turn),
    normal[1] * Math.cos(turn) + right[1] * Math.sin(turn),
  ]
  // Far enough that the side fits the frame, with a margin, whichever way it is seen.
  const tanV = Math.tan(((fov / 2) * Math.PI) / 180)
  const spread = Math.abs(Math.cos(turn)) * width + Math.abs(Math.sin(turn)) * 2 * depth
  const lift = Math.abs(target[1] - (bottom + height))
  const distance =
    1.15 * Math.max(spread / 2 / (tanV * aspect), (sideHeight / 2 + lift) / tanV) +
    Math.abs(Math.sin(turn)) * (width / 2)
  const eye: Vec3 = [centre[0] + out[0] * distance, bottom + height, centre[1] + out[1] * distance]

  // Into the scene: the building's turn about Y, then its place on the site.
  const [px, py, pz] = (building as BuildingNode).position
  const theta = (building as BuildingNode).rotation[1] ?? 0
  const world = ([x, y, z]: Vec3): Vec3 => [
    px + x * Math.cos(theta) + z * Math.sin(theta),
    py + y,
    pz - x * Math.sin(theta) + z * Math.cos(theta),
  ]
  const camera: Camera & { fov: number } = {
    position: world(eye),
    target: world(target),
    mode: 'perspective',
    fov,
  }
  return {
    camera,
    aspect,
    side: {
      width: round(width),
      height: round(sideHeight),
      facing: [round(normal[0]), round(normal[1])] as [number, number],
    },
  }
}
