import type { AnyNode, AnyNodeId, SeparatorNode, WallNode } from '../schema'
import { CeilingNode } from '../schema/nodes/ceiling'
import { SlabNode } from '../schema/nodes/slab'
import type { SurfacePaintRegion } from '../schema/nodes/surface-paint-region'
import { ZoneNode } from '../schema/nodes/zone'
import {
  CEILING_CLAMP_MARGIN,
  getCeilingClampBound,
  getStoredLevelHeight,
} from '../services/storey'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { omitUndefined } from '../utils/omit-undefined'
import { absorbWallSeparators } from './absorb-wall-separators'
import { partitionCeilingChildren } from './ceiling-children'
import { resolvedFootprintPlane } from './floor-foundation-datum'
import { type FloorOpeningIndex, openingsForSurface } from './floor-opening-intent'
import { floorPlateId } from './floor-plate-id'
import { buildFloorPlates, warnPlateFailure } from './floor-plates'
import { floorRoomFaces } from './floor-room-faces'
import { type FloorStepOverride, remapFloorStepOverrideKeys } from './floor-step-finish'
import { replacementPlateFor } from './plate-reference'
import {
  area,
  containsPoint,
  difference,
  intersection,
  type Polygon,
  type Ring,
  union,
} from './polygon-boolean'
import { polygonInteriorPoint } from './polygon-label'
import { pointFromTuple } from './room-graph'
import { roomNameAllocator } from './room-name'
import type { BoundarySpan } from './room-topology-index'
import {
  adoptableFace,
  compareAdoptionFits,
  compareExistingRooms,
  existingRoomFace,
  type ZoneFaceFit,
  zoneFaceFits,
} from './room-zone-adoption'

export const ORPHAN_MERGE_COVERAGE_THRESHOLD = 0.6

export type SceneNodes = Readonly<Record<string, AnyNode>>
export type NodePatch =
  | { op: 'create'; node: AnyNode }
  | { op: 'update'; id: AnyNodeId; data: Partial<AnyNode> }
  | { op: 'delete'; id: AnyNodeId }
export type StructureEvent = {
  type: 'created' | 'adopted' | 'opened' | 'reopened' | 'retired'
  zoneId: string
  survivorId?: string
}
export type StructureRoom = {
  zoneId: ZoneNode['id']
  polygon: Ring
  holes: Ring[]
  clear: Polygon
  spans: BoundarySpan[]
}
export type LevelStructureSnapshot = { levelId: string; rooms: StructureRoom[] }

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

function footprint(node: { polygon: Ring; holes?: Ring[] }): Polygon {
  return { outer: node.polygon, holes: node.holes ?? [] }
}

/** Parts of a room's ceiling smaller than this (m²) are wall-junction slivers, not ceiling. */
const MIN_CEILING_PART_AREA = 0.01

/**
 * A room's ceiling outline: its face minus the plane-bound boundary walls, which
 * rise to the storey plane above it. An explicit-height wall (half wall, parapet,
 * a wall standing on a raised floor) may stop below the ceiling or start above it,
 * so the ceiling spans it to the reference line, as legacy ceilings did, instead of
 * leaving a slot; where such a wall does reach, it hides that strip. A legacy
 * ceiling stored above the storey plane meets no wall and keeps its whole face.
 * Every part is kept (walls can pinch a room in two); a room whose walls leave
 * nothing, or whose boolean fails on acute miters, keeps its reference face rather
 * than losing its ceiling. Largest part first.
 */
function ceilingSurface(
  face: { polygon: Polygon; boundaryWallIds: readonly string[] },
  aboveStorey: boolean,
  nodes: SceneNodes,
  wallFootprints: ReadonlyMap<string, Ring>,
): Polygon[] {
  const reaching = (aboveStorey ? [] : face.boundaryWallIds).flatMap((id) => {
    const wall = nodes[id]
    return wall?.type === 'wall' && wall.height == null && wallFootprints.has(id)
      ? [wallFootprints.get(id)!]
      : []
  })
  const parts = (reaching.length ? difference(face.polygon, union(reaching)) : [face.polygon])
    .filter((part) => area([part]) >= MIN_CEILING_PART_AREA)
    .sort((a, b) => area([b]) - area([a]))
  return parts.length ? parts : [face.polygon]
}

function iou(a: Polygon, b: Polygon) {
  const overlap = area(intersection(a, b))
  const combined = area([a]) + area([b]) - overlap
  return combined > 0 ? overlap / combined : 0
}

function equal(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Span overlap below this (a fraction of the boundary) is a shared endpoint, not a shared edge. */
const SPAN_OVERLAP = 1e-6

/**
 * The rooms that are outside: without a ceiling, and left without crossing a wall, through a
 * separator no room stands behind or into another such room. A porch made a room for its floor
 * left its wall with no outside: the front door faced the hall. A room that only lost its
 * ceiling is walled in and a kitchen open to a terrace keeps its ceiling, so both stay inside; so
 * does a courtyard walled on every side, a limit of this rule.
 */
export function outdoorRoomIds(
  rooms: readonly { spans: readonly BoundarySpan[]; hasCeiling: boolean }[],
): Set<string> {
  const separatorSpans = rooms.flatMap((room) =>
    room.spans.filter((span) => span.kind === 'separator'),
  )
  const across = (span: BoundarySpan) =>
    separatorSpans
      .filter(
        (other) =>
          other.boundaryId === span.boundaryId &&
          other.face !== span.face &&
          Math.min(span.t1, other.t1) - Math.max(span.t0, other.t0) > SPAN_OVERLAP,
      )
      .sort((a, b) => a.t0 - b.t0)
  const exposed = (span: BoundarySpan) => {
    let reach = span.t0
    for (const other of across(span)) {
      if (other.t0 > reach + SPAN_OVERLAP) return true
      reach = Math.max(reach, other.t1)
    }
    return reach < span.t1 - SPAN_OVERLAP
  }
  const open = new Map(
    rooms.flatMap((room) =>
      !room.hasCeiling && room.spans[0] ? [[room.spans[0].roomId, room.spans] as const] : [],
    ),
  )
  const queue = [...open].flatMap(([id, spans]) =>
    spans.some((span) => span.kind === 'separator' && exposed(span)) ? [id] : [],
  )
  const outdoor = new Set(queue)
  for (let id = queue.pop(); id !== undefined; id = queue.pop())
    for (const span of open.get(id)!)
      if (span.kind === 'separator')
        for (const other of across(span))
          if (open.has(other.roomId) && !outdoor.has(other.roomId)) {
            outdoor.add(other.roomId)
            queue.push(other.roomId)
          }
  return outdoor
}

/** A wall face is inside when an indoor room stands on it; an outdoor room's face is outside. */
export function classifyWallSides(
  wall: WallNode,
  spans: readonly BoundarySpan[],
  outdoor: ReadonlySet<string> = new Set(),
): Pick<WallNode, 'frontSide' | 'backSide'> {
  const boundary = spans.filter((span) => span.boundaryId === wall.id)
  if (!boundary.length) return { frontSide: wall.frontSide, backSide: wall.backSide }
  const indoor = (face: BoundarySpan['face']) =>
    boundary.some((span) => span.face === face && !outdoor.has(span.roomId))
  return {
    frontSide: indoor('a') ? 'interior' : 'exterior',
    backSide: indoor('b') ? 'interior' : 'exterior',
  }
}

export function reconcileLevelStructure(
  input: Parameters<typeof planLevelStructure>[0],
): ReturnType<typeof planLevelStructure> {
  try {
    const absorbed = absorbWallSeparators(input.nodes, input.levelId, () =>
      input.mintId('separator'),
    )
    const result = planLevelStructure({ ...input, nodes: absorbed.nodes })
    return { ...result, patches: [...absorbed.patches, ...result.patches] }
  } catch (error) {
    warnPlateFailure(
      input.levelId,
      Object.values(input.nodes)
        .filter((node) => node.parentId === input.levelId)
        .map((node) => node.id),
      error,
    )
    return { patches: [], snapshot: { levelId: input.levelId, rooms: [] }, events: [] }
  }
}

function planLevelStructure({
  levelId,
  nodes,
  mintId,
  openingIndex,
}: {
  levelId: string
  nodes: SceneNodes
  previousNodes?: SceneNodes
  mintId: (kind: 'zone' | 'ceiling' | 'slab' | 'separator') => string
  openingIndex?: FloorOpeningIndex
}): { patches: NodePatch[]; snapshot: LevelStructureSnapshot; events: StructureEvent[] } {
  const snapshot: LevelStructureSnapshot = { levelId, rooms: [] }
  const events: StructureEvent[] = []
  const level = nodes[levelId]
  if (level?.type !== 'level') return { patches: [], snapshot, events }
  const building = level.parentId ? nodes[level.parentId] : undefined
  const units =
    building?.type === 'building'
      ? building.children.flatMap((id) => (nodes[id]?.type === 'unit' ? [nodes[id]!] : []))
      : []
  const children = Object.values(nodes)
    .filter((node) => node.parentId === levelId)
    .sort((a, b) => compareIds(a.id, b.id))
  const walls = children.filter((node): node is WallNode => node.type === 'wall')
  const separators = children.filter((node): node is SeparatorNode => node.type === 'separator')
  const allZones = children.filter((node): node is ZoneNode => node.type === 'zone')
  const stacked = allZones.filter(
    (zone) => zone.spaceRole === 'room' && zone.floor?.support === 'open',
  )
  const zones = allZones.filter((zone) => !stacked.includes(zone))
  const allCeilings = children.filter((node): node is CeilingNode => node.type === 'ceiling')
  const ceilings = allCeilings.filter((node) => node.boundary === 'auto')
  const miters = calculateLevelMiters(walls)
  const wallFootprints = new Map(
    walls.map((wall) => [
      wall.id,
      getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
    ]),
  )
  const faces = [...floorRoomFaces([...walls, ...separators])]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((room) => {
      const polygon = { outer: room.referencePolygon, holes: room.holes }
      const boundaryWallIds = [
        ...new Set(
          room.spans
            .filter((span) => span.kind === 'wall')
            .map((span) => span.boundaryId as WallNode['id']),
        ),
      ].sort()
      const clear = difference(
        polygon,
        union(
          boundaryWallIds.flatMap((id) =>
            wallFootprints.has(id) ? [wallFootprints.get(id)!] : [],
          ),
        ),
      ).sort((a, b) => area([b]) - area([a]))[0] ?? { outer: [], holes: [] }
      return {
        key: room.id,
        polygon,
        clear,
        spans: room.spans,
        boundaryWallIds,
        boundarySeparatorIds: [
          ...new Set(
            room.spans.filter((span) => span.kind === 'separator').map((span) => span.boundaryId),
          ),
        ].sort(),
      }
    })
  const next = new Map<string, AnyNode>()
  const deleted = new Set<AnyNodeId>()
  for (const child of children)
    if (
      child.type === 'floor-opening' &&
      child.source === 'stair' &&
      child.ownerId &&
      nodes[child.ownerId]?.type !== 'stair'
    )
      deleted.add(child.id)
  const put = (node: AnyNode) => next.set(node.id, node)
  const preferred = new Map<string, number>()
  const adoptionFits = new Map<string, ZoneFaceFit>()
  const scores = new Map<string, number[]>()
  for (const zone of zones) {
    const overlaps = faces.map((face) => iou(footprint(zone), face.polygon))
    scores.set(zone.id, overlaps)
    if (!(zone.autoFromWalls && zone.spaceRole === 'room')) {
      // Hand-drawn zones follow the load migration's adoption rule.
      const fit = adoptableFace(zoneFaceFits(zone, faces))
      if (fit) {
        preferred.set(zone.id, fit.face)
        adoptionFits.set(zone.id, fit)
      }
      continue
    }
    const face = existingRoomFace(zone, faces, overlaps)
    if (face !== undefined) preferred.set(zone.id, face)
  }
  const sourceByFace = new Map<number, ZoneNode>()
  const zoneByFace = new Map<number, ZoneNode>()
  const retiredTo = new Map<string, string>()
  const nextRoomName = roomNameAllocator(allZones)
  faces.forEach((face, index) => {
    const rooms = zones
      .filter((zone) => preferred.get(zone.id) === index && !adoptionFits.has(zone.id))
      .sort(compareExistingRooms(face))
    // An existing room keeps its face; a hand-drawn zone that loses stays as it is.
    const drawn = zones
      .filter((zone) => preferred.get(zone.id) === index && adoptionFits.has(zone.id))
      .map((zone) => ({ id: zone.id, zone, fit: adoptionFits.get(zone.id)! }))
      .sort(compareAdoptionFits)
    const survivor = rooms[0] ?? drawn[0]?.zone
    const contenders = rooms
    const source =
      survivor ??
      zones
        .filter(
          (zone) =>
            zone.autoFromWalls &&
            zone.spaceRole === 'room' &&
            (scores.get(zone.id)?.[index] ?? 0) > 0,
        )
        .sort(
          (a, b) => scores.get(b.id)![index]! - scores.get(a.id)![index]! || compareIds(a.id, b.id),
        )[0]
    if (source) sourceByFace.set(index, source)
    const zone =
      survivor ??
      ZoneNode.parse({
        id: mintId('zone'),
        parentId: levelId,
        name: nextRoomName(),
        polygon: face.polygon.outer,
        floor: source?.floor,
        wallMaterial: source?.wallMaterial,
        floorStepFinish: source?.floorStepFinish,
        floorStepOverrides: source?.floorStepOverrides,
        floorEdgeFinish: source?.floorEdgeFinish,
        hasFloor: source?.hasFloor,
        hasCeiling: source?.hasCeiling,
      })
    const seed =
      zone.seed && containsPoint([face.polygon], zone.seed)
        ? zone.seed
        : polygonInteriorPoint(
            { polygon: face.polygon.outer, holes: face.polygon.holes },
            !zone.seed,
          )
    const updated: ZoneNode = {
      ...zone,
      spaceRole: 'room',
      autoFromWalls: true,
      enclosureStatus: 'enclosed',
      seed,
      polygon: face.polygon.outer,
      holes: face.polygon.holes,
      boundaryWallIds: face.boundaryWallIds,
      boundarySeparatorIds: face.boundarySeparatorIds,
    }
    put(updated)
    zoneByFace.set(index, updated)
    snapshot.rooms.push({
      zoneId: updated.id,
      polygon: updated.polygon,
      holes: updated.holes,
      clear: face.clear,
      spans: face.spans,
    })
    if (!survivor) events.push({ type: 'created', zoneId: zone.id })
    else if (!survivor.autoFromWalls || survivor.spaceRole !== 'room')
      events.push({ type: 'adopted', zoneId: zone.id })
    else if (survivor.enclosureStatus === 'open') events.push({ type: 'reopened', zoneId: zone.id })
    for (const retired of contenders.slice(1)) {
      deleted.add(retired.id)
      retiredTo.set(retired.id, zone.id)
      events.push({ type: 'retired', zoneId: retired.id, survivorId: zone.id })
    }
  })
  for (const zone of zones) {
    if (preferred.has(zone.id) || !zone.autoFromWalls || zone.spaceRole !== 'room') continue
    put({ ...zone, enclosureStatus: 'open' })
    if (zone.enclosureStatus !== 'open') events.push({ type: 'opened', zoneId: zone.id })
  }
  // Partition spatial intent with the same faces used for identity, including holes.
  for (const [index, zone] of zoneByFace) {
    const source = sourceByFace.get(index)
    if (!source) continue
    const face = faces[index]!
    const contributors = zones.filter(
      (candidate) => candidate.id === source.id || retiredTo.get(candidate.id) === zone.id,
    )
    // Painted floor and ceiling parts follow the room: kept whole when it is
    // unchanged, else each contributor's regions clipped to the new face.
    const partition = (pick: (zone: ZoneNode) => SurfacePaintRegion[] | undefined) =>
      contributors.length === 1 && equal(footprint(source), face.polygon)
        ? pick(source)
        : contributors
            .flatMap((candidate) => pick(candidate) ?? [])
            .flatMap((region) =>
              intersection(region.polygon, face.polygon).map((part) => ({
                ...region,
                polygon: part.outer,
              })),
            )
    const regions = partition((candidate) => candidate.floor?.regions)
    const ceilingRegions = partition((candidate) => candidate.ceiling?.regions)
    const overrides = contributors
      .flatMap((candidate) => candidate.wallOverrides ?? [])
      .filter((override) =>
        face.spans.some(
          (span) => span.boundaryId === override.wallId && span.face === override.face,
        ),
      )
    if (contributors.some((candidate) => candidate.floor?.regions))
      zone.floor = { ...zone.floor, regions }
    if (contributors.some((candidate) => candidate.ceiling?.regions))
      zone.ceiling = { ...zone.ceiling, regions: ceilingRegions }
    if (contributors.some((candidate) => candidate.wallOverrides))
      zone.wallOverrides = [
        ...new Map(
          overrides.map((override) => [`${override.wallId}:${override.face}`, override]),
        ).values(),
      ]
    // Doorway step paint follows its doors into the merged room; the room's own
    // paint wins a doorway both stored.
    if (
      contributors.some((candidate) => candidate.id !== zone.id && candidate.floorStepOverrides)
    ) {
      const steps = new Map<string, FloorStepOverride>()
      for (const candidate of [zone, ...contributors])
        for (const entry of candidate.floorStepOverrides ?? []) {
          const id = `${entry.key}#${entry.step ?? ''}`
          if (!steps.has(id)) steps.set(id, entry)
        }
      zone.floorStepOverrides = [...steps.values()]
    }
  }
  // A step keyed by a room that merged into another now looks at the survivor.
  if (retiredTo.size)
    for (const candidate of allZones) {
      if (deleted.has(candidate.id)) continue
      const current = (next.get(candidate.id) ?? candidate) as ZoneNode
      const remapped = remapFloorStepOverrideKeys(current, retiredTo)
      if (remapped) put(remapped)
    }
  for (const zone of stacked) {
    const clear = difference(footprint(zone), union([...wallFootprints.values()])).sort(
      (a, b) => area([b]) - area([a]),
    )[0]
    if (!clear) continue
    const index = faces.length
    faces.push({
      key: `mezzanine:${zone.id}`,
      polygon: footprint(zone),
      clear,
      spans: [],
      boundaryWallIds: [],
      boundarySeparatorIds: [],
    })
    zoneByFace.set(index, zone)
    sourceByFace.set(index, zone)
    put(zone)
    snapshot.rooms.push({
      zoneId: zone.id,
      polygon: clear.outer,
      holes: clear.holes,
      clear,
      spans: [],
    })
  }
  const context = {
    revision: 0,
    walls: new Map(walls.map((wall) => [wall.id, wall])),
    wallFootprints,
  }
  const floorPlan = buildFloorPlates({
    levelId,
    rooms: snapshot.rooms.map((room) => ({
      ...room,
      id: room.zoneId,
      context,
      zone: next.get(room.zoneId) as ZoneNode,
    })),
    slabs: children
      .filter((node): node is SlabNode => node.type === 'slab')
      .map((slab) => SlabNode.parse(slab)),
    mintId: (ids, component, role) => floorPlateId(levelId, role ?? 'base', ids, component),
    retiredZones: retiredTo,
    nodes,
    openingIndex,
  })
  for (const room of zoneByFace.values()) {
    if (!room.floor?.footprint || room.floor.elevation === undefined) continue
    const base = floorPlan.plates.find(
      (plate) => plate.plateRole === 'base' && plate.zoneIds?.includes(room.id),
    )
    if (!base || Math.abs(base.elevation - room.floor.elevation) > 1e-6) continue
    const { elevation: _elevation, ...floor } = room.floor
    room.floor = floor
    put(room)
  }
  for (const plate of floorPlan.plates) put(plate)
  for (const plate of floorPlan.retired) deleted.add(plate.id)
  if (floorPlan.remap.size > 0)
    for (const node of Object.values(nodes)) {
      if (deleted.has(node.id)) continue
      const updated = { ...(next.get(node.id) ?? node) } as AnyNode & {
        supportSlabId?: string
        deckSlabId?: string
      }
      let changed = false
      for (const field of ['supportSlabId', 'deckSlabId'] as const) {
        const host = updated[field]
        if (!(host && floorPlan.remap.has(host))) continue
        const replacement = replacementPlateFor(
          updated,
          field,
          [
            ...floorPlan.plates,
            ...children.filter(
              (node): node is SlabNode =>
                node.type === 'slab' && node.boundary !== 'auto' && !node.autoFromWalls,
            ),
          ],
          nodes,
        )
        if (replacement) updated[field] = replacement
        else delete updated[field]
        changed = true
      }
      if (changed) put(updated as AnyNode)
    }
  const ceilingByFace = new Map<number, CeilingNode>()
  const ceilingComponentsByFace = new Map<number, CeilingNode[]>()
  const usedCeilings = new Set<string>()
  const ceilingOpenings = openingsForSurface(nodes, levelId, 'ceiling', openingIndex)
  for (const [index, zone] of zoneByFace) {
    if (
      zone.hasCeiling === false ||
      (zone.floor?.support === 'open' &&
        (zone.hasFloor === false ||
          resolvedFootprintPlane(nodes, zone, getStoredLevelHeight(level)) -
            (zone.floor.elevation ?? 0.05) <
            2))
    )
      continue
    const clear = faces[index]!.clear
    const coversFace = (ceiling: CeilingNode) =>
      area(intersection(footprint(ceiling), clear)) / area([clear]) >=
      ORPHAN_MERGE_COVERAGE_THRESHOLD
    const source = sourceByFace.get(index)
    const linked =
      ceilings.find((ceiling) => ceiling.zoneId === zone.id && !usedCeilings.has(ceiling.id)) ??
      ceilings.find(
        (ceiling) =>
          retiredTo.get(ceiling.zoneId ?? '') === zone.id && !usedCeilings.has(ceiling.id),
      )
    if (
      !linked &&
      allCeilings.some((ceiling) => ceiling.boundary !== 'auto' && coversFace(ceiling))
    )
      continue
    const existing =
      linked ??
      ceilings.find(
        (ceiling) =>
          !(
            (ceiling.zoneId && allZones.some((zone) => zone.id === ceiling.zoneId)) ||
            usedCeilings.has(ceiling.id)
          ) && coversFace(ceiling),
      )
    const surface = ceilingSurface(
      faces[index]!,
      existing?.height !== undefined && existing.height > getStoredLevelHeight(level) + 1e-6,
      nodes,
      wallFootprints,
    )
    if (surface[0]!.outer.length < 3) continue
    const template = existing ?? ceilings.find((ceiling) => ceiling.zoneId === source?.id)
    const ceiling =
      existing ??
      CeilingNode.parse({
        id: mintId('ceiling'),
        parentId: levelId,
        name: `${zone.name || 'Room'} Ceiling`,
        polygon: [],
        material: template?.material,
        materialPreset: template?.materialPreset,
        slots: template?.slots,
        visible: template?.visible,
      })
    const updated: CeilingNode = {
      ...ceiling,
      zoneId: zone.id,
      boundary: 'auto' as const,
      autoFromWalls: true,
      children: [] as CeilingNode['children'],
    }
    const cutouts =
      zone.floor?.support === 'open'
        ? []
        : union(
            stacked.flatMap((mezzanine) =>
              mezzanine.hasFloor === false ? [] : intersection(footprint(mezzanine), surface),
            ),
          )
    const base = surface.map((part) => ({
      outer: part.outer,
      holes: [
        ...part.holes,
        ...cutouts.flatMap((cutout) =>
          area(intersection(cutout, part)) > 1e-6 ? [cutout.outer] : [],
        ),
      ],
    }))
    const authored = ceilingOpenings
      .filter((opening) => !opening.legacyCeilingCuts)
      .flatMap((opening) =>
        intersection(opening.polygon, surface).map((part) => ({ opening, part })),
      )
    const parts = (
      authored.length ? difference(base, union(authored.map(({ part }) => part))) : base
    )
      .filter((part) => area([part]) > 1e-6)
      .sort((a, b) => area([b]) - area([a]))
    const components = parts.map((part, componentIndex) => {
      // Each part keeps the ceiling that already covers it, so a reload never swaps ids.
      const reused =
        [...new Set([ceiling, ...ceilings.filter((candidate) => candidate.zoneId === zone.id)])]
          .filter((candidate) => !usedCeilings.has(candidate.id))
          .map((candidate) => ({ candidate, overlap: iou(footprint(candidate), part) }))
          .filter(({ overlap }) => overlap > 0)
          .sort((a, b) => b.overlap - a.overlap || a.candidate.id.localeCompare(b.candidate.id))[0]
          ?.candidate ?? (componentIndex === 0 ? ceiling : undefined)
      const component: CeilingNode = {
        ...(reused ?? ceiling),
        ...updated,
        id: (reused?.id ?? mintId('ceiling')) as CeilingNode['id'],
        polygon: part.outer,
        holes: part.holes,
        holeMetadata: part.holes.map((hole) => {
          const match = authored.find(({ part: cut }) => area(intersection(hole, cut)) > 1e-6)
          return match
            ? { source: 'floor-opening' as const, openingId: match.opening.id }
            : { source: 'room' as const }
        }),
        ...(authored.length
          ? { openingIds: [...new Set(authored.map(({ opening }) => opening.id))].sort() }
          : { openingIds: undefined }),
        children: [],
      }
      for (const opening of ceilingOpenings) {
        for (const hole of opening.legacyCeilingCuts?.[component.id] ?? []) {
          if (component.holes.some((ring) => equal(ring, hole))) continue
          component.holes.push(hole)
          component.holeMetadata.push({ source: 'floor-opening', openingId: opening.id })
          component.openingIds = [...new Set([...(component.openingIds ?? []), opening.id])].sort()
        }
      }
      usedCeilings.add(component.id)
      put(component)
      return component
    })
    if (components.length) {
      ceilingByFace.set(index, components[0]!)
      ceilingComponentsByFace.set(index, components)
    }
  }
  const detected = faces.map((face) => ({
    poly: face.polygon.outer.map(pointFromTuple),
    holes: face.polygon.holes,
  }))
  for (const ceiling of ceilings) {
    const related = [...ceilingByFace.keys()].filter((index) => {
      const source = sourceByFace.get(index)
      return (
        ceilingByFace.get(index)?.id === ceiling.id ||
        ceiling.zoneId === zoneByFace.get(index)?.id ||
        ceiling.zoneId === source?.id ||
        retiredTo.get(ceiling.zoneId ?? '') === zoneByFace.get(index)?.id ||
        (!ceiling.zoneId && area(intersection(footprint(ceiling), faces[index]!.polygon)) > 0)
      )
    })
    const fallback =
      related.find((index) => ceilingByFace.get(index)?.id === ceiling.id) ?? related[0]
    const assignments = partitionCeilingChildren(ceiling, related, detected, fallback, (id) => {
      const node = nodes[id]
      return node && 'position' in node && Array.isArray(node.position)
        ? [node.position[0], node.position[2]]
        : undefined
    })
    for (const [index, childIds] of assignments) {
      const components = ceilingComponentsByFace.get(index) ?? [ceilingByFace.get(index)!]
      const target = ceilingByFace.get(index)!
      for (const id of childIds) {
        const child = nodes[id]
        if (!child) continue
        const position =
          'position' in child && Array.isArray(child.position)
            ? ([child.position[0], child.position[2]] as [number, number])
            : undefined
        const host =
          (position &&
            components.find((component) => containsPoint([footprint(component)], position))) ||
          target
        host.children.push(id)
        put({ ...child, parentId: host.id })
      }
      const unchangedFace =
        target.id === ceiling.id &&
        equal(target.polygon, ceiling.polygon) &&
        equal(
          target.holes.filter((_, i) => target.holeMetadata[i]?.source === 'room'),
          ceiling.holes.filter((_, i) => ceiling.holeMetadata[i]?.source === 'room'),
        )
      for (const [holeIndex, hole] of ceiling.holes.entries()) {
        const metadata = ceiling.holeMetadata[holeIndex] ?? { source: 'manual' as const }
        if (metadata.source === 'room' || metadata.source === 'floor-opening') continue
        if (
          metadata.source === 'manual' &&
          ceilingOpenings.some(
            (opening) =>
              area(intersection(hole, opening.polygon)) >=
              area([{ outer: hole, holes: [] }]) - 1e-6,
          )
        )
          continue
        for (const part of unchangedFace
          ? [{ outer: hole }]
          : intersection(hole, faces[index]!.clear)) {
          const host = unchangedFace
            ? { component: target, overlap: 1 }
            : components
                .map((component) => ({
                  component,
                  overlap: area(intersection(part.outer, component.polygon)),
                }))
                .sort((a, b) => b.overlap - a.overlap)[0]
          if (!host || host.overlap <= 1e-6) continue
          if (
            host.component.holes.some(
              (ring, i) =>
                equal(ring, part.outer) && equal(host.component.holeMetadata[i], metadata),
            )
          )
            continue
          host.component.holes.push(part.outer)
          host.component.holeMetadata.push(metadata)
        }
      }
    }
    if (!usedCeilings.has(ceiling.id)) {
      deleted.add(ceiling.id)
      // Removing the derived host must not silently destroy authored contents.
      if (!related.length)
        for (const id of ceiling.children) if (nodes[id]) put({ ...nodes[id]!, parentId: levelId })
    }
  }
  for (const components of ceilingComponentsByFace.values())
    for (const ceiling of components) ceiling.children = [...new Set(ceiling.children)].sort()
  const spans = snapshot.rooms.flatMap((room) => room.spans)
  const outdoor = outdoorRoomIds(
    [...zoneByFace].map(([index, zone]) => ({
      spans: faces[index]!.spans,
      hasCeiling: ((next.get(zone.id) ?? zone) as ZoneNode).hasCeiling !== false,
    })),
  )
  for (const wall of walls)
    put({ ...wall, ...next.get(wall.id), ...classifyWallSides(wall, spans, outdoor) } as WallNode)
  for (const ceiling of allCeilings) {
    if (deleted.has(ceiling.id)) continue
    const updated = (next.get(ceiling.id) ?? ceiling) as CeilingNode
    if (updated.height === undefined) continue
    // A floor reassignment pins the ceiling's existing world height. Only a
    // physical covering floor can subsequently clamp that authored height.
    const height = Math.min(
      updated.height,
      getCeilingClampBound(
        levelId,
        nodes,
        updated.polygon,
        updated.metadata.floorReassignmentHeight === true
          ? updated.height + CEILING_CLAMP_MARGIN
          : undefined,
      ),
    )
    if (height !== updated.height) put({ ...updated, height })
  }
  for (const node of units) {
    if (
      node.type === 'unit' &&
      node.members.some((id) => deleted.has(id as AnyNodeId) || retiredTo.has(id))
    )
      put({
        ...node,
        members: [...new Set(node.members.map((id) => retiredTo.get(id) ?? id))].filter(
          (id) => !deleted.has(id as AnyNodeId) && (next.has(id) || !!nodes[id]),
        ) as typeof node.members,
      })
  }
  const all = new Map<string, AnyNode>(
    [level, ...children, ...units].map((node) => [node.id, node]),
  )
  for (const id of deleted) all.delete(id)
  for (const [id, node] of next) if (!deleted.has(id as AnyNodeId)) all.set(id, node)
  const parentIds = new Set<string>([levelId])
  for (const [id, node] of next) {
    if (node.parentId) parentIds.add(node.parentId)
    if (nodes[id]?.parentId) parentIds.add(nodes[id]!.parentId!)
  }
  for (const parentId of parentIds) {
    const parent = all.get(parentId) ?? nodes[parentId]
    if (!(parent && 'children' in parent && Array.isArray(parent.children))) continue
    const childIds = [
      ...parent.children.filter(
        (id) => !deleted.has(id as AnyNodeId) && (all.get(id) ?? nodes[id])?.parentId === parentId,
      ),
    ]
    const added = [...all.values()]
      .filter((node) => node.parentId === parentId && !childIds.includes(node.id as never))
      .map((node) => node.id)
      .sort()
    if (added.length || !equal(childIds, parent.children))
      put({ ...parent, children: [...childIds, ...added] } as AnyNode)
  }
  const patches: NodePatch[] = []
  for (const [id, node] of [...next].sort(([a], [b]) => compareIds(a, b))) {
    if (deleted.has(id as AnyNodeId)) continue
    const before = nodes[id]
    if (before) {
      const data: Record<string, unknown> = {}
      for (const key of new Set([...Object.keys(before), ...Object.keys(node)])) {
        const value = (node as unknown as Record<string, unknown>)[key]
        if (!equal((before as unknown as Record<string, unknown>)[key], value))
          data[key] = omitUndefined(value)
      }
      if (Object.keys(data).length)
        patches.push({ op: 'update', id: node.id, data: data as Partial<AnyNode> })
    } else patches.push({ op: 'create', node: omitUndefined(node) })
  }
  for (const id of [...deleted].sort()) patches.push({ op: 'delete', id })
  return { patches, snapshot, events }
}

export function createLevelStructurePreview(levelId: string, nodes: SceneNodes) {
  const level = nodes[levelId]
  const draft: Record<string, AnyNode> = {}
  const sceneNodes = Object.values(nodes)
  const stackLevels = new Set(
    sceneNodes
      .filter((node) => node.type === 'level' && node.parentId === level?.parentId)
      .map((node) => node.id),
  )
  const levelSlabs = new Set<string>(
    sceneNodes
      .filter((node) => node.type === 'slab' && node.parentId === levelId)
      .map((node) => node.id),
  )
  // Everything the level's reconciliation reads, as the commit sees it: stack
  // context for explicit-height clamps and floor planes, hosted children for
  // partitioning, openings (doorway steps) and stairs landing on the level's
  // plates. Only a copy of the level, so a large scene never slows a drag.
  for (const node of sceneNodes) {
    if (
      node.id === levelId ||
      node.parentId === levelId ||
      stackLevels.has(node.id) ||
      node.id === level?.parentId ||
      (node.type === 'slab' && node.parentId && stackLevels.has(node.parentId as AnyNodeId)) ||
      (node.type === 'unit' && node.parentId === level?.parentId) ||
      (node.type === 'stair' && node.deckSlabId && levelSlabs.has(node.deckSlabId))
    )
      draft[node.id] = node
  }
  for (const node of Object.values(draft)) {
    if (node.type !== 'ceiling' && node.type !== 'wall' && node.type !== 'stair') continue
    for (const id of node.children) if (nodes[id]) draft[id] = nodes[id]!
  }
  let wallIds = new Set<WallNode['id']>(
    Object.values(draft)
      .filter((node): node is WallNode => node.type === 'wall' && node.parentId === levelId)
      .map((node) => node.id),
  )
  return (walls: readonly WallNode[]) => {
    const currentIds = new Set<WallNode['id']>()
    for (const wall of walls) {
      if (wall.parentId !== levelId) continue
      currentIds.add(wall.id)
      if (draft[wall.id] !== wall) draft[wall.id] = wall
    }
    // A level wall left out is one the gesture removes.
    for (const id of wallIds) if (!currentIds.has(id)) delete draft[id]
    wallIds = currentIds
    let id = 0
    // The stored surfaces are the committed reconciliation; only what the
    // moved walls reshape differs from them.
    return reconcileLevelStructure({
      levelId,
      nodes: draft,
      mintId: (kind) => `${kind}_preview_${id++}`,
    }).patches.flatMap((patch) =>
      patch.op === 'update' &&
      (nodes[patch.id]?.type === 'zone' ||
        nodes[patch.id]?.type === 'ceiling' ||
        nodes[patch.id]?.type === 'slab')
        ? [patch]
        : [],
    )
  }
}
