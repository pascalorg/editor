import { type AnyNode, type NodeEvent, resolveLevelId, type ZoneNode } from '@pascal-app/core'

// What a pointer event picks in point mode (the owner, 8 October), by the editor's own predicate
// (selection-manager.tsx: "hover, press and click share this predicate"), so the hover shows exactly
// what the click sends. Pure: the editor's room lookups are handed in, so none of this needs a
// three scene.

/** A room, as the editor's room lookup names it (`RoomKey`) or as its zone. */
type RoomRef = { zoneId: string } | Pick<ZoneNode, 'id'>

export type PointPick = {
  /** What the click sends: the room's zone, or the surface itself. */
  nodeId: string
  /** The surface under the cursor when the pick is its room (the wall, floor or ceiling). */
  via?: string
  /** Which face of the picked wall, floor or ceiling the finger is on. */
  face?: 'interior' | 'exterior' | 'top' | 'bottom'
  /** A deeper pick exists (Alt): the label's second line says "⌥ the wall". */
  ambiguous: boolean
}

export type PointPickInput = {
  event: NodeEvent
  alt: boolean
  /** The bubble's targets, so a room that is already the context lets its surfaces pick. */
  selectedTargetIds: readonly string[]
  nodes: Readonly<Record<string, AnyNode | undefined>>
  /** The level in view; null picks on every level. */
  currentLevelId: string | null
  phase?: 'site' | 'structure' | 'furnish'
  /** Zones pick directly only in the zone layer; elsewhere they are reached through their surfaces. */
  zonesPickable?: boolean
  /** The editor's room for a wall, floor or ceiling hit (`roomForEvent`), null when it bounds none. */
  resolveRoom: (event: NodeEvent) => RoomRef | null
  /** The room standing at a plan point of a level, for the side of a wall the viewer is on. */
  roomAtPoint: (levelId: string, x: number, z: number) => RoomRef | null
  /** The roof segment under the cursor (`resolveRoofSegmentSelectionTarget`). */
  resolveRoofSegment?: (event: NodeEvent) => AnyNode | null
  /** The node a body pick lands on once the editor's selection proxies are applied
   *  (`resolveCanvasSelectionNode`). */
  resolveNode?: (node: AnyNode) => AnyNode
}

/** How far out of a wall, along the hit normal, the viewer's side is probed for a room (m). */
const FACE_PROBE_M = 0.15

const zoneIdOf = (room: RoomRef) => ('zoneId' in room ? room.zoneId : room.id)

/** A ceiling's own grid belongs to the ceiling tool, not to a pick. */
const isCeilingGridHit = (event: NodeEvent) =>
  !event.viaHandle &&
  event.node.type === 'ceiling' &&
  (event.object as { name?: string } | undefined)?.name === 'ceiling-grid'

export function resolvePointPick(input: PointPickInput): PointPick | null {
  const { event, nodes } = input
  if (isCeilingGridHit(event)) return null

  let node = input.resolveNode?.(event.node) ?? event.node
  if (node.type === 'roof') node = input.resolveRoofSegment?.(event) ?? node

  // The building and the site are not pointed at from inside a building (the select hover
  // ignores them there too): ground and sky are an area, not a target.
  if (node.type === 'building' || node.type === 'site') {
    if ((input.phase ?? 'structure') !== 'site') return null
    return { nodeId: node.id, ambiguous: false }
  }
  if (node.type === 'zone' && !input.zonesPickable) return null
  // Elevators are building-scoped and stay pickable across level filters.
  if (input.currentLevelId && node.type !== 'elevator') {
    if (resolveLevelId(node, nodes as Record<string, AnyNode>) !== input.currentLevelId) return null
  }

  const levelId = input.currentLevelId ?? resolveLevelId(node, nodes as Record<string, AnyNode>)

  if (node.type === 'wall') return pickWall(input, node, levelId)
  if (node.type === 'slab' || node.type === 'ceiling') return pickPlate(input, node)

  return { nodeId: node.id, ambiguous: false }
}

function pickWall(input: PointPickInput, wall: AnyNode, levelId: string): PointPick {
  const { event } = input
  // From outside "this" means the facade: the side the viewer is on has no room, so the wall
  // itself is picked, not the room behind it. A hit with no normal cannot say, so the editor's
  // own room-first rule decides.
  let face: 'interior' | 'exterior' | null = null
  let viewerRoom: RoomRef | null = null
  if (event.normal) {
    viewerRoom = input.roomAtPoint(
      levelId,
      event.position[0] + event.normal[0] * FACE_PROBE_M,
      event.position[2] + event.normal[2] * FACE_PROBE_M,
    )
    face = viewerRoom ? 'interior' : 'exterior'
  }
  const surface = (): PointPick => ({
    nodeId: wall.id,
    ...(face ? { face } : {}),
    ambiguous: false,
  })
  if (face === 'exterior' || input.alt) return surface()

  const room = viewerRoom ?? input.resolveRoom(event)
  if (!room) return surface()
  const zoneId = zoneIdOf(room)
  if (input.selectedTargetIds.includes(zoneId)) return surface()
  return { nodeId: zoneId, via: wall.id, ...(face ? { face } : {}), ambiguous: true }
}

function pickPlate(input: PointPickInput, plate: AnyNode): PointPick {
  const face = plate.type === 'ceiling' ? 'bottom' : 'top'
  const surface = (): PointPick => ({ nodeId: plate.id, face, ambiguous: false })
  if (input.alt) return surface()

  const room = input.resolveRoom(input.event)
  if (!room) return surface()
  const zoneId = zoneIdOf(room)
  if (input.selectedTargetIds.includes(zoneId)) return surface()
  return { nodeId: zoneId, via: plate.id, face, ambiguous: true }
}
