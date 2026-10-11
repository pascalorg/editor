import type { AnyNode, WallFace, WallFaceRegion, WallNode, ZoneNode } from '../../schema'
import {
  type WallPaintRole as CoreWallPaintRole,
  getWallLevelZones,
  getWallZoneSpans,
  resolveWallFaceChain,
} from './wall-finish'

/**
 * What one wall paint click changes, as plain node updates — the commit writes
 * it and the hover preview draws it, so the preview is the commit.
 *
 * Painting writes the one finish the role names: a region, a face inside a
 * room (the room's override for that face), the room's wall finish (every face
 * turned to the room takes it, so the room's overrides go), or a slot.
 * Erasing clears everything that makes the surface look painted, on the side
 * that faces the room and nothing across it:
 *   - a face in a room: that room's override, the face's own paint and the
 *     paint regions over the room's part of the face — and, when the room has
 *     a wall finish, an override back to the face's own look;
 *   - a room: its wall finish, every override, and on each face turned to it
 *     the face's own paint and the regions over the room's part of the face.
 */
export type WallPaintRole = CoreWallPaintRole

type Nodes = Readonly<Record<string, AnyNode | undefined>>
type Span = { wallId: string; face: WallFace; u0: number; u1: number }

function zoneNode(nodes: Nodes, zoneId: string): ZoneNode | null {
  const node = nodes[zoneId]
  return node?.type === 'zone' ? node : null
}

function wallLength(wall: WallNode) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

/** The part of each face of `wall` turned to `zone`, in metres along the wall. */
function roomSpans(wall: WallNode, zone: ZoneNode): Span[] {
  const length = wallLength(wall)
  return getWallZoneSpans(wall, [zone]).map((span) => ({
    wallId: wall.id,
    face: span.face,
    u0: span.t0 * length,
    u1: span.t1 * length,
  }))
}

function regionOverlaps(region: WallFaceRegion, span: Span, length: number) {
  if (region.face !== span.face) return false
  const low = Math.max(region.u0 ?? 0, span.u0)
  const high = Math.min(region.u1 ?? length, span.u1)
  return high - low > 1e-6
}

/** The zone whose part of `face` holds station `u` (m), if any. */
export function wallZoneAt(wall: WallNode, face: WallFace, u: number, nodes: Nodes): string | null {
  const length = wallLength(wall)
  if (length < 1e-9) return null
  const t = u / length
  return (
    getWallZoneSpans(wall, getWallLevelZones(wall, nodes)).find(
      (span) => span.face === face && t >= span.t0 - 1e-6 && t <= span.t1 + 1e-6,
    )?.zoneId ?? null
  )
}

/** Clears a wall face's own paint and the regions over `spans` of it. */
function clearFaces(wall: WallNode, spans: readonly Span[]): WallNode {
  const length = wallLength(wall)
  const faces = new Set(spans.map((span) => span.face))
  const regions = (wall.faceRegions ?? []).filter(
    (region) => !spans.some((span) => regionOverlaps(region, span, length)),
  )
  const slots = { ...wall.slots }
  for (const face of faces) delete slots[face]
  const next: WallNode = { ...wall, slots }
  if (regions.length) next.faceRegions = regions
  else delete next.faceRegions
  if (!Object.keys(slots).length) delete next.slots
  return next
}

function withOverrides(zone: ZoneNode, overrides: ZoneNode['wallOverrides']): ZoneNode {
  const next = { ...zone }
  if (overrides?.length) next.wallOverrides = overrides
  else delete next.wallOverrides
  return next
}

/**
 * The node updates one wall paint makes. `ref` is the finish written (a
 * material ref); undefined erases. Returns only the nodes that change.
 */
export function planWallPaint(
  nodes: Nodes,
  wall: WallNode,
  role: WallPaintRole,
  ref: string | undefined,
): Record<string, AnyNode> {
  const out: Record<string, AnyNode> = {}
  const current = <T extends AnyNode>(id: string) => (out[id] ?? nodes[id]) as T | undefined

  if (role.kind === 'slot') {
    const slotId = role.slotId
    const face = slotId === 'a' || slotId === 'b' ? slotId : null
    if (ref || !face) {
      const slots = { ...wall.slots }
      if (ref) slots[slotId] = ref
      else delete slots[slotId]
      out[wall.id] = { ...wall, slots } as AnyNode
      return out
    }
    // Erasing a face no room owns: its own paint and every region on it.
    out[wall.id] = clearFaces(wall, [
      { wallId: wall.id, face, u0: Number.NEGATIVE_INFINITY, u1: Number.POSITIVE_INFINITY },
    ]) as AnyNode
    return out
  }

  if (role.kind === 'region') {
    const region = wall.faceRegions?.find((entry) => entry.id === role.regionId)
    if (!region) return out
    if (ref) {
      out[wall.id] = {
        ...wall,
        faceRegions: wall.faceRegions!.map((entry) =>
          entry.id === region.id ? { ...entry, finish: ref } : entry,
        ),
      } as AnyNode
      return out
    }
    // Erasing a painted part clears the face it sits on, inside its room.
    const length = wallLength(wall)
    const middle = ((region.u0 ?? 0) + (region.u1 ?? length)) / 2
    const zoneId = wallZoneAt(wall, region.face, middle, nodes)
    return planWallPaint(
      nodes,
      wall,
      zoneId
        ? { kind: 'room-face', zoneId, face: region.face }
        : { kind: 'slot', slotId: region.face },
      undefined,
    )
  }

  const zone = zoneNode(nodes, role.zoneId)
  if (!zone) return out

  if (role.kind === 'room-face') {
    const others = (zone.wallOverrides ?? []).filter(
      (entry) => !(entry.wallId === wall.id && entry.face === role.face),
    )
    if (ref) {
      out[zone.id] = withOverrides(zone, [
        ...others,
        { wallId: wall.id, face: role.face, finish: ref },
      ])
      return out
    }
    const spans = roomSpans(wall, zone).filter((span) => span.face === role.face)
    const cleared = clearFaces(wall, spans)
    out[wall.id] = cleared as AnyNode
    // The room's own finish would still show here: hold the face to its own look.
    const chain = resolveWallFaceChain(cleared, role.face)
    const own = chain.kind === 'legacy' ? null : chain.ref
    out[zone.id] = withOverrides(
      zone,
      zone.wallMaterial !== undefined && own
        ? [...others, { wallId: wall.id, face: role.face, finish: own }]
        : others,
    )
    return out
  }

  // The room's walls: every face turned to the room takes the finish, so the
  // room's per-face overrides give way (painted parts stay on top).
  if (ref) {
    out[zone.id] = withOverrides({ ...zone, wallMaterial: ref }, undefined)
    return out
  }
  const next = withOverrides({ ...zone }, undefined)
  delete next.wallMaterial
  out[zone.id] = next
  const wallIds = new Set([wall.id, ...zone.boundaryWallIds])
  for (const id of wallIds) {
    const target = current<AnyNode>(id)
    if (target?.type !== 'wall') continue
    const spans = roomSpans(target, zone)
    if (!spans.length) continue
    const cleared = clearFaces(target, spans)
    if (JSON.stringify(cleared) !== JSON.stringify(target)) out[target.id] = cleared as AnyNode
  }
  return out
}

/** The walls whose look a plan changes: every wall it writes, and every wall of a room it writes. */
export function plannedWallIds(nodes: Nodes, plan: Record<string, AnyNode>): string[] {
  const ids = new Set<string>()
  for (const node of Object.values(plan)) {
    if (node.type === 'wall') ids.add(node.id)
    if (node.type === 'zone') {
      for (const id of node.boundaryWallIds) ids.add(id)
      for (const entry of node.wallOverrides ?? []) ids.add(entry.wallId)
      const before = nodes[node.id]
      if (before?.type === 'zone')
        for (const entry of before.wallOverrides ?? []) ids.add(entry.wallId)
    }
  }
  return [...ids]
}
