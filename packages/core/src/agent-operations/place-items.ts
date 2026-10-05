import { refuse } from '../agent-tools/refusal'
import { type AssetInput, ItemNode } from '../schema'
import { type LevelTargetInput, targetLevel } from './level-target'
import { pointInPolygon, type Vec2 } from './plan-geometry'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

type PlaceItemsInput = LevelTargetInput & {
  items: { assetId: string; x: number; z: number; rotation?: number }[]
}

type Placed =
  | { ok: true; itemId: string; assetId: string; name: string; x: number; z: number }
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

/** `place_items`: catalog items on a level's floor, each placed or refused on its own. */
export const placeItems: AgentOperation<PlaceItemsInput> = (nodes, input, context) => {
  const catalog = context.catalog
  if (!catalog)
    refuse('no_catalog', 'This host has no item library to place from; build it with add_object.')
  const level = targetLevel(nodes, input, context)
  const rooms = roomsOn(nodes, level.id)
  const create: NonNullable<SceneChanges['create']> = []
  const items = input.items.map(({ assetId, x, z, rotation = 0 }): Placed => {
    const asset = catalog.find((entry) => entry.id === assetId)
    if (!asset)
      return {
        ok: false,
        assetId,
        code: 'asset_not_found',
        error: `Asset "${assetId}" is not in the library. Find a valid id with search_assets.`,
      }
    if (rooms.length && !isOutdoor(asset) && !rooms.some((room) => pointInPolygon([x, z], room)))
      return {
        ok: false,
        assetId,
        code: 'outside_rooms',
        error: `"${asset.name}" at (${x}, ${z}) is outside every room on this level: indoor items go inside a room (read the rooms with get_zones); trees and garden items may stand outside.`,
      }
    const node = ItemNode.parse({
      name: asset.name,
      parentId: level.id,
      position: [x, 0, z],
      rotation: [0, (rotation * Math.PI) / 180, 0],
      asset,
    })
    create.push({ node, parentId: level.id })
    return { ok: true, itemId: node.id, assetId, name: asset.name, x, z }
  })
  const refused = items.length - create.length
  return {
    result: {
      ok: refused === 0,
      levelId: level.id,
      items,
      message: refused
        ? `Placed ${create.length} of ${items.length} items (${refused} refused).`
        : `Placed ${create.length} item${create.length === 1 ? '' : 's'}.`,
    },
    ...(create.length ? { changes: { create } } : {}),
  }
}
