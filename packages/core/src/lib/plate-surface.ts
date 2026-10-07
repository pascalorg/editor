import type {
  AnyNode,
  AnyNodeId,
  DoorNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import { getWallCurveFrameAt, getWallCurveStationAtPoint } from '../systems/wall/wall-curve'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { openingLandings } from './floor-opening-footprints'
import type { PlateRoom } from './floor-plates'
import { floorRoomFaces } from './floor-room-faces'
import { exposedIntervals } from './level-footprints'
import { getOpeningWallCut, wallSupportForNodes } from './opening-floor-datum'
import {
  area,
  difference,
  intersection,
  type MultiPolygon,
  containsPoint as polygonContainsPoint,
  type Ring,
  union,
} from './polygon-boolean'
import { roomFloorPlate } from './room-floor-plate'

/**
 * Who draws the walking surface of a floor plate, and what the plate's vertical
 * faces are.
 *
 * A plate (`slab.boundary === 'auto'`) spans every room it carries plus the
 * wall footprints between them, so one mesh cannot hold one finish: the top is
 * partitioned into cells by the polygon kernel and each cell draws its own
 * resolved material. Priority, highest first:
 *
 *   1. a manual slab top at the same height  → masked out of the plate entirely
 *   2. the zone's `floor.regions`            → later entries win
 *   3. the zone's `floor.finish`             → inside the zone CLEAR polygon
 *   4. the plate's own `surface` slot        → under walls and unfinished rooms
 *
 * The side faces are classified per exposed interval: `edge` where the face
 * looks at the exterior, `riser` where it looks at a lower plate or the open
 * air of a sub-zone step. Wall-covered steps are hidden except under doors;
 * facade edges still show the slab thickness.
 *
 * Everything here is pure 2D and memoised per plate per topology/finish
 * revision — `computePlateSurfacePartition` is the only entry point a renderer
 * needs and never runs per frame.
 */

/** A zone floor finish: a `MaterialRef` string, or an inline legacy material. */
export type PlateFinish = string | Record<string, unknown>

export type PlateTopCell = {
  /** Paint role for a hit on this cell — a slab slot id or a `room:` route. */
  role: string
  /** Finish drawing the cell; absent = the plate's own `surface` slot. */
  finish?: PlateFinish
  /** Equal keys ⇒ one shared material instance, so batches never fragment. */
  materialKey: string
  polygons: MultiPolygon
}

export type PlateSideRole = 'edge' | 'riser' | 'hidden'

export type PlateSideInterval = {
  start: [number, number]
  end: [number, number]
  role: PlateSideRole
  /** Lower neighbouring plate top, in level-local metres. */
  dropTo?: number
  zoneId?: string
  /**
   * The doorway a room-owned riser steps through (`lib/floor-step-finish`):
   * the door it sits under, else the lower room it looks at.
   */
  stepKey?: string
  bottom?: number
  top?: number
}

export type PlateSurfacePartition = {
  /** Disjoint, together covering the plate top minus `masked`. */
  cells: PlateTopCell[]
  /** Plate top covered by a manual surface or solid platform. */
  masked: MultiPolygon
  sides: PlateSideInterval[]
  /** True when the top is one plain `surface` cell — renderers skip the clip. */
  plainTop: boolean
}

export type PlateLevelContext = {
  walls: WallNode[]
  zones: ZoneNode[]
  slabs: SlabNode[]
  openings?: (DoorNode | WindowNode)[]
  platform?: boolean
  nodes?: Readonly<Record<string, AnyNode>>
}

const contextNodesCache = new WeakMap<
  PlateLevelContext,
  { signature: string; nodes: Readonly<Record<string, AnyNode>> }
>()

function surfaceNodes(context: PlateLevelContext): Readonly<Record<string, AnyNode>> {
  const signature = JSON.stringify([
    wallSignature(context.walls),
    zoneSignature(context.zones),
    slabSignature(context.slabs),
    context.openings,
  ])
  const cached = contextNodesCache.get(context)
  if (cached?.signature === signature) return cached.nodes
  const nodes = {
    ...context.nodes,
    ...Object.fromEntries(
      [...context.walls, ...context.zones, ...context.slabs, ...(context.openings ?? [])].map(
        (node) => [node.id, node],
      ),
    ),
  }
  contextNodesCache.set(context, { signature, nodes })
  return nodes
}

/** Manual tops within this of the plate top hide the plate instead of z-fighting it. */
const TOP_MATCH_TOLERANCE = 0.01
const MIN_CELL_AREA = 1e-6
/** Sampling offset used to look across an exposed plate edge. */
const EXPOSURE_PROBE = 0.02
const PLATE_SURFACE_ROLE = 'surface'

export function isFloorPlate(slab: Pick<SlabNode, 'boundary'>): boolean {
  return slab.boundary === 'auto'
}

/** `room:<zoneId>` paints the room's floor finish; `/regionId` paints one region. */
export function roomFinishRole(zoneId: string, regionId?: string): string {
  return regionId ? `room:${zoneId}/${regionId}` : `room:${zoneId}`
}

export function parseRoomFinishRole(
  role: string,
): { zoneId: string; regionId: string | null } | null {
  if (!role.startsWith('room:')) return null
  const rest = role.slice('room:'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return rest ? { zoneId: rest, regionId: null } : null
  const zoneId = rest.slice(0, slash)
  const regionId = rest.slice(slash + 1)
  return zoneId && regionId ? { zoneId, regionId } : null
}

/** Stable identity of a finish, so two rooms painted alike share one material. */
export function plateFinishKey(finish: PlateFinish | undefined): string {
  if (finish === undefined) return `slot:${PLATE_SURFACE_ROLE}`
  return typeof finish === 'string' ? `ref:${finish}` : `inline:${JSON.stringify(finish)}`
}

/** Level neighbourhood a plate partition reads — walls, zones and sibling slabs. */
export function plateLevelContext(
  parent: AnyNode | null,
  resolve: (id: AnyNodeId) => AnyNode | undefined,
): PlateLevelContext {
  const walls: WallNode[] = []
  const zones: ZoneNode[] = []
  const slabs: SlabNode[] = []
  const childIds = (parent as { children?: AnyNodeId[] } | null)?.children
  if (!Array.isArray(childIds)) return { walls, zones, slabs }
  for (const id of childIds) {
    const child = resolve(id)
    if (child?.type === 'wall') walls.push(child)
    else if (child?.type === 'zone') zones.push(child)
    else if (child?.type === 'slab') slabs.push(child)
  }
  const openings = walls.flatMap((wall) =>
    wall.children.flatMap((id) => {
      const child = resolve(id)
      return child?.type === 'door' || child?.type === 'window' ? [child] : []
    }),
  )
  const nodes = Object.fromEntries(
    [...childIds.map(resolve).filter((node): node is AnyNode => !!node), ...openings].map(
      (node) => [node.id, node],
    ),
  )
  let ancestor = parent
  while (ancestor && !nodes[ancestor.id]) {
    nodes[ancestor.id] = ancestor
    ancestor = ancestor.parentId ? (resolve(ancestor.parentId as AnyNodeId) ?? null) : null
  }
  return { walls, zones, slabs, openings, nodes }
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4
}

function wallSignature(walls: readonly WallNode[]): string {
  return JSON.stringify(
    walls.map((wall) => [
      wall.id,
      wall.start.map(round),
      wall.end.map(round),
      round(wall.thickness ?? 0),
      wall.justification ?? null,
      wall.curveOffset ?? null,
      wall.supportSlabId,
      wall.supportOffset,
      wall.height,
    ]),
  )
}

function zoneSignature(zones: readonly ZoneNode[]): string {
  return JSON.stringify(
    zones.map((zone) => [
      zone.id,
      zone.spaceRole,
      zone.hasFloor,
      zone.polygon,
      zone.holes,
      zone.floor?.finish ?? null,
      zone.floorStepFinish,
      zone.floorStepOverrides ?? null,
      zone.floorEdgeFinish,
      zone.floor?.elevation ?? null,
      (zone.floor?.regions ?? []).map((region) => [region.id, region.polygon, region.finish]),
    ]),
  )
}

function slabSignature(slabs: readonly SlabNode[]): string {
  return JSON.stringify(
    slabs.map((slab) => [
      slab.id,
      slab.boundary ?? null,
      slab.autoFromWalls,
      slab.recessed,
      slab.support,
      slab.plateRole,
      slab.thickness,
      slab.elevation ?? DEFAULT_SLAB_ELEVATION,
      slab.polygon,
      slab.holes,
      slab.zoneIds ?? null,
    ]),
  )
}

/**
 * Everything the partition of ONE plate depends on. Written into the geometry
 * builder's memo and into the slab dependency tracker, so a finish edit rebuilds
 * exactly the plates that show it and nothing else re-clips.
 */
export function platePartitionSignature(plate: SlabNode, context: PlateLevelContext): string {
  return JSON.stringify([
    plate.id,
    plate.support,
    plate.plateRole,
    context.platform ?? false,
    round(plate.elevation ?? DEFAULT_SLAB_ELEVATION),
    plate.polygon,
    plate.holes,
    plate.zoneIds ?? null,
    plate.slots?.surface ?? null,
    wallSignature(context.walls),
    zoneSignature(context.zones),
    slabSignature(context.slabs),
    (context.openings ?? []).map((opening) => [
      opening.id,
      opening.parentId,
      opening.position,
      opening.width,
      opening.height,
      opening.verticalAnchor,
    ]),
  ])
}

const wallCoverCache = new WeakMap<
  readonly WallNode[],
  { signature: string; cover: MultiPolygon }
>()
const wallCoverBySignature = new Map<string, MultiPolygon>()
const MAX_CACHE_ENTRIES = 32

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  return value
}

/** Joined plan footprints of every wall on the level — the "under a wall" mask. */
export function levelWallCover(walls: readonly WallNode[]): MultiPolygon {
  if (!walls.length) return []
  const signature = wallSignature(walls)
  const cached = wallCoverCache.get(walls)
  if (cached?.signature === signature) return cached.cover
  const shared = wallCoverBySignature.get(signature)
  if (shared) {
    wallCoverCache.set(walls, { signature, cover: shared })
    return shared
  }
  const miters = calculateLevelMiters([...walls])
  const cover = union(
    walls.map((wall) =>
      getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
    ),
  )
  wallCoverCache.set(walls, { signature, cover })
  return remember(wallCoverBySignature, signature, cover)
}

const surfacePolygonCache = new WeakMap<object, { signature: string; polygon: MultiPolygon }>()
function surfacePolygon(node: Pick<SlabNode, 'polygon' | 'holes'>): MultiPolygon {
  const signature = JSON.stringify([node.polygon, node.holes])
  const cached = surfacePolygonCache.get(node)
  if (cached?.signature === signature) return cached.polygon
  const polygon =
    node.polygon.length < 3 ? [] : union([{ outer: node.polygon, holes: node.holes ?? [] }])
  surfacePolygonCache.set(node, { signature, polygon })
  return polygon
}

function overlappingPolygons(
  polygons: MultiPolygon,
  target: MultiPolygon,
  padding = 0.0001,
): MultiPolygon {
  const points = target.flatMap((polygon) => polygon.outer)
  const minX = Math.min(...points.map((point) => point[0])) - padding
  const maxX = Math.max(...points.map((point) => point[0])) + padding
  const minZ = Math.min(...points.map((point) => point[1])) - padding
  const maxZ = Math.max(...points.map((point) => point[1])) + padding
  return polygons.filter(
    ({ outer }) =>
      Math.max(...outer.map((point) => point[0])) >= minX &&
      Math.min(...outer.map((point) => point[0])) <= maxX &&
      Math.max(...outer.map((point) => point[1])) >= minZ &&
      Math.min(...outer.map((point) => point[1])) <= maxZ,
  )
}

const pointBounds = new WeakMap<
  MultiPolygon,
  Array<{ polygon: MultiPolygon; minX: number; maxX: number; minZ: number; maxZ: number }>
>()
function containsPoint(polygons: MultiPolygon, point: [number, number]): boolean {
  let bounds = pointBounds.get(polygons)
  if (!bounds) {
    bounds = polygons.map((polygon) => ({
      polygon: [polygon],
      minX: Math.min(...polygon.outer.map((p) => p[0])) - 1e-10,
      maxX: Math.max(...polygon.outer.map((p) => p[0])) + 1e-10,
      minZ: Math.min(...polygon.outer.map((p) => p[1])) - 1e-10,
      maxZ: Math.max(...polygon.outer.map((p) => p[1])) + 1e-10,
    }))
    pointBounds.set(polygons, bounds)
  }
  return bounds.some(
    (bound) =>
      point[0] >= bound.minX &&
      point[0] <= bound.maxX &&
      point[1] >= bound.minZ &&
      point[1] <= bound.maxZ &&
      polygonContainsPoint(bound.polygon, point),
  )
}

function zoneFace(zone: ZoneNode): MultiPolygon {
  return surfacePolygon(zone)
}

function slabTop(slab: SlabNode): MultiPolygon {
  return surfacePolygon(slab)
}

function isManualSlab(slab: SlabNode): boolean {
  return slab.boundary !== 'auto' && !slab.autoFromWalls
}

type Candidate = { role: string; finish: PlateFinish | undefined; polygons: MultiPolygon }

/**
 * Top cells, highest priority first. Each candidate takes only what the ones
 * before it left, so regions beat the room finish and the room finish beats the
 * plate's own slot — with no overlap and no double-drawn triangle.
 */
function partitionTop(
  plate: SlabNode,
  top: MultiPolygon,
  context: PlateLevelContext,
  wallCover: MultiPolygon,
  prepared: ReturnType<typeof prepareLevel>,
): { cells: PlateTopCell[]; masked: MultiPolygon } {
  const elevation = plate.elevation ?? DEFAULT_SLAB_ELEVATION
  const covering = context.slabs.filter(
    (slab) =>
      slab.id !== plate.id &&
      !slab.recessed &&
      ((isManualSlab(slab) &&
        Math.abs((slab.elevation ?? DEFAULT_SLAB_ELEVATION) - elevation) <= TOP_MATCH_TOLERANCE) ||
        (slab.plateRole === 'platform' &&
          slab.elevation > elevation &&
          slab.elevation - slab.thickness <= elevation + 1e-6)),
  )
  const masked = covering.length
    ? intersection(union(covering.map(slabTop)), top)
    : ([] as MultiPolygon)

  let remaining = masked.length ? difference(top, masked) : top
  const cells: PlateTopCell[] = []
  if (!remaining.length) return { cells, masked }

  const carried = new Map(context.zones.map((zone) => [zone.id as string, zone]))
  const zones = (plate.zoneIds ?? [])
    .map((id) => carried.get(id))
    .filter((zone): zone is ZoneNode => zone?.spaceRole === 'room')

  const thresholdOwners = prepared.landings
    .filter((landing) => !landing.exterior || Math.abs(landing.elevation - elevation) < 0.001)
    .flatMap((landing) =>
      landing.polygons.map((polygon) => ({
        polygon,
        zone: context.zones.find((zone) => zone.id === landing.zoneId),
      })),
    )
  const clearByZone = new Map<string, MultiPolygon>()
  for (const zone of zones) {
    const face = zoneFace(zone)
    if (!face.length) continue
    const clear =
      plate.plateRole === 'platform' || plate.plateRole === 'sunken'
        ? top
        : wallCover.length
          ? difference(
              face,
              union(
                overlappingPolygons(
                  prepared.walls.flatMap((entry) => entry.polygon),
                  face,
                ),
              ),
            )
          : face
    const withThreshold = plate.plateRole
      ? union([
          clear,
          ...thresholdOwners
            .filter((entry) => entry.zone?.id === zone.id)
            .map((entry) => entry.polygon),
        ])
      : clear
    if (withThreshold.length) clearByZone.set(zone.id, withThreshold)
  }

  const candidates: Candidate[] = []
  for (const zone of zones) {
    const clear = clearByZone.get(zone.id)
    if (!clear) continue
    const regions = zone.floor?.regions ?? []
    // Later entries win, so the last region is the first candidate.
    for (let index = regions.length - 1; index >= 0; index -= 1) {
      const region = regions[index]!
      if (region.polygon.length < 3) continue
      const polygons = intersection(union([region.polygon as Ring]), clear)
      if (!polygons.length) continue
      candidates.push({
        role: roomFinishRole(zone.id, region.id),
        finish: region.finish,
        polygons,
      })
    }
  }
  for (const zone of zones) {
    const clear = clearByZone.get(zone.id)
    const finish = zone.floor?.finish
    if (!clear || (finish === undefined && !plate.plateRole)) continue
    candidates.push({ role: roomFinishRole(zone.id), finish, polygons: clear })
  }

  const claimed: MultiPolygon = []
  for (const candidate of candidates) {
    const clipped = intersection(candidate.polygons, remaining)
    const blockers = overlappingPolygons(claimed, clipped)
    const part = blockers.length ? difference(clipped, blockers) : clipped
    if (area(part) < MIN_CELL_AREA) continue
    cells.push({
      role: candidate.role,
      finish: candidate.finish,
      materialKey: plateFinishKey(candidate.finish),
      polygons: part,
    })
    claimed.push(...part)
  }
  if (claimed.length) remaining = difference(remaining, claimed)

  if (area(remaining) >= MIN_CELL_AREA) {
    cells.push({
      role: PLATE_SURFACE_ROLE,
      materialKey: plateFinishKey(undefined),
      polygons: remaining,
    })
  }
  return { cells, masked }
}

/**
 * Classify every edge interval, including wall-covered facade edges. Only a
 * covered step facing a lower floor is hidden; exterior slab thickness stays visible.
 */
const preparedLevels = new Map<string, ReturnType<typeof prepareLevel>>()

function levelInputs(context: PlateLevelContext) {
  const signature = JSON.stringify([
    wallSignature(context.walls),
    zoneSignature(context.zones),
    slabSignature(context.slabs),
    context.openings,
    Object.values(context.nodes ?? {}).filter(
      (node) => !['wall', 'zone', 'slab', 'door', 'window'].includes(node.type),
    ),
  ])
  const cached = preparedLevels.get(signature)
  if (cached) return cached
  return remember(preparedLevels, signature, prepareLevel(context))
}

function prepareLevel(context: PlateLevelContext) {
  const nodes = surfaceNodes(context)
  const miters = calculateLevelMiters(context.walls)
  const footprints = new Map(
    context.walls.map((wall) => [
      wall.id as string,
      getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
    ]),
  )
  const walls = context.walls.map((wall) => ({
    wall,
    polygon: union([footprints.get(wall.id)!]),
    get support() {
      return wallSupportForNodes(wall, nodes)
    },
  }))
  const openings = (context.openings ?? []).flatMap((opening) => {
    const wall = context.walls.find((wall) => wall.id === opening.parentId)
    if (!wall) return []
    const cut = getOpeningWallCut(wall, opening, nodes)
    return [{ opening, wall, aperture: cut.aperture, cut }]
  })
  const boundaries = [
    ...context.walls,
    ...Object.values(nodes).filter((node) => node.type === 'separator'),
  ]
  const faces = floorRoomFaces(boundaries)
  const rooms: PlateRoom[] = context.zones.flatMap((zone) => {
    const carried = roomFloorPlate(context.slabs, zone.id)
    if (!carried || carried.support === 'open' || zone.hasFloor === false) return []
    const face = faces
      .map((face) => ({
        face,
        overlap: area(
          intersection(zoneFace(zone), { outer: face.referencePolygon, holes: face.holes }),
        ),
      }))
      .sort((a, b) => b.overlap - a.overlap)[0]
    return face?.overlap
      ? [
          {
            ...face.face,
            id: zone.id,
            polygon: face.face.referencePolygon,
            zone,
            context: {
              revision: 0,
              walls: new Map(context.walls.map((w) => [w.id, w])),
              wallFootprints: footprints,
            },
          },
        ]
      : []
  })
  const landings = openingLandings(
    rooms,
    (room) => roomFloorPlate(context.slabs, room.zone.id)!.elevation,
    nodes,
    new Map(openings.map((entry) => [entry.opening.id, entry.aperture])),
  )
  return {
    nodes,
    footprints,
    walls,
    openings,
    rooms,
    landings,
    wallCover: levelWallCover(context.walls),
  }
}

export function plateOpeningLandings(context: PlateLevelContext) {
  return levelInputs(context).landings
}

function classifySides(
  plate: SlabNode,
  top: MultiPolygon,
  context: PlateLevelContext,
  prepared: ReturnType<typeof prepareLevel>,
): PlateSideInterval[] {
  const elevation = plate.elevation
  const bottom = elevation - plate.thickness
  const { nodes, rooms, landings } = prepared
  const nearby = (polygon: MultiPolygon) => overlappingPolygons(polygon, top, 0.03).length > 0
  const walls = prepared.walls.filter((entry) => nearby(entry.polygon))
  const openings = prepared.openings.filter((entry) => nearby(entry.aperture))
  const wallCover =
    walls.length === prepared.walls.length
      ? prepared.wallCover
      : union(walls.map((entry) => entry.polygon))
  const solids = context.slabs
    .filter((slab) => slab.id !== plate.id && slab.support !== 'open')
    .map((slab) => ({ slab, polygon: slabTop(slab) }))
    .filter((entry) => nearby(entry.polygon))
  const zones = context.zones
    .filter(
      (zone) =>
        zone.spaceRole === 'room' && zone.hasFloor !== false && zone.floor?.support !== 'open',
    )
    .map((zone) => ({
      zone,
      polygon: zoneFace(zone),
      elevation:
        roomFloorPlate(context.slabs, zone.id)?.elevation ?? zone.floor?.elevation ?? elevation,
    }))
  const nearbyZones = zones.filter((entry) => nearby(entry.polygon))
  const outlines = top.flatMap(({ outer, holes }) =>
    [outer, ...holes].map((outer) => ({ outer, holes: [] })),
  )
  const cuts = [
    ...nearbyZones.flatMap((z) => z.polygon),
    ...solids.flatMap((s) => s.polygon),
    ...openings.flatMap((o) => o.aperture),
  ]
  const result: PlateSideInterval[] = []
  for (const interval of exposedIntervals(outlines, context.walls, wallCover, {
    includeCovered: true,
    splitAt: cuts,
  })) {
    let { start, end } = interval
    let dx = end[0] - start[0],
      dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    if (length < 1e-7) continue
    const midpoint: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    if (
      containsPoint(top, [midpoint[0] + (dz / length) * 0.002, midpoint[1] - (dx / length) * 0.002])
    ) {
      ;[start, end] = [end, start]
      dx = -dx
      dz = -dz
    }
    const outside: [number, number] = [
      midpoint[0] + (dz / length) * 0.002,
      midpoint[1] - (dx / length) * 0.002,
    ]
    const inside: [number, number] = [
      midpoint[0] - (dz / length) * 0.002,
      midpoint[1] + (dx / length) * 0.002,
    ]
    if (
      plate.plateRole === 'base' &&
      solids.some(
        (solid) =>
          solid.slab.plateRole === 'base' &&
          Math.abs(solid.slab.elevation - elevation) < 0.001 - 1e-9 &&
          containsPoint(solid.polygon, outside),
      )
    ) {
      result.push({ start, end, role: 'hidden' })
      continue
    }
    const adjacent =
      plate.support === 'open'
        ? undefined
        : nearbyZones
            .filter(
              (z) => containsPoint(z.polygon, outside) && z.elevation <= elevation - 0.001 + 1e-9,
            )
            .sort((a, b) => b.elevation - a.elevation)[0]
    const neighbour =
      plate.support !== 'open'
        ? solids
            .filter(
              (s) =>
                containsPoint(s.polygon, outside) && s.slab.elevation <= elevation - 0.001 + 1e-9,
            )
            .sort((a, b) => b.slab.elevation - a.slab.elevation)[0]
        : undefined
    const low = neighbour
      ? Math.min(bottom, neighbour.slab.elevation)
      : context.platform && !plate.plateRole
        ? Math.min(0, bottom)
        : bottom
    const opening = openings.find((entry) => containsPoint(entry.aperture, midpoint))
    const landingOwner = opening
      ? landings.find((landing) => !landing.exterior && landing.openingId === opening.opening.id)
          ?.zoneId
      : undefined
    const spanOwner = rooms.find(
      (room) =>
        Math.abs(
          (roomFloorPlate(context.slabs, room.zone.id)?.elevation ?? elevation) - elevation,
        ) < 0.001 &&
        room.spans.some((span) => {
          const boundary = nodes[span.boundaryId]
          if (boundary?.type !== 'separator') return false
          const bx = boundary.end[0] - boundary.start[0],
            bz = boundary.end[1] - boundary.start[1],
            squared = bx * bx + bz * bz
          const t =
            ((midpoint[0] - boundary.start[0]) * bx + (midpoint[1] - boundary.start[1]) * bz) /
            squared
          const distance =
            Math.abs(
              (midpoint[0] - boundary.start[0]) * bz - (midpoint[1] - boundary.start[1]) * bx,
            ) / Math.sqrt(squared)
          const face =
            (inside[0] - midpoint[0]) * -bz + (inside[1] - midpoint[1]) * bx > 0 ? 'a' : 'b'
          return distance < 0.003 && t >= span.t0 && t <= span.t1 && face === span.face
        }),
    )?.zone.id
    const ownerId = plate.plateRole === 'base' ? (landingOwner ?? spanOwner) : plate.zoneIds?.[0]
    const blockers: Array<[number, number]> = []
    if (
      neighbour &&
      plate.plateRole === 'base' &&
      solids.some(
        (s) =>
          s.slab.plateRole === 'platform' &&
          containsPoint(s.polygon, inside) &&
          !containsPoint(s.polygon, outside),
      )
    )
      blockers.push([low, elevation])
    if (plate.support !== 'open') {
      for (const solid of solids)
        if (containsPoint(solid.polygon, outside))
          blockers.push([solid.slab.elevation - solid.slab.thickness, solid.slab.elevation])
      for (const entry of walls) {
        if (!containsPoint(entry.polygon, outside) && !containsPoint(entry.polygon, midpoint))
          continue
        const wall = entry.wall
        const t = getWallCurveStationAtPoint(wall, midpoint)
        const frame = getWallCurveFrameAt(wall, t)
        const face =
          (inside[0] - frame.point.x) * frame.normal.x +
            (inside[1] - frame.point.y) * frame.normal.y >
          0
            ? 'a'
            : 'b'
        const run = entry.support.faceBottom[face].find((run) => run.start <= t && run.end >= t)
        const wallBottom = run?.elevation ?? entry.support.elevation
        const aperture = openings.find(
          (o) => o.wall.id === wall.id && containsPoint(o.aperture, midpoint),
        )
        if (!aperture) blockers.push([wallBottom, Infinity])
        else {
          const cut = aperture.cut
          blockers.push([wallBottom, cut.bottom], [cut.top, Infinity])
        }
      }
    }
    let ranges: Array<[number, number]> = [[low, elevation]]
    for (const [lo, hi] of blockers)
      ranges = ranges.flatMap(([a, b]) =>
        hi <= a || lo >= b
          ? [[a, b]]
          : [
              ...(lo > a ? [[a, lo] as [number, number]] : []),
              ...(hi < b ? [[hi, b] as [number, number]] : []),
            ],
      )
    const role = adjacent || neighbour ? ('riser' as const) : ('edge' as const)
    const owner = role === 'riser' || plate.plateRole !== 'base' ? ownerId : undefined
    // A door jamb's side of the step meets the aperture only at its edge, so
    // the doorway is looked for on both sides of the face too.
    const doorway =
      opening ??
      openings.find(
        (entry) => containsPoint(entry.aperture, inside) || containsPoint(entry.aperture, outside),
      )
    const stepKey =
      owner && role === 'riser'
        ? (doorway?.opening.id ??
          adjacent?.zone.id ??
          neighbour?.slab.zoneIds?.[0] ??
          neighbour?.slab.id)
        : undefined
    if (!ranges.length) result.push({ start, end, role: 'hidden' })
    for (const [from, to] of ranges)
      if (to - from >= 0.001 - 1e-9)
        result.push({
          start,
          end,
          role,
          zoneId: owner,
          ...(stepKey ? { stepKey } : {}),
          bottom: from,
          top: to,
          ...(from < bottom - 0.001 ? { dropTo: from } : {}),
        })
  }
  return result
}

const partitionCache = new Map<string, PlateSurfacePartition>()

/**
 * The plate's top cells and side classification, memoised on
 * `platePartitionSignature`. Returns `null` for anything that is not an
 * unrecessed floor plate — manual slabs and pools keep the plain two-slot path.
 */
export function computePlateSurfacePartition(
  plate: SlabNode,
  context: PlateLevelContext,
): PlateSurfacePartition | null {
  if (!isFloorPlate(plate) || plate.recessed || plate.polygon.length < 3) return null
  const signature = platePartitionSignature(plate, context)
  const cached = partitionCache.get(signature)
  if (cached) return cached

  const top = slabTop(plate)
  if (!top.length) return null
  const wallCover = levelWallCover(context.walls)
  const prepared = levelInputs(context)
  const { cells, masked } = partitionTop(plate, top, context, wallCover, prepared)
  const sides = classifySides(plate, top, context, prepared)
  const partition: PlateSurfacePartition = {
    cells,
    masked,
    sides,
    plainTop:
      masked.length === 0 &&
      cells.length <= 1 &&
      (cells[0]?.role ?? PLATE_SURFACE_ROLE) === PLATE_SURFACE_ROLE,
  }
  return remember(partitionCache, signature, partition)
}

/**
 * The doorway keys of every step `zoneId` owns on its level — what the room
 * scope of a step paints. Reads the same memoised partitions the renderer does.
 */
export function floorStepKeysOf(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
  zoneId: string,
): string[] {
  const level = nodes[levelId]
  if (!level) return []
  const context = plateLevelContext(level, (id) => nodes[id])
  const keys = new Set<string>()
  for (const plate of context.slabs) {
    if (!isFloorPlate(plate)) continue
    const partition = computePlateSurfacePartition(plate, {
      ...context,
      platform: plate.plateRole === 'platform',
    })
    for (const side of partition?.sides ?? [])
      if (side.role === 'riser' && side.zoneId === zoneId && side.stepKey) keys.add(side.stepKey)
  }
  return [...keys].sort()
}

/** Test seam — drops every memo so a test can assert a rebuild is deterministic. */
export function clearPlateSurfaceCaches(): void {
  partitionCache.clear()
  preparedLevels.clear()
  wallCoverBySignature.clear()
}

/**
 * Role of a plate side face at a point on the plate outline.
 */
export function classifyPlateSideAt(
  partition: PlateSurfacePartition,
  point: readonly [number, number],
  tolerance = 1e-6,
): PlateSideRole {
  return plateSideAt(partition, point, tolerance)?.role ?? 'edge'
}

function plateSideAt(
  partition: PlateSurfacePartition,
  point: readonly [number, number],
  tolerance: number,
): PlateSideInterval | undefined {
  let bestDistance = tolerance
  let closest: PlateSideInterval | undefined
  for (const side of partition.sides) {
    const dx = side.end[0] - side.start[0]
    const dz = side.end[1] - side.start[1]
    const lengthSq = dx * dx + dz * dz
    if (lengthSq < 1e-18) continue
    const t = ((point[0] - side.start[0]) * dx + (point[1] - side.start[1]) * dz) / lengthSq
    if (t < -tolerance || t > 1 + tolerance) continue
    const clamped = Math.max(0, Math.min(1, t))
    const distance = Math.hypot(
      point[0] - (side.start[0] + dx * clamped),
      point[1] - (side.start[1] + dz * clamped),
    )
    if (distance <= bestDistance) {
      bestDistance = distance
      closest = side
    }
  }
  return closest
}

/**
 * Where the classification changes along one plate outline segment, as
 * parameters in `[0, 1]` of that segment. A side quad is cut at these stations
 * so a single edge can be exterior for part of its length and a step for the
 * rest.
 */
export function plateSideRuns(
  partition: PlateSurfacePartition,
  start: readonly [number, number],
  end: readonly [number, number],
): Array<{ t0: number; t1: number; role: PlateSideRole; dropTo?: number; zoneId?: string }> {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq < 1e-18) return [{ t0: 0, t1: 1, role: 'edge' }]

  const stations = new Set([0, 1])
  for (const side of partition.sides) {
    for (const point of [side.start, side.end]) {
      const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq
      if (t > 1e-9 && t < 1 - 1e-9) stations.add(t)
    }
  }
  const ordered = [...stations].sort((a, b) => a - b)
  const runs: Array<{
    t0: number
    t1: number
    role: PlateSideRole
    dropTo?: number
    zoneId?: string
  }> = []
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const t0 = ordered[index]!
    const t1 = ordered[index + 1]!
    if (t1 - t0 < 1e-9) continue
    const mid = (t0 + t1) / 2
    const side = plateSideAt(
      partition,
      [start[0] + dx * mid, start[1] + dz * mid],
      Math.max(1e-6, Math.hypot(dx, dz) * 1e-4),
    )
    const role = side?.role ?? 'edge'
    const dropTo = side?.dropTo
    const previous = runs.at(-1)
    if (previous?.role === role && previous.dropTo === dropTo && previous.zoneId === side?.zoneId)
      previous.t1 = t1
    else
      runs.push({
        t0,
        t1,
        role,
        ...(dropTo === undefined ? {} : { dropTo }),
        ...(side?.zoneId ? { zoneId: side.zoneId } : {}),
      })
  }
  return runs.length ? runs : [{ t0: 0, t1: 1, role: 'edge' }]
}
