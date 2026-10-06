import { refuse } from '../agent-tools/refusal'
import type { VIEW_SIDES } from '../agent-tools/view-scene'
import type { AnyNode, AnyNodeId, ItemNode, WallNode } from '../schema'
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
  from?: SceneViewSide
  position?: number[]
  elevation?: number
  eyeHeight?: number
  fov?: number
  projection?: 'perspective' | 'orthographic'
  camera?: { position: number[]; target: number[]; fov: number; aspect: number }
  photo?: { source: string; region: number[] }
}

/** A region of the reference photo the host crops and returns beside the view (L51). */
export type SceneViewCrop = { source: string; region: [number, number, number, number] }

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
 * An opening's box, at detail scale (L51): along its wall, centred at its height on the storey,
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
 * The side an opening is seen from by default: its outside, when its wall knows it; else the
 * side it faces. Its wall's +normal is perp(end - start) = (-dz, dx).
 */
function outsideSide(opening: AnyNode & { rotation?: number[] }, wall: WallNode): SceneViewSide {
  const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const facing = Math.abs(opening.rotation?.[1] ?? 0) > Math.PI / 2 ? -1 : 1
  const sign = resolveWallExteriorSide(wall) ?? facing
  const [nx, nz] = [-dz * sign, dx * sign]
  return (Object.keys(COMPASS) as (keyof typeof COMPASS)[]).reduce((best, side) =>
    COMPASS[side][0] * nx + COMPASS[side][1] * nz > COMPASS[best][0] * nx + COMPASS[best][1] * nz
      ? side
      : best,
  )
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
  const opening = openingOf(nodes, target)
  if (opening) return openingBox(opening as never, baseOf(opening.wall.parentId))
  if (target?.type === 'item' && nodes[target.parentId ?? '']?.type === 'level')
    return itemBox(target, baseOf(target.parentId))
  const levelOf = (node: AnyNode) => (node.parentId ? nodes[node.parentId] : undefined)
  const outlines: { points: Pt[]; levelId: string }[] = []
  for (const node of Object.values(nodes)) {
    const level = levelOf(node)
    if (level?.type !== 'level') continue
    const inTarget =
      !target ||
      target.id === node.id ||
      target.id === level.id ||
      (target.type === 'building' && level.parentId === target.id)
    if (!inTarget) continue
    if (node.type === 'wall') outlines.push({ points: [node.start, node.end], levelId: level.id })
    else if (node.type === 'zone' && target?.id === node.id)
      outlines.push({ points: node.polygon as Pt[], levelId: level.id })
  }
  if (!outlines.length)
    refuse(
      'nothing_to_view',
      target
        ? `${target.type} ${target.id} has no walls to look at: give a building, a level, a wall or a zone.`
        : 'The scene has no walls yet.',
      targetId ? { target: targetId } : {},
    )
  const min: V3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max: V3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const { points, levelId } of outlines) {
    const storey = elevations.get(levelId) ?? { baseY: 0, height: 3 }
    min[1] = Math.min(min[1], storey.baseY)
    max[1] = Math.max(max[1], storey.baseY + storey.height)
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
): { pose: SceneViewPose; size: { w: number; h: number }; crop?: SceneViewCrop } {
  const { camera } = input
  const crop = cropOf(input.photo)
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
    }
  }
  const opening = openingOf(nodes, input.target ? nodes[input.target] : undefined)
  const from =
    input.from ??
    (opening && !input.position ? outsideSide(opening.opening, opening.wall) : undefined)
  return {
    pose: sceneViewPose(sceneViewBounds(nodes, input.target), {
      ...input,
      ...(from ? { from } : {}),
    }),
    size: { ...VIEW_SIZE },
    ...(crop ? { crop } : {}),
  }
}
