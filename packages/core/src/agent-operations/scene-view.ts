import { refuse } from '../agent-tools/refusal'
import type { VIEW_SIDES } from '../agent-tools/view-scene'
import type {
  AnyNode,
  AnyNodeId,
  ColumnNode,
  FenceNode,
  ItemNode,
  RoofNode,
  SlabNode,
  StairNode,
  WallNode,
} from '../schema'
import { getActiveRoofHeight } from '../schema'
import { getLevelElevations } from '../services/storey'
import { resolveWallExteriorSide } from '../systems/wall/wall-assembly'

/**
 * Where `view_scene` looks from, the same on every surface; the picture is the host's: the chat's
 * editor renders it, the MCP asks an editor tab open on the project.
 */

export type SceneViewBox = { min: [number, number, number]; max: [number, number, number] }
export type SceneViewSide = (typeof VIEW_SIDES)[number]

export type SceneViewInput = {
  target?: string
  interior?: SceneViewInterior
  from?: SceneViewSide
  position?: number[]
  elevation?: number
  eyeHeight?: number
  fov?: number
  projection?: 'perspective' | 'orthographic'
  camera?: { position: number[]; target: number[]; fov: number; aspect: number }
  photo?: { source: string; region: number[] }
}

/** A region of the reference photo the host crops and returns beside the view. */
export type SceneViewCrop = { source: string; region: [number, number, number, number] }

/** A look inside one floor; the host cuts it from its own scene with sceneViewInterior. */
export type SceneViewInterior = { levelId: string }

/** How high up its storey an interior view cuts a floor: low enough to see every room. */
const INTERIOR_CUT = 0.65
/** Degrees above the horizon an interior view looks down from, by default. */
const INTERIOR_ELEVATION = 55

/** A node and every node it stands under, nearest first. */
function ancestry(nodes: Readonly<Record<string, AnyNode>>, node: AnyNode): AnyNode[] {
  const chain: AnyNode[] = []
  for (let at: AnyNode | undefined = node; at && !chain.includes(at); at = nodes[at.parentId ?? ''])
    chain.push(at)
  return chain
}

/**
 * What an interior view of a floor shows, from the scene the host renders: the floor's box (its
 * walls' extent, its storey's height), the height its walls are cut at, and what the picture leaves
 * out, every other floor and this floor's roofs and ceilings. The live scene is never changed.
 */
export function sceneViewInterior(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
): { bounds: SceneViewBox; cutHeight: number; hiddenIds: string[] } {
  const level = nodes[levelId]
  if (level?.type !== 'level')
    refuse('interior_level_invalid', `An interior view needs a level id: ${levelId} is none.`, {
      levelId,
    })
  for (const node of ancestry(nodes, level)) {
    // A hidden site drops only its own ground and lot line: what stands on it still shows.
    if (node.visible === false && node.type !== 'site')
      refuse('interior_hidden', `${node.type} ${node.id} is hidden: show it to look inside.`, {
        target: node.id,
      })
    // The cut is level: a building tipped off the vertical has no floor to cut across.
    if (node.type === 'building' && (node.rotation[0] !== 0 || node.rotation[2] !== 0))
      refuse('interior_transform_unsupported', 'An interior view needs an upright building.', {
        target: node.id,
      })
  }
  const hiddenIds = Object.values(nodes)
    .filter((node) =>
      node.type === 'level'
        ? node.id !== levelId
        : (node.type === 'roof' || node.type === 'ceiling') &&
          ancestry(nodes, node).some((at) => at.id === levelId),
    )
    .map((node) => node.id)
  if (level.children.length && level.children.every((id) => hiddenIds.includes(id)))
    refuse(
      'interior_level_invalid',
      `${levelId} holds only roofs and ceilings, which an interior view leaves out: look inside the floor below it.`,
      { levelId },
    )
  const box = sceneViewBounds(nodes, levelId)
  const storey = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(levelId)
  const baseY = (storey?.baseY ?? 0) + standingOf(nodes, levelId).y
  const height = storey?.height ?? 3
  return {
    bounds: { min: [box.min[0], baseY, box.min[2]], max: [box.max[0], baseY + height, box.max[2]] },
    cutHeight: baseY + height * INTERIOR_CUT,
    hiddenIds,
  }
}

function cropOf(photo: SceneViewInput['photo']): SceneViewCrop | undefined {
  if (!photo) return undefined
  const [left, top, right, bottom] = photo.region.map(Math.round) as [
    number,
    number,
    number,
    number,
  ]
  if (!(right > left && bottom > top))
    refuse(
      'photo_region_invalid',
      `The region [${photo.region.join(', ')}] holds nothing: give [left, top, right, bottom] in the photo's pixels, right of left and below top.`,
      { region: photo.region },
    )
  return { source: photo.source, region: [left, top, right, bottom] }
}

export type SceneViewPose =
  | {
      projection: 'perspective'
      position: [number, number, number]
      target: [number, number, number]
      fov: number
    }
  | {
      projection: 'orthographic'
      position: [number, number, number]
      target: [number, number, number]
      viewWidth: number
    }

/** The picture's size: enough to read a facade's bays, few tokens. */
export const VIEW_SIZE = { w: 1280, h: 800 } as const
const ASPECT = VIEW_SIZE.w / VIEW_SIZE.h

/** A crop comes back at most this long on either host: the region as the photo has it, never larger than a view. */
export const PHOTO_CROP_LONGEST = VIEW_SIZE.w

/** A crop comes back at least this long, enlarged if smaller, so a small element's detail reads. */
export const PHOTO_CROP_SHORTEST_LONG_SIDE = 512

/** The size a crop of `width` × `height` pixels comes back at. */
export function photoCropSize(width: number, height: number) {
  const longest = Math.max(width, height)
  const scale =
    longest < PHOTO_CROP_SHORTEST_LONG_SIDE
      ? PHOTO_CROP_SHORTEST_LONG_SIDE / longest
      : Math.min(1, PHOTO_CROP_LONGEST / longest)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}
const DEFAULT_FOV = 45
const DEFAULT_ELEVATION = 12
const MARGIN = 1.08

type Pt = [number, number]
type V3 = [number, number, number]

/** In plan, x runs east and z south: north is the plan's top edge. */
const COMPASS: Record<Exclude<SceneViewSide, 'above'>, Pt> = {
  north: [0, -1],
  'north-east': [Math.SQRT1_2, -Math.SQRT1_2],
  east: [1, 0],
  'south-east': [Math.SQRT1_2, Math.SQRT1_2],
  south: [0, 1],
  'south-west': [-Math.SQRT1_2, Math.SQRT1_2],
  west: [-1, 0],
  'north-west': [-Math.SQRT1_2, -Math.SQRT1_2],
}

/**
 * What a view frames: the walls of the target (a building, a level, a wall) or a zone's outline,
 * each at its storey's height; every wall by default. Plan guides never count: an imported plan
 * is drawn much larger than its building.
 */
/** A door or a window and the wall it is in, when the target is one. */
function openingOf(nodes: Readonly<Record<string, AnyNode>>, target: AnyNode | undefined) {
  if (target?.type !== 'door' && target?.type !== 'window') return null
  const wall = nodes[target.wallId ?? target.parentId ?? '']
  return wall?.type === 'wall' && !target.roofSegmentId ? { opening: target, wall } : null
}

/**
 * An opening's box, at detail scale: along its wall, centred at its height on the storey,
 * as deep as the wall.
 */
function openingBox(
  {
    opening,
    wall,
  }: { opening: AnyNode & { position: number[]; width: number; height: number }; wall: WallNode },
  baseY: number,
): SceneViewBox {
  const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const length = Math.hypot(dx, dz) || 1
  const [ux, uz] = [dx / length, dz / length]
  const [nx, nz] = [-uz, ux]
  const along = opening.position[0]!
  const [cx, cz] = [wall.start[0] + ux * along, wall.start[1] + uz * along]
  const [half, depth] = [opening.width / 2, (wall.thickness ?? 0.2) / 2]
  const xs = [-1, 1].flatMap((a) => [-1, 1].map((n) => cx + ux * half * a + nx * depth * n))
  const zs = [-1, 1].flatMap((a) => [-1, 1].map((n) => cz + uz * half * a + nz * depth * n))
  const y = baseY + opening.position[1]!
  return {
    min: [Math.min(...xs), y - opening.height / 2, Math.min(...zs)],
    max: [Math.max(...xs), y + opening.height / 2, Math.max(...zs)],
  }
}

/** An item standing on a floor, by its asset's dimensions and its turn. */
function itemBox(item: ItemNode, baseY: number): SceneViewBox {
  const [w, h, d] = item.asset.dimensions
  const turn = item.rotation?.[1] ?? 0
  const [c, s] = [Math.abs(Math.cos(turn)), Math.abs(Math.sin(turn))]
  const [hx, hz] = [(w * c + d * s) / 2, (w * s + d * c) / 2]
  const [x, y, z] = item.position
  return { min: [x - hx, baseY + y, z - hz], max: [x + hx, baseY + y + h, z + hz] }
}

/**
 * Where an item stands in its level's frame, through the host place_items gave it: on a level as
 * placed; on a wall along it and off its face (the wall's local +z is its left); under a ceiling at
 * the ceiling's height (its x and z are the level's); on another item in that item's turned frame.
 */
function itemLevelPose(
  nodes: Readonly<Record<string, AnyNode>>,
  item: ItemNode,
  storeyHeight: (levelId: string) => number,
): { x: number; y: number; z: number; yaw: number; levelId: string } | null {
  const parent = nodes[item.parentId ?? '']
  const [px, py, pz] = item.position
  const yaw = item.rotation?.[1] ?? 0
  if (parent?.type === 'level') return { x: px, y: py, z: pz, yaw, levelId: parent.id }
  if (parent?.type === 'wall') {
    const [dx, dz] = [parent.end[0] - parent.start[0], parent.end[1] - parent.start[1]]
    const length = Math.hypot(dx, dz) || 1
    const [ux, uz] = [dx / length, dz / length]
    return {
      x: parent.start[0] + ux * px - uz * pz,
      y: py,
      z: parent.start[1] + uz * px + ux * pz,
      yaw,
      levelId: parent.parentId ?? '',
    }
  }
  if (parent?.type === 'ceiling') {
    const levelId = parent.parentId ?? ''
    return { x: px, y: (parent.height ?? storeyHeight(levelId)) + py, z: pz, yaw, levelId }
  }
  if (parent?.type === 'item') {
    const host = itemLevelPose(nodes, parent, storeyHeight)
    if (!host) return null
    const [c, s] = [Math.cos(host.yaw), Math.sin(host.yaw)]
    return {
      x: host.x + c * px + s * pz,
      y: host.y + py,
      z: host.z - s * px + c * pz,
      yaw: host.yaw + yaw,
      levelId: host.levelId,
    }
  }
  return null
}

/** A hosted item's box: its footprint squared (any turn), its height from where it rests. */
function hostedItemBox(
  item: ItemNode,
  pose: { x: number; y: number; z: number },
  baseY: number,
): SceneViewBox {
  const [w, h, d] = item.asset.dimensions
  const half = Math.max(w, d) / 2
  return {
    min: [pose.x - half, baseY + pose.y, pose.z - half],
    max: [pose.x + half, baseY + pose.y + h, pose.z + half],
  }
}

/** A box of at least `least` metres tall, so a flat element still frames. */
const tall = (box: SceneViewBox, least: number): SceneViewBox =>
  box.max[1] - box.min[1] >= least
    ? box
    : { min: box.min, max: [box.max[0], box.min[1] + least, box.max[2]] }

/**
 * A site element's box, at detail scale (view_scene once could not look at the steps an agent
 * built): a column round its position, a fence along its run, a slab over its outline, a stair
 * round its foot as far as it could reach.
 */
function siteBox(node: AnyNode, baseY: number): SceneViewBox | null {
  if (node.type === 'column') {
    const column = node as ColumnNode
    const half =
      column.crossSection === 'round' ? column.radius : Math.max(column.width, column.depth) / 2
    const [x, , z] = column.position
    return { min: [x - half, baseY, z - half], max: [x + half, baseY + column.height, z + half] }
  }
  if (node.type === 'fence') {
    const fence = node as FenceNode
    const points = [fence.start, fence.end, ...(fence.path ?? [])]
    const half = fence.thickness / 2
    return {
      min: [
        Math.min(...points.map((p) => p[0])) - half,
        baseY,
        Math.min(...points.map((p) => p[1])) - half,
      ],
      max: [
        Math.max(...points.map((p) => p[0])) + half,
        baseY + fence.height,
        Math.max(...points.map((p) => p[1])) + half,
      ],
    }
  }
  if (node.type === 'slab') {
    const polygon = (node as SlabNode).polygon as [number, number][]
    const top = baseY + ((node as SlabNode).elevation ?? 0)
    return tall(
      {
        min: [Math.min(...polygon.map((p) => p[0])), top, Math.min(...polygon.map((p) => p[1]))],
        max: [Math.max(...polygon.map((p) => p[0])), top, Math.max(...polygon.map((p) => p[1]))],
      },
      0.3,
    )
  }
  if (node.type === 'stair') {
    const stair = node as StairNode
    const rise = stair.totalRise ?? 1
    const reach = Math.max(stair.width ?? 1, (rise / 0.17) * 0.28)
    const [x, , z] = stair.position
    return {
      min: [x - reach, baseY, z - reach],
      max: [x + reach, baseY + Math.max(rise, 0.3), z + reach],
    }
  }
  return null
}

/**
 * A roof's box: its segments' footprints in the plan, from the roof's seat to the highest peak. A
 * roof holds no wall, so a roof, or the roof level it stands on, framed nothing.
 */
function roofBox(
  nodes: Readonly<Record<string, AnyNode>>,
  roof: RoofNode,
  baseY: number,
): SceneViewBox | null {
  const seat = baseY + roof.position[1]
  const turn = ([x, z]: Pt, angle: number): Pt => [
    x * Math.cos(angle) - z * Math.sin(angle),
    x * Math.sin(angle) + z * Math.cos(angle),
  ]
  const points: Pt[] = []
  let peak = seat
  for (const id of roof.children ?? []) {
    const segment = nodes[id]
    if (segment?.type !== 'roof-segment') continue
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      // The segment's corner in the roof, then the roof's in the plan: the inverse of the turns
      // the roof's geometry reads a plan point with.
      const [cx, cz] = turn([(sx * segment.width) / 2, (sz * segment.depth) / 2], -segment.rotation)
      const [px, pz] = turn([cx + segment.position[0], cz + segment.position[2]], -roof.rotation)
      points.push([px + roof.position[0], pz + roof.position[2]])
    }
    peak = Math.max(
      peak,
      seat + segment.position[1] + segment.wallHeight + getActiveRoofHeight(segment),
    )
  }
  if (!points.length) return null
  return tall(
    {
      min: [Math.min(...points.map((p) => p[0])), seat, Math.min(...points.map((p) => p[1]))],
      max: [Math.max(...points.map((p) => p[0])), peak, Math.max(...points.map((p) => p[1]))],
    },
    0.3,
  )
}

/** What frames a node standing on a level: a site element, or a roof. */
function levelChildBox(
  nodes: Readonly<Record<string, AnyNode>>,
  node: AnyNode,
  baseY: number,
): SceneViewBox | null {
  return node.type === 'roof' ? roofBox(nodes, node as RoofNode, baseY) : siteBox(node, baseY)
}

/**
 * The side an opening is seen from by default: its outside, when its wall knows it; else the
 * side it faces.
 */
function outsideSide(
  opening: AnyNode & { rotation?: number[] },
  wall: WallNode,
  yaw: number,
): SceneViewSide {
  const [nx, nz] = outwardOf(opening, wall, yaw)
  return (Object.keys(COMPASS) as (keyof typeof COMPASS)[]).reduce((best, side) =>
    COMPASS[side][0] * nx + COMPASS[side][1] * nz > COMPASS[best][0] * nx + COMPASS[best][1] * nz
      ? side
      : best,
  )
}

/**
 * The way an opening's wall faces outward, a unit vector in the site's plan (x, z), turned with
 * its building. The wall's +normal is perp(end - start) = (-dz, dx).
 */
function outwardOf(opening: AnyNode & { rotation?: number[] }, wall: WallNode, yaw: number): Pt {
  const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const facing = Math.abs(opening.rotation?.[1] ?? 0) > Math.PI / 2 ? -1 : 1
  const sign = resolveWallExteriorSide(wall) ?? facing
  const length = Math.hypot(dx, dz) || 1
  const [ux, uz] = [(-dz * sign) / length, (dx * sign) / length]
  // `+ 0` so a vector along an axis reads 0, not -0.
  return [ux * Math.cos(yaw) + uz * Math.sin(yaw) + 0, -ux * Math.sin(yaw) + uz * Math.cos(yaw) + 0]
}

/**
 * Where a building stands on its site. What is under a building (levels, walls, openings, roofs)
 * is drawn in the building's own frame, which the editor puts at the building's position and yaw:
 * a view planned in that frame alone looks at the site's origin, not at the building.
 */
type Standing = { x: number; y: number; z: number; yaw: number }
const AT_ORIGIN: Standing = { x: 0, y: 0, z: 0, yaw: 0 }

function standingOf(nodes: Readonly<Record<string, AnyNode>>, levelId?: string | null): Standing {
  const level = levelId ? nodes[levelId] : undefined
  const building = level?.type === 'level' ? nodes[level.parentId ?? ''] : undefined
  if (building?.type !== 'building') return AT_ORIGIN
  const [x, y, z] = building.position
  return { x, y, z, yaw: building.rotation[1] ?? 0 }
}

/** A plan point of the building's frame, on the site: turned about the building's origin, then moved. */
const onSite = ([px, pz]: Pt, at: Standing): Pt => [
  at.x + px * Math.cos(at.yaw) + pz * Math.sin(at.yaw),
  at.z - px * Math.sin(at.yaw) + pz * Math.cos(at.yaw),
]

/** A box of the building's frame, on the site: the box of its turned corners. */
function placedBox(box: SceneViewBox, at: Standing): SceneViewBox {
  if (at === AT_ORIGIN) return box
  const corners = (
    [
      [box.min[0], box.min[2]],
      [box.max[0], box.min[2]],
      [box.max[0], box.max[2]],
      [box.min[0], box.max[2]],
    ] as Pt[]
  ).map((corner) => onSite(corner, at))
  return {
    min: [
      Math.min(...corners.map((c) => c[0])),
      box.min[1] + at.y,
      Math.min(...corners.map((c) => c[1])),
    ],
    max: [
      Math.max(...corners.map((c) => c[0])),
      box.max[1] + at.y,
      Math.max(...corners.map((c) => c[1])),
    ],
  }
}

export function sceneViewBounds(
  nodes: Readonly<Record<string, AnyNode>>,
  targetId?: string,
): SceneViewBox {
  const target = targetId ? nodes[targetId] : undefined
  if (targetId && !target)
    refuse('target_not_found', `Nothing to look at: ${targetId} is not in the scene.`, {
      target: targetId,
    })
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const baseOf = (levelId: string | null | undefined) =>
    (levelId ? elevations.get(levelId)?.baseY : undefined) ?? 0
  const placed = (box: SceneViewBox, levelId: string | null | undefined) =>
    placedBox(box, standingOf(nodes, levelId))
  const opening = openingOf(nodes, target)
  if (opening)
    return placed(
      openingBox(opening as never, baseOf(opening.wall.parentId)),
      opening.wall.parentId,
    )
  if (target?.type === 'item' && nodes[target.parentId ?? '']?.type === 'level')
    return placed(itemBox(target, baseOf(target.parentId)), target.parentId)
  if (target?.type === 'item') {
    const pose = itemLevelPose(nodes, target, (id) => elevations.get(id)?.height ?? 2.5)
    if (pose) return placed(hostedItemBox(target, pose, baseOf(pose.levelId)), pose.levelId)
  }
  const site =
    target && nodes[target.parentId ?? '']?.type === 'level'
      ? levelChildBox(nodes, target, baseOf(target.parentId))
      : null
  if (site) return placed(site, target!.parentId)
  const levelOf = (node: AnyNode) => (node.parentId ? nodes[node.parentId] : undefined)
  const outlines: { points: Pt[]; levelId: string }[] = []
  // With no walls yet, what the level holds frames it: furniture placed from a plan before the
  // walls are built, a site with its paving and fences.
  const held: SceneViewBox[] = []
  for (const node of Object.values(nodes)) {
    const level = levelOf(node)
    if (level?.type !== 'level') continue
    const inTarget =
      !target ||
      target.id === node.id ||
      target.id === level.id ||
      (target.type === 'building' && level.parentId === target.id)
    if (!inTarget) continue
    const at = standingOf(nodes, level.id)
    if (node.type === 'wall')
      outlines.push({
        points: [node.start, node.end].map((point) => onSite(point as Pt, at)),
        levelId: level.id,
      })
    else if (node.type === 'zone' && target?.id === node.id)
      outlines.push({
        points: (node.polygon as Pt[]).map((point) => onSite(point, at)),
        levelId: level.id,
      })
    else if (node.type === 'item') held.push(placedBox(itemBox(node, baseOf(level.id)), at))
    else {
      const box = levelChildBox(nodes, node, baseOf(level.id))
      if (box) held.push(placedBox(box, at))
    }
  }
  if (!outlines.length && held.length)
    return {
      min: [0, 1, 2].map((axis) => Math.min(...held.map((box) => box.min[axis]!))) as V3,
      max: [0, 1, 2].map((axis) => Math.max(...held.map((box) => box.max[axis]!))) as V3,
    }
  if (!outlines.length)
    refuse(
      'nothing_to_view',
      target
        ? `${target.type} ${target.id} holds nothing built to look at: give a building, a level, a wall, a zone or what was placed.`
        : 'The scene has nothing built yet.',
      targetId ? { target: targetId } : {},
    )
  const min: V3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max: V3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const { points, levelId } of outlines) {
    const storey = elevations.get(levelId) ?? { baseY: 0, height: 3 }
    const lift = standingOf(nodes, levelId).y
    min[1] = Math.min(min[1], storey.baseY + lift)
    max[1] = Math.max(max[1], storey.baseY + storey.height + lift)
    for (const [x, z] of points) {
      min[0] = Math.min(min[0], x)
      max[0] = Math.max(max[0], x)
      min[2] = Math.min(min[2], z)
      max[2] = Math.max(max[2], z)
    }
  }
  return { min, max }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: V3): V3 => {
  const length = Math.hypot(...a) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}
const round = (value: number) => Math.round(value * 100) / 100

/**
 * Where the eye stands: on the side asked (south-west by default), a few degrees up, far enough
 * that the whole target is in frame; or at a street-level height; or exactly where it is put.
 * The orthographic view looks square on and is as wide as the target seen from there.
 */
export function sceneViewPose(box: SceneViewBox, input: SceneViewInput): SceneViewPose {
  const centre: V3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ]
  const radius = Math.hypot(...sub(box.max, box.min)) / 2 || 1
  const side = input.from ?? 'south-west'
  const elevation =
    ((side === 'above' ? 89 : (input.elevation ?? DEFAULT_ELEVATION)) * Math.PI) / 180
  const [dx, dz] = side === 'above' ? COMPASS.south : COMPASS[side]
  const direction: V3 = [Math.cos(elevation) * dx, Math.sin(elevation), Math.cos(elevation) * dz]
  const corners: V3[] = []
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) corners.push([x, y, z])
  const placed = input.position as V3 | undefined

  if (input.projection === 'orthographic') {
    const position: V3 = placed ?? [
      centre[0] + direction[0] * radius * 4,
      centre[1] + direction[1] * radius * 4,
      centre[2] + direction[2] * radius * 4,
    ]
    const forward = unit(sub(centre, position))
    const right = unit(cross(forward, [0, 1, 0]))
    const up = cross(right, forward)
    let halfWidth = 0
    let halfHeight = 0
    for (const corner of corners) {
      const offset = sub(corner, centre)
      halfWidth = Math.max(halfWidth, Math.abs(dot(offset, right)))
      halfHeight = Math.max(halfHeight, Math.abs(dot(offset, up)))
    }
    return {
      projection: 'orthographic',
      position: position.map(round) as V3,
      target: centre,
      viewWidth: round(Math.max(halfWidth * 2, halfHeight * 2 * ASPECT) * MARGIN + 0.01),
    }
  }

  const fov = input.fov ?? DEFAULT_FOV
  if (placed) return { projection: 'perspective', position: placed, target: centre, fov }
  const vertical = (fov * Math.PI) / 180
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * ASPECT)
  const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * MARGIN
  const position: V3 =
    input.eyeHeight === undefined
      ? [
          centre[0] + direction[0] * distance,
          centre[1] + direction[1] * distance,
          centre[2] + direction[2] * distance,
        ]
      : [centre[0] + dx * distance, input.eyeHeight, centre[2] + dz * distance]
  return {
    projection: 'perspective',
    position: (input.eyeHeight === undefined
      ? position.map(round)
      : [round(position[0]), input.eyeHeight, round(position[2])]) as V3,
    target: centre,
    fov,
  }
}

/**
 * The view to render and its size: from a photo's camera at the photo's aspect, so the two lay
 * one beside the other; else framing the target at the standard size.
 */
/** What a view comes with, on both surfaces: a picture to compare, not a measure. */
export function sceneViewNote() {
  return 'A picture to compare with the reference, not a measure: take sizes and counts from the tools.'
}

export function sceneViewPlan(
  nodes: Readonly<Record<string, AnyNode>>,
  input: SceneViewInput,
): {
  pose: SceneViewPose
  size: { w: number; h: number }
  crop?: SceneViewCrop
  interior?: SceneViewInterior
} {
  const { camera } = input
  const crop = cropOf(input.photo)
  const inside = input.interior && sceneViewInterior(nodes, input.interior.levelId)
  const interior = input.interior && { levelId: input.interior.levelId }
  const target = input.target ? nodes[input.target] : undefined
  // An interior view shows this floor alone, without its roofs and ceilings: a target left out of
  // the picture would frame nothing shown.
  if (interior && inside && target) {
    const chain = ancestry(nodes, target)
    const left = chain.find((node) => inside.hiddenIds.includes(node.id))
    if (left || !chain.some((node) => node.id === interior.levelId))
      refuse(
        'interior_target_elsewhere',
        left && left.type !== 'level'
          ? `${target.type} ${target.id} is left out of an interior view, as the floor's roofs and ceilings are: target something on the floor you look inside.`
          : `${target.type} ${target.id} is not on ${interior.levelId}: target something on the floor you look inside.`,
        { target: target.id, levelId: interior.levelId },
      )
  }
  if (camera) {
    const own = (
      ['from', 'position', 'elevation', 'eyeHeight', 'fov', 'projection'] as const
    ).filter((key) => input[key] !== undefined)
    if (own.length)
      refuse(
        'camera_and_viewpoint',
        `Give the photo's camera or a viewpoint of your own, not both (${own.join(', ')}).`,
        { fields: own },
      )
    return {
      pose: {
        projection: 'perspective',
        position: camera.position as V3,
        target: camera.target as V3,
        fov: camera.fov,
      },
      size: { w: VIEW_SIZE.w, h: Math.round(VIEW_SIZE.w / camera.aspect) },
      ...(crop ? { crop } : {}),
      ...(interior ? { interior } : {}),
    }
  }
  const opening = openingOf(nodes, target)
  const from =
    input.from ??
    (opening && !input.position
      ? outsideSide(opening.opening, opening.wall, standingOf(nodes, opening.wall.parentId).yaw)
      : undefined)
  // Inside a floor, the eye looks down into it over the cut walls.
  const lookDown = inside && input.elevation === undefined && input.eyeHeight === undefined
  return {
    pose: sceneViewPose(
      input.target || !inside ? sceneViewBounds(nodes, input.target) : inside.bounds,
      {
        ...input,
        ...(lookDown ? { elevation: INTERIOR_ELEVATION } : {}),
        ...(from ? { from } : {}),
      },
    ),
    size: { ...VIEW_SIZE },
    ...(crop ? { crop } : {}),
    ...(interior ? { interior } : {}),
  }
}
