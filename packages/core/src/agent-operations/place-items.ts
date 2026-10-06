import { refuse } from '../agent-tools/refusal'
import {
  flushMountRotation,
  geometrySurfaceAt,
  geometryUndersideAt,
  mountsFlush,
} from '../lib/geometry-surfaces'
import { type AnyNode, type AssetInput, ItemNode, type WallNode } from '../schema'
import { getWallLocalFaceZ } from '../systems/wall/wall-frame'
import { type LevelTargetInput, targetLevel } from './level-target'
import {
  pointInPolygon,
  projectWorldPointToWallLocalX,
  type Vec2,
  wallLength,
} from './plan-geometry'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

type Entry = {
  assetId: string
  x: number
  z: number
  y?: number
  rotation?: number
  targetNodeId?: string
}
type PlaceItemsInput = LevelTargetInput & { items: Entry[] }

type Placed =
  | {
      ok: true
      itemId: string
      assetId: string
      name: string
      x: number
      z: number
      hostId?: string
      side?: 'front' | 'back'
      /** The authored host's part it came to rest on, or hangs from. */
      restingOn?: string
    }
  | { ok: false; assetId: string; code: string; error: string }

/**
 * What belongs on the lot rather than in a room. Anything else placed outside every room of a
 * level that has rooms is refused: in production a model that had fallen back to raw place_items
 * put a bed on the lawn (2026-09-04).
 */
const OUTDOOR_ASSET =
  /tree|plant|shrub|bush|hedge|flower|palm|\bfir\b|bench|grill|bbq|barbecue|\bcar\b|vehicle|truck|bike|bicycle|pool|fence|gate|lamp ?post|street|outdoor|garden|patio|deck|swing|trampoline|planter|mailbox|umbrella|parasol/i

const isOutdoor = (asset: AssetInput) =>
  OUTDOOR_ASSET.test(`${asset.name} ${asset.category ?? ''} ${(asset.tags ?? []).join(' ')}`)

function roomsOn(nodes: SceneNodes, levelId: string): Vec2[][] {
  return Object.values(nodes).flatMap((node) =>
    node.type === 'zone' && node.parentId === levelId && node.polygon.length >= 3
      ? [node.polygon as Vec2[]]
      : [],
  )
}

const refused = (assetId: string, code: string, error: string): Placed => ({
  ok: false,
  assetId,
  code,
  error,
})

/** Where an item goes on its host, in the host's frame, as the editor's placement puts it there. */
type Pose = {
  parentId: string
  position: [number, number, number]
  rotation: [number, number, number]
  extra?: Partial<ItemNode>
  side?: 'front' | 'back'
  restingOn?: string
}

/**
 * On a wall: along it from its start, the height given for the item's bottom, on the side of the
 * wall the point is on (the front faces the wall's left, the back is turned round), centred in the
 * wall or, for a wall-side fixture, on its face. Kept inside the wall's span and height, as the
 * editor's wall placement keeps it.
 */
function onWall(wall: WallNode, entry: Entry, asset: AssetInput): Pose | Placed {
  const [width = 0, height = 0] = asset.dimensions ?? [1, 1, 1]
  const wallHeight = wall.height ?? 2.5
  if (entry.y === undefined)
    return refused(
      entry.assetId,
      'height_required',
      `On wall ${wall.id}, give y: the height of the item's bottom above the floor (its top, y + ${height.toFixed(2)} m, must stay under the wall's ${wallHeight.toFixed(2)} m). Art centred at eye level is 1.5 − its height / 2; a sconce about 1.5.`,
    )
  if (height > wallHeight)
    return refused(
      entry.assetId,
      'item_too_tall',
      `"${asset.name}" is ${height.toFixed(2)} m tall; wall ${wall.id} is ${wallHeight.toFixed(2)} m. Pick a shorter item or a taller wall.`,
    )
  const length = wallLength(wall)
  const along = projectWorldPointToWallLocalX(wall, [entry.x, 0, entry.z])
  const x = Math.max(width / 2, Math.min(length - width / 2, along))
  const y = Math.max(0, Math.min(wallHeight - height, entry.y))
  const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  // The wall's left (its local +z) is its front.
  const left = -dz * (entry.x - wall.start[0]) + dx * (entry.z - wall.start[1]) >= 0
  const side = left ? 'front' : 'back'
  const z = asset.attachTo === 'wall-side' ? getWallLocalFaceZ(wall, left ? 'a' : 'b') : 0
  const turn = (left ? 0 : Math.PI) + ((entry.rotation ?? 0) * Math.PI) / 180
  return {
    parentId: wall.id,
    position: [x, y, z],
    rotation: [0, turn, 0],
    extra: { wallId: wall.id, wallT: length ? x / length : 0, side },
    side,
  }
}

/**
 * On an item standing on the floor: in its frame (translation, turn, scale). An object built with
 * add_object takes the item on its real surface under the point, or hangs a ceiling item from its
 * underside above it; a catalog item, on its top. A height given (y above 0) is kept.
 */
function onItem(host: ItemNode, entry: Entry, asset: AssetInput): Pose {
  const [hx, hy, hz] = host.position
  const yaw = host.rotation[1] ?? 0
  const [dx, dz] = [entry.x - hx, entry.z - hz]
  const lx = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / host.scale[0]
  const lz = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / host.scale[2]
  const turn = ((entry.rotation ?? 0) * Math.PI) / 180 - yaw
  const hanging = asset.attachTo === 'ceiling' && !!host.source
  const surface = host.source
    ? hanging
      ? geometryUndersideAt(host.source.manifest, lx, lz)
      : geometrySurfaceAt(host.source.manifest, lx, lz)
    : null
  const explicit = !hanging && entry.y !== undefined && entry.y > 0
  const flush = hanging && mountsFlush(asset)
  const drop = hanging ? (flush ? 0.02 : (asset.dimensions?.[1] ?? 0)) : 0
  const y = explicit
    ? entry.y! - hy
    : surface
      ? surface.y * host.scale[1] - drop
      : (host.asset.surface?.height ?? host.asset.dimensions[1]) * host.scale[1]
  return {
    parentId: host.id,
    position: [lx * host.scale[0], y, lz * host.scale[2]],
    // A flush fixture tilts with a sloped underside (a can in a vault plane).
    rotation:
      flush && surface && 'normal' in surface
        ? flushMountRotation(surface.normal, turn)
        : [0, turn, 0],
    ...(!explicit && surface?.part ? { restingOn: surface.part } : {}),
  }
}

/**
 * `place_items`: catalog items on a level's floor, or on the host each names (a wall, a ceiling,
 * an item standing on the floor), each placed or refused on its own.
 */
export const placeItems: AgentOperation<PlaceItemsInput> = (nodes, input, context) => {
  const catalog = context.catalog
  if (!catalog)
    refuse('no_catalog', 'This host has no item library to place from; build it with add_object.')
  const level = targetLevel(nodes, input, context)
  const create: NonNullable<SceneChanges['create']> = []
  const make = (asset: AssetInput, pose: Pose) => {
    const node = ItemNode.parse({
      name: asset.name,
      parentId: pose.parentId,
      position: pose.position,
      rotation: pose.rotation,
      asset,
      ...pose.extra,
    })
    create.push({ node, parentId: pose.parentId })
    return node
  }

  const items = input.items.map((entry): Placed => {
    const { assetId, x, z, rotation = 0, targetNodeId } = entry
    const asset = catalog.find((candidate) => candidate.id === assetId)
    if (!asset)
      return refused(
        assetId,
        'asset_not_found',
        `Asset "${assetId}" is not in the library. Find a valid id with search_assets.`,
      )
    const host = targetNodeId ? (nodes[targetNodeId] as AnyNode | undefined) : undefined
    if (targetNodeId && !host)
      return refused(assetId, 'host_not_found', `Host not found: ${targetNodeId}.`)

    if (host?.type === 'wall' || host?.type === 'ceiling' || host?.type === 'item') {
      let pose: Pose | Placed
      if (host.type === 'wall') pose = onWall(host, entry, asset)
      else if (host.type === 'ceiling')
        // Under its underside, its top flush with it.
        pose = {
          parentId: host.id,
          position: [x, -(asset.dimensions?.[1] ?? 0), z],
          rotation: [0, (rotation * Math.PI) / 180, 0],
        }
      else {
        if (nodes[host.parentId ?? '']?.type !== 'level')
          return refused(
            assetId,
            'host_not_on_level',
            `${host.name ?? host.id} rests on ${host.parentId}: only an item standing on a floor hosts another here.`,
          )
        pose = onItem(host, entry, asset)
      }
      if ('ok' in pose) return pose
      const node = make(asset, pose)
      return {
        ok: true,
        itemId: node.id,
        assetId,
        name: asset.name,
        x,
        z,
        hostId: host.id,
        ...(pose.side ? { side: pose.side } : {}),
        ...(pose.restingOn ? { restingOn: pose.restingOn } : {}),
      }
    }

    // A floor: the level named, or the level holding the room or slab named.
    const floorId = !host
      ? level.id
      : host.type === 'level'
        ? host.id
        : host.type === 'zone' || host.type === 'slab'
          ? (host.parentId ?? '')
          : null
    if (!floorId || nodes[floorId]?.type !== 'level')
      return refused(
        assetId,
        'unsupported_host',
        `A ${host?.type} hosts no item: name a wall, a ceiling, an item standing on the floor, or a room, slab or level for its floor.`,
      )
    const rooms = roomsOn(nodes, floorId)
    if (rooms.length && !isOutdoor(asset) && !rooms.some((room) => pointInPolygon([x, z], room)))
      return refused(
        assetId,
        'outside_rooms',
        `"${asset.name}" at (${x}, ${z}) is outside every room on this level: indoor items go inside a room (read the rooms with get_zones); trees and garden items may stand outside.`,
      )
    const node = make(asset, {
      parentId: floorId,
      position: [x, 0, z],
      rotation: [0, (rotation * Math.PI) / 180, 0],
    })
    return {
      ok: true,
      itemId: node.id,
      assetId,
      name: asset.name,
      x,
      z,
      ...(host ? { hostId: floorId } : {}),
    }
  })
  const failed = items.length - create.length
  return {
    result: {
      ok: failed === 0,
      levelId: level.id,
      items,
      message: failed
        ? `Placed ${create.length} of ${items.length} items (${failed} refused).`
        : `Placed ${create.length} item${create.length === 1 ? '' : 's'}.`,
    },
    ...(create.length ? { changes: { create } } : {}),
  }
}
