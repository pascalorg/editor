import { resolveLevelId } from '../lib/node-ancestry'
import type { ItemNode, WallNode, ZoneNode } from '../schema'
import { isBuildingElementItem } from '../spatial/usage-field/pieces'
import { getWallZoneSpans } from '../systems/wall/wall-finish'
import type { RoomCheckIssue } from './room-checks'
import { queryNodes } from './scene-queries'
import type { SceneNodes } from './types'

const quote = (name: string) => `“${name}”`
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The words an item carries that can name its room: its name, its asset, and every text of its metadata (the reason it was placed, the feature it serves). */
function textOf(item: ItemNode): string {
  const metadata = Object.values(item.metadata ?? {}).filter(
    (value): value is string => typeof value === 'string',
  )
  return [item.name, item.asset?.name, ...metadata].filter(Boolean).join(' | ')
}

const mentions = (text: string, name: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(name.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(text)

/**
 * A piece hung on a wall (art, a mirror, a shelf, a screen, a curtain) is on one face of it, and a face
 * looks into one room, or the outside. When the item's name, asset or the reason it was placed names the
 * room on the other face of its wall, and not the one its own face looks into (or the outside), it is on
 * the wrong side: the finding names the item, the face, the room that face looks into and the room on
 * the other face. An item that names no room on its wall (a "linen" curtain is not for the Linen room,
 * a "kitchen" towel hook may hang in the bath), or whose face is not stored (no `side`), makes no claim, nor does a building element (cladding, trim).
 */
export function wallItemFaceIssues(nodes: SceneNodes): RoomCheckIssue[] {
  const out: RoomCheckIssue[] = []
  const zonesOf = new Map<string, ZoneNode[]>()
  for (const node of queryNodes<ZoneNode>(nodes, { type: 'zone' }))
    if (node.parentId && String(node.name ?? '').trim())
      zonesOf.set(node.parentId, [...(zonesOf.get(node.parentId) ?? []), node])
  for (const node of queryNodes<ItemNode>(nodes, { type: 'item' })) {
    // cladding, trim and the like are the building's skin: a facade's is meant to face outside whichever room it is named for
    if (!node.side || isBuildingElementItem(node)) continue
    const wall = node.parentId ? nodes[node.parentId] : undefined
    if (wall?.type !== 'wall') continue
    const levelId = resolveLevelId(wall as WallNode, nodes as never)
    const zones = zonesOf.get(levelId ?? '') ?? []
    const text = textOf(node)
    const named = zones.filter((zone) => mentions(text, String(zone.name)))
    if (named.length === 0) continue
    const length = Math.hypot(
      (wall as WallNode).end[0] - (wall as WallNode).start[0],
      (wall as WallNode).end[1] - (wall as WallNode).start[1],
    )
    if (!(length > 0)) continue
    const station = (node.position[0] ?? 0) / length
    const spans = getWallZoneSpans(wall as WallNode, zones).filter(
      (span) => station >= span.t0 - 1e-6 && station <= span.t1 + 1e-6,
    )
    const face = node.side === 'front' ? 'a' : 'b'
    const zoneOn = (which: 'a' | 'b') =>
      zones.find((zone) => spans.some((span) => span.face === which && span.zoneId === zone.id))
    const here = zoneOn(face)
    const across = zoneOn(face === 'a' ? 'b' : 'a')
    const namedNames = new Set(named.map((zone) => String(zone.name).toLowerCase()))
    if (!across || !namedNames.has(String(across.name).toLowerCase())) continue
    if (here && namedNames.has(String(here.name).toLowerCase())) continue
    const wall0 = wall as WallNode
    out.push({
      type: 'room_wall_item_wrong_face',
      message: `${quote(String(node.name ?? node.asset.name))} hangs on the ${node.side} face of ${quote(String(wall0.name ?? wall0.id))}, which looks into ${here ? quote(String(here.name)) : 'the outside'}, but it names ${quote(String(across.name))}, the room on the other face.`,
      severity: 'warning',
      nodeIds: [node.id, wall0.id, ...(here ? [here.id] : []), across.id],
    })
  }
  return out
}
