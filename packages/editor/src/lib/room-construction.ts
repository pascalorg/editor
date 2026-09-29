import {
  type AnyNode,
  area,
  type BoundaryNode,
  type BoundarySpan,
  type CeilingNode,
  calculateLevelMiters,
  containsPoint,
  difference,
  type ExtractedRoom,
  extractRooms,
  getWallPlanFootprint,
  intersection,
  isDerivedNode,
  type Polygon,
  roomDrawnFloor,
  type SlabNode,
  type SpanRef,
  type StructureNodes,
  union,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'

export type ConstructionPresence = 'present' | 'partial' | 'absent'

/** The buttons a row offers, derived with its presence so the two never disagree. */
export type ConstructionActions = {
  add: boolean
  remove: boolean
  /** Ceiling only: adopt the hand-drawn ceiling over the room as its ceiling. */
  useExisting?: boolean
  /** Ceiling only: swap the hand-drawn ceiling for one generated from the room. */
  replace?: boolean
}

export type RoomConstructionState = {
  zoneId: string
  name: string
  floor: {
    state: ConstructionPresence
    /** `hasFloor !== false`. */
    intent: boolean
    /** Fraction of the room footprint covered by its plate or manual slabs, 0..1. */
    coverage: number
    actions: ConstructionActions
  }
  walls: {
    state: ConstructionPresence
    /** Wall spans no other room faces: what Remove turns into separators. */
    removable: SpanRef[]
    /** Separator spans: what Add turns into walls. */
    separators: SpanRef[]
    /** Distinct walls this room shares with a neighbour; they stay on Remove. */
    sharedWallIds: string[]
    actions: ConstructionActions
  }
  ceiling: {
    state: ConstructionPresence
    /** `hasCeiling !== false`. */
    intent: boolean
    /** The room's own (derived) ceiling. */
    ceilingId: string | null
    /** Items hanging from the room's own ceiling: its `children`. */
    hostedIds: string[]
    /** Hand-drawn ceilings standing in for a missing room ceiling. */
    manualIds: string[]
    /** Items hanging from those hand-drawn ceilings: their `children`. */
    manualHostedIds: string[]
    actions: ConstructionActions
  }
}

// Coverage below/above these reads as Absent/Present; anything between is Partial.
const COVERED = 0.98
const UNCOVERED = 0.02
// Mirrors core's ORPHAN_MERGE_COVERAGE_THRESHOLD: a hand-drawn ceiling covering
// this share of a room stops the reconciler from generating the room's own.
const MANUAL_CEILING_BLOCKS = 0.6
const OPENING_HOLES = new Set(['stair', 'elevator'])
// Without the type guard: a ceiling that is not derived is still a CeilingNode.
const derived = (node: AnyNode): boolean => isDerivedNode(node)

const footprint = (node: { polygon: [number, number][]; holes?: [number, number][][] }) => ({
  outer: node.polygon,
  holes: node.holes ?? [],
})

function coverageOf(zone: ZoneNode, covers: Polygon[]) {
  const room = footprint(zone)
  const total = area([room])
  if (!(total > 0 && covers.length)) return 0
  return Math.min(1, area(intersection(room, union(covers))) / total)
}

function presence(coverage: number): ConstructionPresence {
  if (coverage >= COVERED) return 'present'
  return coverage > UNCOVERED ? 'partial' : 'absent'
}

// One extraction per level boundary set: intent edits (name, finishes,
// hasFloor/hasCeiling) keep every boundary node identical and reuse it.
const facesByLevel = new Map<string, { boundaries: BoundaryNode[]; faces: ExtractedRoom[] }>()

function levelFaces(nodes: StructureNodes, levelId: string) {
  const boundaries = Object.values(nodes).filter(
    (node): node is BoundaryNode =>
      node.parentId === levelId && (node.type === 'wall' || node.type === 'separator'),
  )
  const cached = facesByLevel.get(levelId)
  if (
    cached &&
    cached.boundaries.length === boundaries.length &&
    cached.boundaries.every((node, i) => node === boundaries[i])
  )
    return cached.faces
  const faces = extractRooms(boundaries)
  facesByLevel.set(levelId, { boundaries, faces })
  return faces
}

// Mirrors core's `roomFace`, which setZoneEdges and lockOutsideFaces use to
// validate spans: the face with the largest overlap with the zone footprint.
function zoneFace(zone: ZoneNode, faces: ExtractedRoom[]) {
  let best: ExtractedRoom | undefined
  let bestOverlap = 0
  for (const face of faces) {
    const overlap = area(
      intersection(footprint(zone), { outer: face.referencePolygon, holes: face.holes }),
    )
    if (overlap > bestOverlap) {
      best = face
      bestOverlap = overlap
    }
  }
  return best
}

/**
 * The room's walkable area: its boundary face minus the footprints of the
 * walls on it — the same `clear` polygon the reconciler fits plates and
 * ceilings to. Null when the room has no face.
 */
export function roomClearPolygon(nodes: StructureNodes, zoneId: string): Polygon | null {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || !zone.parentId) return null
  const face = zoneFace(zone, levelFaces(nodes, zone.parentId))
  if (!face) return null
  const polygon = { outer: face.referencePolygon, holes: face.holes }
  const wallIds = new Set(face.spans.filter((s) => s.kind === 'wall').map((s) => s.boundaryId))
  if (!wallIds.size) return polygon
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === zone.parentId,
  )
  const miters = calculateLevelMiters(walls)
  const footprints = walls
    .filter((wall) => wallIds.has(wall.id))
    .map((wall) => getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]))
  return difference(polygon, union(footprints)).sort((a, b) => area([b]) - area([a]))[0] ?? null
}

const overlaps = (a: SpanRef, b: SpanRef) =>
  a.boundaryId === b.boundaryId &&
  a.face !== b.face &&
  Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0) > 1e-6

const spanRef = ({ boundaryId, face, t0, t1 }: BoundarySpan): SpanRef => ({
  boundaryId,
  face,
  t0,
  t1,
})

function wallsState(nodes: StructureNodes, zone: ZoneNode): RoomConstructionState['walls'] {
  const faces = levelFaces(nodes, zone.parentId!)
  const spans = zoneFace(zone, faces)?.spans ?? []
  const wallSpans = spans.filter((span) => span.kind === 'wall')
  // A span is shared when a neighbouring room's face covers the other side of
  // it — the same test setZoneEdges applies before leaving a wall in place.
  const neighbourZones = Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === 'zone' &&
      node.id !== zone.id &&
      node.parentId === zone.parentId &&
      node.spaceRole === 'room',
  )
  const neighbourFaces = new Map<ZoneNode, ExtractedRoom | undefined>()
  const faceOf = (other: ZoneNode) => {
    if (!neighbourFaces.has(other)) neighbourFaces.set(other, zoneFace(other, faces))
    return neighbourFaces.get(other)
  }
  const shared = (span: BoundarySpan) =>
    neighbourZones.some(
      (other) =>
        other.boundaryWallIds.includes(span.boundaryId as ZoneNode['boundaryWallIds'][number]) &&
        faceOf(other)?.spans.some((candidate) => overlaps(candidate, span)),
    )
  const sharedSpans = wallSpans.filter(shared)
  const walls = wallSpans.length
  const removable = wallSpans.filter((span) => !sharedSpans.includes(span)).map(spanRef)
  const separators = spans.filter((span) => span.kind === 'separator').map(spanRef)
  return {
    state: walls === 0 ? 'absent' : walls === spans.length ? 'present' : 'partial',
    removable,
    separators,
    sharedWallIds: [...new Set(sharedSpans.map((span) => span.boundaryId))],
    actions: { add: separators.length > 0, remove: removable.length > 0 },
  }
}

/** The room's floor plates: derived slabs that list the zone. */
function roomPlates(nodes: StructureNodes, zone: ZoneNode) {
  return Object.values(nodes).filter(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      node.parentId === zone.parentId &&
      isDerivedNode(node) &&
      !!node.zoneIds?.includes(zone.id),
  )
}

function floorState(nodes: StructureNodes, zone: ZoneNode): RoomConstructionState['floor'] {
  const intent = zone.hasFloor !== false
  // A drawn-slab floor is the slab: switching the room's floor off would hide
  // nothing, so only the slab itself can go. A floor switched off before still
  // shows the slab it stands on, and can be switched back on.
  const drawn = roomDrawnFloor(nodes, zone.id) !== null
  const actions = { add: !intent, remove: intent && !drawn }
  if (!intent && !drawn) return { state: 'absent', intent, coverage: 0, actions }
  // The walking surface is this room's plate(s) plus any manual slab on the
  // level; stair and elevator holes are openings, not missing floor. Once
  // the room has a plate, another floor's base plate counts too: a room on a
  // separate floor meets its neighbour's floor under the wall they share.
  const listed = roomPlates(nodes, zone).length > 0
  const covers = Object.values(nodes).flatMap((node) => {
    if (node.type !== 'slab' || node.parentId !== zone.parentId) return []
    if (
      isDerivedNode(node) &&
      !node.zoneIds?.includes(zone.id) &&
      !(listed && node.plateRole === 'base')
    )
      return []
    return [
      {
        outer: node.polygon,
        holes: node.holes.filter(
          (_, i) => !OPENING_HOLES.has(node.holeMetadata[i]?.source ?? 'manual'),
        ),
      },
    ]
  })
  const coverage = coverageOf(zone, covers)
  return { state: presence(coverage), intent, coverage, actions }
}

const childrenOf = (nodes: StructureNodes, ceilings: CeilingNode[]) =>
  ceilings.flatMap((ceiling) => ceiling.children.filter((id) => nodes[id]))

function ceilingState(nodes: StructureNodes, zone: ZoneNode): RoomConstructionState['ceiling'] {
  const intent = zone.hasCeiling !== false
  const ceilings = Object.values(nodes).filter(
    (node): node is CeilingNode => node.type === 'ceiling' && node.parentId === zone.parentId,
  )
  const linked = intent
    ? ceilings.find((ceiling) => isDerivedNode(ceiling) && ceiling.zoneId === zone.id)
    : undefined
  if (linked)
    return {
      state: 'present',
      intent,
      ceilingId: linked.id,
      hostedIds: childrenOf(nodes, [linked]),
      manualIds: [],
      manualHostedIds: [],
      actions: { add: false, remove: true },
    }
  // Without its own ceiling, a hand-drawn one over the room stands in for it.
  const manual = ceilings.filter(
    (ceiling) => !derived(ceiling) && coverageOf(zone, [footprint(ceiling)]) > UNCOVERED,
  )
  const base = { intent, ceilingId: null, hostedIds: [] }
  if (!manual.length)
    return {
      ...base,
      state: 'absent',
      manualIds: [],
      manualHostedIds: [],
      actions: { add: !intent, remove: false },
    }
  // Clearing the opt-out under a ceiling that covers this much keeps it as the
  // room's ceiling; under a smaller one the reconciler generates a room ceiling.
  const blocks = coverageOf(zone, manual.map(footprint)) >= MANUAL_CEILING_BLOCKS
  return {
    ...base,
    // Someone else's surface: the room is only partly its own.
    state: 'partial',
    manualIds: manual.map((ceiling) => ceiling.id),
    manualHostedIds: childrenOf(nodes, manual),
    actions: {
      add: !(intent || blocks),
      remove: true,
      useExisting: !intent && blocks,
      replace: true,
    },
  }
}

// Floor-standing furnishings; structure (stairs, columns) stays out of it.
const FLOOR_CONTENT = new Set(['item', 'procedural-item', 'cabinet', 'shelf'])
const RESTING = 1e-3

type Positioned = AnyNode & {
  position: [number, number, number]
  supportSlabId?: string
}

/**
 * What stands on the room's floor: furnishings pinned to one of its plates
 * (`supportSlabId`, or parented to a plate), plus unpinned ones on the level
 * resting at floor height inside the room's clear polygon. Each comes with
 * the elevation of the plate it stands on, so it can stay put when the plate
 * goes. Children of these (a lamp on a table) move and go with them.
 */
export function roomFloorContents(
  nodes: StructureNodes,
  zoneId: string,
): { id: string; elevation: number }[] {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || !zone.parentId) return []
  const plates = roomPlates(nodes, zone)
  if (!plates.length) return []
  const byId = new Map(plates.map((plate) => [plate.id as string, plate]))
  const clear = roomClearPolygon(nodes, zoneId)
  const plateAt = (point: [number, number]) =>
    plates.find((plate) => containsPoint([footprint(plate)], point)) ?? plates[0]!
  return Object.values(nodes).flatMap((node) => {
    if (!(FLOOR_CONTENT.has(node.type) && 'position' in node)) return []
    const { parentId, position, supportSlabId } = node as Positioned
    const point: [number, number] = [position[0], position[2]]
    let plate = parentId ? byId.get(parentId) : undefined
    if (!plate && parentId === zone.parentId) {
      if (supportSlabId) plate = byId.get(supportSlabId)
      else if (Math.abs(position[1]) <= RESTING && clear && containsPoint([clear], point))
        plate = plateAt(point)
    }
    return plate ? [{ id: node.id, elevation: plate.elevation }] : []
  })
}

let memo: { nodes: StructureNodes; states: Map<string, RoomConstructionState | null> } | null = null

/**
 * Floor / Walls / Ceiling presence for a room, and the actions each row
 * offers, derived together from intent and the reconciled graph. Pure;
 * memoized per `nodes` identity and zone id.
 *
 * - Floor: Absent when `hasFloor === false` (unless a drawn slab still floors
 *   the room: the switch cannot take that away); otherwise the share of the zone
 *   footprint covered by plates listing the zone plus manual slabs (stair and
 *   elevator holes count as floor) — ≥ 98 % Present, ≤ 2 % Absent, else Partial.
 * - Walls: every boundary span a wall → Present, none → Absent, a mix → Partial.
 * - Ceiling: Present with the room's own (derived) ceiling; Partial when only a
 *   hand-drawn ceiling covers the room (Use existing / Replace / Remove);
 *   otherwise Absent.
 */
export function roomConstructionState(
  nodes: StructureNodes,
  zoneId: string,
): RoomConstructionState | null {
  if (memo?.nodes !== nodes) memo = { nodes, states: new Map() }
  if (memo.states.has(zoneId)) return memo.states.get(zoneId)!
  const zone = nodes[zoneId]
  const state =
    zone?.type === 'zone' && zone.spaceRole === 'room' && zone.parentId
      ? {
          zoneId,
          name: zone.name,
          floor: floorState(nodes, zone),
          walls: wallsState(nodes, zone),
          ceiling: ceilingState(nodes, zone),
        }
      : null
  memo.states.set(zoneId, state)
  return state
}
