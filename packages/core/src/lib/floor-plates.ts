import type { AnyNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION, SlabNode } from '../schema/nodes/slab'
import type { SurfaceHoleMetadata } from '../schema/nodes/surface-hole-metadata'
import type { ZoneNode } from '../schema/nodes/zone'
import { stairArrivalOpening } from '../systems/stair/stair-footprint'
import { omitUndefined } from '../utils/omit-undefined'
import {
  automaticFloorHeight,
  floorPlateHoldsUnderside,
  footprintLift,
} from './floor-foundation-datum'
import { floorOpeningFootprints } from './floor-opening-footprints'
import { type FloorOpeningIndex, openingsForSurface } from './floor-opening-intent'
import { comparePlateComponents, keyedFloorPlateId } from './floor-plate-id'
import {
  exposedIntervals,
  plateFootprint,
  roomClearPolygon,
  roomWallFootprints,
} from './level-footprints'
import { area, difference, intersection, type Polygon, union } from './polygon-boolean'
import type { TopologyRoom } from './room-topology-index'
import { autoRoomVerticalPlacements } from './room-vertical-placement'
import { getRenderableSlabPolygon } from './slab-polygon'

export type PlateRoom = TopologyRoom & { zone: ZoneNode }

// Migration validates construction without interpreting historical material payloads.
export function parseSlabConstruction(source: SlabNode): SlabNode {
  const { material, slots, ...construction } = source
  return omitUndefined({
    ...SlabNode.parse(construction),
    ...(material === undefined ? {} : { material }),
    ...(slots === undefined ? {} : { slots }),
  })
}

export function slabFootprint(
  node: Pick<SlabNode, 'polygon'> & { holes?: SlabNode['holes'] },
): Polygon {
  return { outer: node.polygon, holes: node.holes ?? [] }
}

type PreparedFootprint = {
  signature: string
  polygon: Polygon
  bounds: readonly [number, number, number, number]
  normalized?: Polygon[]
  area?: number
}

const footprintCache = new Map<string, Map<string, PreparedFootprint>>()
const footprintObjects = new WeakMap<object, WeakMap<object, PreparedFootprint>>()
const overlapCache = new WeakMap<PreparedFootprint, WeakMap<PreparedFootprint, number>>()

function prepareFootprint(polygon: Polygon, levelId = ''): PreparedFootprint {
  const objectCache = footprintObjects.get(polygon.outer)
  const byObject = objectCache?.get(polygon.holes)
  if (byObject) return byObject
  const signature = JSON.stringify([polygon.outer, polygon.holes])
  let level = footprintCache.get(levelId)
  if (!level) {
    if (footprintCache.size >= 32) footprintCache.delete(footprintCache.keys().next().value!)
    level = new Map()
    footprintCache.set(levelId, level)
  }
  const cached = level.get(signature)
  if (cached) {
    const cache = objectCache ?? new WeakMap<object, PreparedFootprint>()
    cache.set(polygon.holes, cached)
    if (!objectCache) footprintObjects.set(polygon.outer, cache)
    return cached
  }
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity
  for (const [x, z] of polygon.outer) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  const prepared = { signature, polygon, bounds: [minX, minZ, maxX, maxZ] } as PreparedFootprint
  if (level.size >= 512) level.delete(level.keys().next().value!)
  level.set(signature, prepared)
  const cache = objectCache ?? new WeakMap<object, PreparedFootprint>()
  cache.set(polygon.holes, prepared)
  if (!objectCache) footprintObjects.set(polygon.outer, cache)
  return prepared
}

function boundsOverlap(a: PreparedFootprint, b: PreparedFootprint) {
  const left = a.bounds,
    right = b.bounds
  return left[2] > right[0] && right[2] > left[0] && left[3] > right[1] && right[3] > left[1]
}

function normalizedFootprint(footprint: PreparedFootprint) {
  if (!footprint.normalized) {
    footprint.normalized = union([footprint.polygon])
    footprint.area = area(footprint.normalized)
  }
  return footprint.normalized
}

function preparedIoU(a: PreparedFootprint, b: PreparedFootprint) {
  if (!boundsOverlap(a, b)) return 0
  if (a.signature === b.signature) return area([a.polygon]) > 0 ? 1 : 0
  const cached = overlapCache.get(a)?.get(b)
  if (cached !== undefined) return cached
  const left = normalizedFootprint(a),
    right = normalizedFootprint(b)
  const overlap = area(intersection(left, right))
  const combined = a.area! + b.area! - overlap
  const iou = combined > 0 ? overlap / combined : 0
  let neighbors = overlapCache.get(a)
  if (!neighbors) {
    neighbors = new WeakMap()
    overlapCache.set(a, neighbors)
  }
  neighbors.set(b, iou)
  return iou
}

export function footprintIoU(a: Polygon, b: Polygon) {
  const bounds = (polygon: Polygon) => {
    const xs = polygon.outer.map((p) => p[0]),
      zs = polygon.outer.map((p) => p[1])
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as const
  }
  const ab = bounds(a),
    bb = bounds(b)
  if (ab[2] <= bb[0] || bb[2] <= ab[0] || ab[3] <= bb[1] || bb[3] <= ab[1]) return 0
  const left = union([a]),
    right = union([b])
  const overlap = area(intersection(left, right))
  const combined = area(left) + area(right) - overlap
  return combined > 0 ? overlap / combined : 0
}

function construction(slab?: SlabNode) {
  return {
    thickness: slab?.thickness ?? 0.05,
    recessed: slab?.recessed ?? false,
    fillToTerrain: slab?.fillToTerrain ?? false,
  }
}

export function buildFloorPlates({
  rooms,
  slabs,
  levelId,
  mintId,
  retiredZones = new Map(),
  nodes,
  additionalHoles = [],
  openingIndex,
  renderedManualCuts = true,
}: {
  rooms: PlateRoom[]
  slabs: SlabNode[]
  levelId: string
  mintId: (zoneIds: string[], component?: number, role?: string) => string
  retiredZones?: ReadonlyMap<string, string>
  nodes?: Readonly<Record<string, AnyNode>>
  additionalHoles?: SlabNode[]
  openingIndex?: FloorOpeningIndex
  renderedManualCuts?: boolean
}) {
  const existing = slabs
    .filter((slab) => slab.boundary === 'auto' || slab.autoFromWalls)
    .sort((a, b) => a.id.localeCompare(b.id))
  const footprints = new Map(
    existing.map((slab) => [slab.id, prepareFootprint(slabFootprint(slab), levelId)]),
  )
  const footprintOf = (slab: SlabNode) =>
    footprints.get(slab.id) ?? prepareFootprint(slabFootprint(slab), levelId)
  const matchingFootprints = new Map(
    existing.map((slab) => [
      slab.id,
      prepareFootprint(
        {
          outer: slab.polygon,
          holes: slab.holes.filter((_, i) => slab.holeMetadata[i]?.source === 'room'),
        },
        levelId,
      ),
    ]),
  )
  const zoneIdCache = new WeakMap<SlabNode, string[]>()
  const sourceIds = (slab: SlabNode) => {
    let ids = zoneIdCache.get(slab)
    if (!ids) {
      ids = (slab.zoneIds ?? []).map((id) => retiredZones.get(id) ?? id)
      zoneIdCache.set(slab, ids)
    }
    return ids
  }
  const eligible = rooms
    .filter(
      (room) =>
        room.zone.spaceRole === 'room' &&
        room.zone.enclosureStatus !== 'open' &&
        room.zone.hasFloor !== false &&
        (room.zone.floor?.support === 'open' ||
          !slabs.some(
            (slab) =>
              slab.id === room.zone.floor?.sourceSlabId &&
              area(intersection(slabFootprint(room), slabFootprint(slab))) > 1e-4,
          )),
    )
    .sort((a, b) => a.zone.id.localeCompare(b.zone.id))
  const sources = new Map(
    eligible.map((room) => {
      const face = slabFootprint(room)
      const roomFootprint = prepareFootprint(face, levelId)
      const candidates = existing
        .filter(
          (slab) =>
            slab.support === room.zone.floor?.support &&
            (slab.plateRole !== 'base' ||
              !existing.some(
                (other) =>
                  other.plateRole &&
                  other.plateRole !== 'base' &&
                  sourceIds(other).includes(room.zone.id),
              )) &&
            (slab.support !== 'open' || sourceIds(slab).includes(room.zone.id)),
        )
        .map((slab) => ({
          slab,
          linked: sourceIds(slab).includes(room.zone.id),
          iou: preparedIoU(footprintOf(slab), roomFootprint),
        }))
        .filter(({ linked, iou }) => linked || iou > 0)
        .sort(
          (a, b) =>
            Number(b.linked) - Number(a.linked) ||
            b.iou - a.iou ||
            a.slab.id.localeCompare(b.slab.id),
        )
      return [room.zone.id, candidates[0]?.slab]
    }),
  )
  const derived = nodes ? autoRoomVerticalPlacements(eligible, nodes) : new Map<string, number>()
  const intent = new Map(eligible.map((room) => [room.zone.id, room.zone.floor?.elevation]))
  const grounded = eligible.filter((room) => room.zone.floor?.support !== 'open')
  const ownRooms = grounded.filter((room) => !!room.zone.floor?.footprint)
  const sharedRooms = grounded.filter((room) => !room.zone.floor?.footprint)
  const keyedSources = new Map<string, SlabNode[]>()
  const keyedPlateIds = new Set<string>()
  for (const key of new Set(ownRooms.map((room) => room.zone.floor!.footprint!))) {
    const ids = new Set(
      Array.from({ length: existing.length + 1 }, (_, i) => keyedFloorPlateId(levelId, key, i)),
    )
    const sources = existing.filter((plate) => plate.plateRole === 'base' && ids.has(plate.id))
    keyedSources.set(key, sources)
    for (const source of sources) keyedPlateIds.add(source.id)
  }
  const ownSource = (room: PlateRoom) => keyedSources.get(room.zone.floor!.footprint!)?.[0]
  const inheritedSource = (room: PlateRoom) =>
    existing
      .filter((slab) => slab.plateRole === 'base')
      .map((slab) => ({
        slab,
        overlap: area(intersection(slabFootprint(slab), slabFootprint(room))),
      }))
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || a.slab.id.localeCompare(b.slab.id))[0]?.slab
  const ownHeight = (room: PlateRoom) => {
    const source = ownSource(room)
    return (
      source?.floorHeight ??
      (source && nodes && !floorPlateHoldsUnderside(nodes, source)
        ? automaticFloorHeight(nodes, source)
        : source?.elevation) ??
      room.zone.floor?.elevation ??
      inheritedSource(room)?.elevation ??
      derived.get(room.zone.id) ??
      DEFAULT_SLAB_ELEVATION
    )
  }
  const wallOwners = new Map<string, string | undefined>()
  for (const room of [
    ...sharedRooms,
    ...ownRooms
      .slice()
      .sort(
        (a, b) =>
          ownHeight(b) - ownHeight(a) ||
          a.zone.floor!.footprint!.localeCompare(b.zone.floor!.footprint!),
      ),
  ])
    for (const span of room.spans)
      if (span.kind === 'wall' && !wallOwners.has(span.boundaryId))
        wallOwners.set(span.boundaryId, room.zone.floor?.footprint)
  const partitions = ownRooms.length
    ? [
        sharedRooms,
        ...[...new Set(ownRooms.map((room) => room.zone.floor!.footprint!))]
          .sort()
          .map((key) => ownRooms.filter((room) => room.zone.floor!.footprint === key)),
      ].filter((group) => group.length)
    : [grounded]
  const components = partitions
    .flatMap((group) => {
      const own = group[0]?.zone.floor?.footprint ? group[0] : undefined
      const excludedWalls = ownRooms.length
        ? [...wallOwners].flatMap(([id, owner]) => {
            const polygon = group[0]?.context.wallFootprints.get(id)
            return owner !== own?.zone.floor?.footprint && polygon ? [polygon] : []
          })
        : []
      const outline = ownRooms.length
        ? union([
            plateFootprint(group),
            ...[...wallOwners].flatMap(([id, owner]) => {
              const polygon = group[0]?.context.wallFootprints.get(id)
              return owner === own?.zone.floor?.footprint && polygon ? [polygon] : []
            }),
          ])
        : plateFootprint(group)
      return (excludedWalls.length ? difference(outline, union(excludedWalls)) : union([outline]))
        .sort(comparePlateComponents)
        .map((footprint) => ({ footprint, group, own }))
    })
    .flatMap(
      ({
        footprint,
        group,
        own,
      }): Array<{ footprint: Polygon; group: PlateRoom[]; own: PlateRoom | undefined }> => {
        if (own) return [{ footprint, group, own }]
        const owners = existing.filter(
          (slab) =>
            slab.plateRole === 'base' &&
            !keyedPlateIds.has(slab.id) &&
            (!ownRooms.length ||
              sourceIds(slab).some((id) => sharedRooms.some((room) => room.zone.id === id))) &&
            slab.support !== 'open' &&
            boundsOverlap(footprintOf(slab), prepareFootprint(footprint, levelId)) &&
            area(intersection(slabFootprint(slab), footprint)) > 1e-6,
        )
        if (new Set(owners.map((slab) => String(slab.referenceFloorElevation))).size <= 1)
          return [{ footprint, group, own }]
        let remaining: Polygon[] = [footprint]
        const domains: Polygon[] = []
        for (const owner of owners.sort((a, b) => a.id.localeCompare(b.id))) {
          const claimed = intersection(remaining, slabFootprint(owner))
          domains.push(...claimed)
          remaining = difference(remaining, slabFootprint(owner))
        }
        return [...domains, ...remaining]
          .sort(comparePlateComponents)
          .map((footprint) => ({ footprint, group, own }))
      },
    )
    .filter(
      ({ footprint, group, own }) =>
        !own || group.some((room) => area(intersection(slabFootprint(room), footprint)) > 1e-6),
    )
    .map(({ footprint, group, own }) => {
      const members = group.filter((room) => area(intersection(slabFootprint(room), footprint)) > 0)
      let source =
        (own ? ownSource(own) : undefined) ??
        existing
          .filter(
            (slab) =>
              slab.support !== 'open' &&
              (!slab.plateRole || slab.plateRole === 'base') &&
              (own ||
                (!keyedPlateIds.has(slab.id) &&
                  (!ownRooms.length ||
                    sourceIds(slab).some((id) =>
                      sharedRooms.some((room) => room.zone.id === id),
                    )))),
          )
          .map((slab) => ({
            slab,
            overlap: boundsOverlap(footprintOf(slab), prepareFootprint(footprint, levelId))
              ? area(intersection(slabFootprint(slab), footprint))
              : 0,
          }))
          .filter((entry) => entry.overlap > 0)
          .sort((a, b) => b.overlap - a.overlap || a.slab.id.localeCompare(b.slab.id))[0]?.slab
      if (own && !ownSource(own)) {
        const elevation = ownHeight(own)
        source = source
          ? {
              ...source,
              ...(!ownSource(own) ? { name: 'Floor plate' } : {}),
              floorHeight: elevation,
              thickness:
                nodes &&
                floorPlateHoldsUnderside(nodes, {
                  ...source,
                  polygon: footprint.outer,
                  holes: footprint.holes,
                })
                  ? source.thickness + elevation - source.elevation
                  : source.thickness,
              referenceFloorElevation: elevation - (nodes ? footprintLift(nodes, source) : 0),
            }
          : undefined
      }
      const elevation =
        (own ? ownHeight(own) : undefined) ??
        source?.floorHeight ??
        (source?.plateRole === 'base' && nodes && floorPlateHoldsUnderside(nodes, source)
          ? source.elevation
          : undefined) ??
        source?.referenceFloorElevation ??
        (members.length
          ? Math.max(...members.map((room) => derived.get(room.zone.id) ?? DEFAULT_SLAB_ELEVATION))
          : DEFAULT_SLAB_ELEVATION)
      const holdsUnderside =
        !!nodes &&
        floorPlateHoldsUnderside(nodes, {
          ...source,
          parentId: levelId,
          polygon: footprint.outer,
          holes: footprint.holes,
        } as SlabNode)
      return { footprint, members, source, elevation, own, holdsUnderside }
    })
  const componentOf = (room: PlateRoom) =>
    components.find((component) => component.members.includes(room))
  const baseOf = (room: PlateRoom) => componentOf(room)?.elevation ?? DEFAULT_SLAB_ELEVATION
  const elevationOf = (room: PlateRoom) => intent.get(room.zone.id) ?? baseOf(room)
  const thresholds = floorOpeningFootprints(grounded, elevationOf, nodes ?? {})
  const interiors = new Map(
    grounded.map((room) => [
      room.zone.id,
      union([
        Math.abs(elevationOf(room) - baseOf(room)) >= 0.001 - 1e-9 ? roomClearPolygon(room) : [],
        ...(thresholds.get(room.zone.id) ?? []),
      ]),
    ]),
  )
  const baseSource =
    existing
      .filter((slab) => slab.plateRole === 'base')
      .sort(
        (a, b) => area([slabFootprint(b)]) - area([slabFootprint(a)]) || a.id.localeCompare(b.id),
      )[0] ??
    existing.find(
      (slab) =>
        slab.support !== 'open' && Math.abs(slab.elevation - DEFAULT_SLAB_ELEVATION) < 0.001,
    ) ??
    (grounded[0] ? sources.get(grounded[0].zone.id) : undefined)
  const baseConstruction = construction(
    baseSource?.plateRole === 'platform' ? undefined : baseSource,
  )
  const supported = (room: PlateRoom) => {
    const component = componentOf(room)
    return (
      !!nodes &&
      !!component &&
      floorPlateHoldsUnderside(
        nodes,
        (component.source ?? {
          id: `slab_support_probe_${levelId}`,
          parentId: levelId,
          polygon: component.footprint.outer,
        }) as SlabNode,
      )
    )
  }
  const definitions = [
    ...components.map((component) => ({
      members: component.members,
      template: component.source,
      footprints: difference(
        component.own
          ? union([
              component.footprint,
              ...component.members.flatMap((room) => thresholds.get(room.zone.id) ?? []),
            ])
          : component.footprint,
        union([
          ...(ownRooms.length
            ? grounded
                .filter(
                  (room) =>
                    !component.members.includes(room) &&
                    elevationOf(room) >= component.elevation - 1e-9,
                )
                .flatMap((room) => thresholds.get(room.zone.id) ?? [])
            : []),
          ...component.members
            .filter((room) => elevationOf(room) <= component.elevation - 0.001 + 1e-9)
            .flatMap((room) => interiors.get(room.zone.id)!),
        ]),
      ),
      elevation: component.elevation,
      floorHeight: component.own
        ? component.holdsUnderside
          ? undefined
          : component.elevation
        : component.source?.floorHeight,
      referenceFloorElevation: component.source?.referenceFloorElevation,
      foundation:
        component.own &&
        (component.holdsUnderside ||
          component.elevation <=
            Math.max(
              ...component.members.map(
                (room) => derived.get(room.zone.id) ?? DEFAULT_SLAB_ELEVATION,
              ),
            ) -
              DEFAULT_SLAB_ELEVATION +
              0.001)
          ? {
              ...(component.holdsUnderside ? {} : component.source?.foundation),
              type: 'none' as const,
            }
          : (component.source?.foundation ?? {
              type: component.source?.fillToTerrain ? ('solid' as const) : ('none' as const),
              ...(component.source?.fillToTerrain
                ? {
                    material:
                      component.source.slots?.edge ?? component.source.slots?.side ?? '#cccccc',
                  }
                : {}),
            }),
      construction: {
        ...construction(component.source),
        fillToTerrain: undefined,
      },
      plateRole: 'base' as const,
      support: undefined,
    })),
    ...eligible.flatMap((room) => {
      const open = room.zone.floor?.support === 'open'
      const baseElevation = baseOf(room)
      const elevation = open
        ? (intent.get(room.zone.id) ?? derived.get(room.zone.id) ?? DEFAULT_SLAB_ELEVATION)
        : elevationOf(room)
      if (!open && Math.abs(elevation - baseElevation) < 0.001 - 1e-9) return []
      const baseThickness = construction(componentOf(room)?.source).thickness
      return [
        {
          members: [room],
          template: undefined,
          floorHeight: undefined,
          referenceFloorElevation: undefined,
          foundation: undefined,
          footprints: open ? [slabFootprint(room)] : interiors.get(room.zone.id)!,
          elevation,
          construction: open
            ? {
                thickness: room.zone.floor?.thickness ?? 0.2,
                recessed: false,
                fillToTerrain: false,
              }
            : {
                thickness:
                  elevation > baseElevation
                    ? elevation - baseElevation
                    : supported(room) && baseElevation - elevation <= baseThickness - 0.02 + 1e-9
                      ? baseThickness - (baseElevation - elevation)
                      : baseThickness,
                recessed: false,
                fillToTerrain: false,
              },
          plateRole: open
            ? undefined
            : elevation > baseElevation
              ? ('platform' as const)
              : ('sunken' as const),
          support: open ? ('open' as const) : undefined,
        },
      ]
    }),
  ]
  const openings = nodes ? openingsForSurface(nodes, levelId, 'floor', openingIndex) : []
  const dynamicOpenings = openings.filter((opening) => !opening.legacyPlateCuts)
  const openingFootprints = new Map(
    dynamicOpenings.map((opening) => [
      opening.id,
      prepareFootprint({ outer: opening.polygon, holes: [] }, levelId),
    ]),
  )
  const wallFootprints = dynamicOpenings.length
    ? [...new Set(eligible.flatMap((room) => [...room.context.wallFootprints.values()]))].map(
        (outer) => prepareFootprint({ outer, holes: [] }, levelId),
      )
    : []
  const openingCuts = new Map(
    dynamicOpenings.map((opening) => {
      const footprint = openingFootprints.get(opening.id)!
      const walls = wallFootprints
        .filter((wall) => boundsOverlap(footprint, wall))
        .map((wall) => wall.polygon)
      return [
        opening.id,
        walls.length
          ? difference(opening.polygon, union(walls))
          : [{ outer: opening.polygon, holes: [] }],
      ] as const
    }),
  )
  const cutsFor = (members: PlateRoom[], support: 'open' | undefined) =>
    dynamicOpenings.filter((opening) =>
      opening.hostZoneId
        ? support === 'open' && members.some((room) => room.zone.id === opening.hostZoneId)
        : support !== 'open',
    )
  const authoredVolumes: Array<{ top: number; bottom: number; footprint: Polygon }> = []
  for (const slab of slabs) {
    if (
      slab.boundary === 'auto' ||
      slab.autoFromWalls ||
      slab.support === 'open' ||
      !(
        slab.associatedZoneIds !== undefined ||
        rooms.some((room) => room.zone.floor?.sourceSlabId === slab.id)
      )
    )
      continue
    authoredVolumes.push({
      top: slab.elevation,
      bottom: slab.elevation - slab.thickness,
      footprint: {
        outer: renderedManualCuts
          ? getRenderableSlabPolygon(slab, {
              walls: [...(rooms[0]?.context.walls.values() ?? [])],
              siblingSlabs: slabs.filter((other) => other.id !== slab.id),
            })
          : slab.polygon,
        holes: slab.holes,
      },
    })
  }
  let baseComponent = 0
  const ownComponents = new Map<string, number>()
  const nextBaseComponent = (members: PlateRoom[]) => {
    const own = members.find((room) => !!room.zone.floor?.footprint)
    if (!own) return baseComponent++
    const index = ownComponents.get(own.zone.floor!.footprint!) ?? 0
    ownComponents.set(own.zone.floor!.footprint!, index + 1)
    return index
  }
  const planned = definitions.flatMap(({ footprints, ...definition }) =>
    footprints
      .flatMap((footprint) => {
        const prepared = prepareFootprint(footprint, levelId)
        const cuts = cutsFor(definition.members, definition.support).flatMap((opening) =>
          boundsOverlap(prepared, openingFootprints.get(opening.id)!)
            ? (openingCuts.get(opening.id) ?? []).filter((cut) =>
                boundsOverlap(prepared, prepareFootprint(cut, levelId)),
              )
            : [],
        )
        const occupied = authoredVolumes
          .filter(
            (volume) =>
              volume.top >= definition.elevation - 1e-6 &&
              volume.bottom < definition.elevation - 1e-6,
          )
          .map((volume) => volume.footprint)
        return cuts.length || occupied.length
          ? difference(footprint, union([...cuts, ...occupied]))
          : [footprint]
      })
      .sort(comparePlateComponents)
      .map((footprint, component) => ({
        component:
          definition.plateRole === 'base' ? nextBaseComponent(definition.members) : component,
        ...definition,
        footprint,
        zoneIds: definition.members
          .filter(
            (room) =>
              definition.plateRole === 'base' ||
              area(intersection(slabFootprint(room), footprint)) > 0 ||
              area(intersection(roomWallFootprints([room]), footprint)) > 0,
          )
          .map((room) => room.zone.id),
      })),
  )
  const compatible = (slab: SlabNode, group: (typeof planned)[number]) =>
    slab.support === group.support &&
    (group.plateRole !== 'base' ||
      group.members[0]?.zone.floor?.footprint ||
      !keyedPlateIds.has(slab.id)) &&
    (group.plateRole !== 'base' ||
      !group.members.some((room) => !!room.zone.floor?.footprint) ||
      slab.id ===
        keyedFloorPlateId(levelId, group.members[0]!.zone.floor!.footprint!, group.component)) &&
    (!slab.plateRole || (slab.plateRole === 'base') === (group.plateRole === 'base')) &&
    (group.support !== 'open' ||
      sourceIds(slab).some((id) => group.zoneIds.includes(id as ZoneNode['id'])))
  const groupFootprints = planned.map((group) => prepareFootprint(group.footprint, levelId))
  const groupZones = planned.map((group) => new Set<string>(group.zoneIds))
  const score = (slab: SlabNode, group: (typeof planned)[number], index: number) => {
    const zones = sourceIds(slab)
    const overlap = zones.filter((id) => groupZones[index]!.has(id)).length
    const slabFoot = matchingFootprints.get(slab.id) ?? footprintOf(slab),
      groupFoot = groupFootprints[index]!
    return {
      overlap,
      iou:
        overlap === zones.length &&
        zones.length === groupZones[index]!.size &&
        slabFoot.signature === groupFoot.signature
          ? 1
          : preparedIoU(slabFoot, groupFoot),
    }
  }
  const pairs = planned
    .flatMap((group, index) =>
      existing
        .filter((slab) => compatible(slab, group))
        .map((slab) => ({
          slab,
          index,
          ...score(slab, group, index),
          adoptionArea: !slab.plateRole
            ? boundsOverlap(footprintOf(slab), groupFootprints[index]!)
              ? area(
                  intersection(
                    slabFootprint(slab),
                    union(
                      group.members
                        .filter(
                          (room) =>
                            group.plateRole !== 'base' ||
                            Math.abs(elevationOf(room) - baseOf(room)) < 0.005,
                        )
                        .map(slabFootprint),
                    ),
                  ),
                )
              : 0
            : 0,
        }))
        .filter(
          ({ slab, overlap, iou }) =>
            overlap > 0 ||
            iou > 0 ||
            (group.plateRole === 'base' &&
              !!group.members[0]?.zone.floor?.footprint &&
              slab.id ===
                keyedFloorPlateId(levelId, group.members[0].zone.floor.footprint, group.component)),
        ),
    )
    .sort(
      (a, b) =>
        b.adoptionArea - a.adoptionArea ||
        b.overlap - a.overlap ||
        b.iou - a.iou ||
        a.slab.id.localeCompare(b.slab.id) ||
        a.index - b.index,
    )
  const matches = new Map<number, SlabNode>()
  const used = new Set<string>()
  for (const { index, slab } of pairs) {
    if (matches.has(index) || used.has(slab.id)) continue
    matches.set(index, slab)
    used.add(slab.id)
  }
  const plates = planned.map((group, index) => {
    const matched = matches.get(index)
    if (!group.zoneIds.length) group.zoneIds = group.members.map((room) => room.zone.id)
    const template =
      matched ?? (group.plateRole === 'base' ? group.template : sources.get(group.zoneIds[0]!))
    const plate = parseSlabConstruction({
      ...template,
      ...group.construction,
      ...(group.plateRole === 'base' &&
      matched?.plateRole === 'base' &&
      !group.members.some((room) => !!room.zone.floor?.footprint && !ownSource(room))
        ? construction(matched)
        : {}),
      id:
        group.plateRole === 'base' && group.members[0]?.zone.floor?.footprint
          ? keyedFloorPlateId(levelId, group.members[0].zone.floor.footprint, group.component)
          : (matched?.id ?? mintId(group.zoneIds, group.component, group.plateRole ?? 'open')),
      parentId: levelId,
      name: template?.name ?? 'Floor plate',
      boundary: 'auto',
      autoFromWalls: true,
      zoneIds: group.zoneIds,
      support: group.support,
      plateRole: group.plateRole,
      railing: undefined,
      floorHeight: group.floorHeight,
      referenceFloorElevation: group.referenceFloorElevation,
      foundation: group.foundation,
      ...(group.plateRole === 'base' ? { fillToTerrain: undefined } : {}),
      slots: group.plateRole && group.plateRole !== 'base' ? undefined : template?.slots,
      elevation: group.elevation,
      polygon: group.footprint.outer,
      holes: group.footprint.holes,
      holeMetadata: group.footprint.holes.map((hole) => {
        const holeFootprint = prepareFootprint({ outer: hole, holes: [] }, levelId)
        const opening = cutsFor(group.members, group.support).find(
          (candidate) =>
            boundsOverlap(holeFootprint, openingFootprints.get(candidate.id)!) &&
            (openingCuts.get(candidate.id) ?? []).some(
              (cut) =>
                boundsOverlap(holeFootprint, prepareFootprint(cut, levelId)) &&
                area(intersection(hole, cut)) > 1e-6,
            ),
        )
        return opening
          ? { source: 'floor-opening' as const, openingId: opening.id }
          : { source: 'room' as const }
      }),
    } as SlabNode)
    const unchangedMatchedFootprint =
      !!matched?.plateRole &&
      matchingFootprints.get(matched.id)?.signature === groupFootprints[index]?.signature
    if (unchangedMatchedFootprint)
      for (const [i, hole] of matched.holes.entries()) {
        const metadata = matched.holeMetadata[i] ?? { source: 'manual' as const }
        if (metadata.source === 'room' || metadata.source === 'floor-opening') continue
        plate.holes.push(hole)
        plate.holeMetadata.push(metadata)
      }
    const authoredHoles = new Map<string, { metadata: SurfaceHoleMetadata; polygons: Polygon[] }>()
    for (const source of [...existing, ...additionalHoles]) {
      const matchedSibling = !!matched?.plateRole && source.id !== matched.id && used.has(source.id)
      if (source.support !== group.support) continue
      const { overlap, iou } = score(source, group, index)
      if (!(overlap || iou)) continue
      if (unchangedMatchedFootprint && source.id === matched?.id) continue
      for (const [i, hole] of source.holes.entries()) {
        const metadata = source.holeMetadata[i] ?? { source: 'manual' as const }
        if (metadata.source === 'room' || metadata.source === 'floor-opening') continue
        if (matchedSibling && metadata.source === 'manual') continue
        const key = JSON.stringify(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)))
        const entry = authoredHoles.get(key) ?? { metadata, polygons: [] }
        // A retained cut-out is authored data; clipping it again changes ensured
        // stair/elevator holes and can duplicate them on every load.
        if (source.id === matched?.id) entry.polygons.push({ outer: hole, holes: [] })
        else if (
          !(
            matched?.plateRole &&
            metadata.source !== 'manual' &&
            matched.holeMetadata.some(
              (own) =>
                JSON.stringify(Object.entries(own).sort(([a], [b]) => a.localeCompare(b))) === key,
            )
          )
        )
          entry.polygons.push(...intersection(hole, group.footprint))
        authoredHoles.set(key, entry)
      }
    }
    const holeKey = (hole: SlabNode['holes'][number], metadata: SurfaceHoleMetadata) =>
      JSON.stringify([hole, Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b))])
    const retainedHoleKeys = new Set(
      plate.holes.map((hole, i) => holeKey(hole, plate.holeMetadata[i]!)),
    )
    for (const { metadata, polygons } of authoredHoles.values()) {
      for (const part of union(polygons)) {
        const key = holeKey(part.outer, metadata)
        if (retainedHoleKeys.has(key)) continue
        retainedHoleKeys.add(key)
        plate.holes.push(part.outer)
        plate.holeMetadata.push(metadata)
      }
    }
    if (matched)
      for (const opening of openings) {
        const legacyCuts = opening.legacyPlateCuts?.[matched.id]
        if (!legacyCuts) continue
        const metadata = { source: 'floor-opening' as const, openingId: opening.id }
        for (const hole of legacyCuts) {
          const key = holeKey(hole, metadata)
          if (retainedHoleKeys.has(key)) continue
          plate.holes.push(hole)
          plate.holeMetadata.push(metadata)
          retainedHoleKeys.add(key)
        }
      }
    if (group.support === 'open') {
      const context = group.members[0]!.context
      const arrivals = Object.values(nodes ?? {})
        .flatMap((node) =>
          node.type === 'stair' && node.deckSlabId === plate.id && node.visible !== false
            ? [stairArrivalOpening(node, nodes!)]
            : [],
        )
        .filter((ring) => ring.length >= 3)
      const cover = union([...context.wallFootprints.values(), ...arrivals])
      const surface = difference(plate.polygon, union(plate.holes))
      plate.railing = exposedIntervals(surface, context, cover).map(({ start, end }) => ({
        start,
        end,
      }))
    }
    if (plate.plateRole === 'base') delete (plate as Partial<SlabNode>).fillToTerrain
    return omitUndefined(plate)
  })
  const plateIds = new Set(plates.map((plate) => plate.id))
  const retired = existing.filter((slab) => !used.has(slab.id) && !plateIds.has(slab.id))
  const remap = new Map<string, string | undefined>()
  for (const slab of retired) {
    const best = planned
      .flatMap((group, index) =>
        slab.support === group.support ? [{ index, ...score(slab, group, index) }] : [],
      )
      .filter(({ overlap, iou }) => overlap > 0 || iou > 0)
      .sort((a, b) => b.overlap - a.overlap || b.iou - a.iou || a.index - b.index)[0]
    remap.set(slab.id, best ? plates[best.index]!.id : undefined)
  }
  return { plates, retired, remap }
}

const warnedLevels = new Set<string>()
export function warnPlateFailure(levelId: string, ids: string[], error: unknown) {
  if (warnedLevels.has(levelId)) return
  warnedLevels.add(levelId)
  console.warn('[floor plates] Keeping existing level construction', { levelId, ids, error })
}
