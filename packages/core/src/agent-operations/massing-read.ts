import type { VOLUME_SHAPES } from '../agent-tools/design-brief'
import { refuse } from '../agent-tools/refusal'
import { type AnyNode, getActiveRoofHeight, type RoofNode } from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { getLevelElevations } from '../services/storey'
import { pointInPolygon, polygonArea, polygonBounds, type Vec2 } from './plan-geometry'
import { levelRole, levelsOf, queryNodes } from './scene-queries'
import type { SceneNodes } from './types'

type Pt = [number, number]

type Shape = (typeof VOLUME_SHAPES)[number]

const round2 = (value: number) => Math.round(value * 100) / 100

const boundsOf = (polygons: readonly (readonly Pt[])[]) => {
  const all = polygons.flatMap((polygon) => polygon.map((point) => point as Vec2))
  const { width: _w, depth: _d, centerX: _x, centerZ: _z, ...bounds } = polygonBounds(all)
  return {
    minX: round2(bounds.minX),
    maxX: round2(bounds.maxX),
    minZ: round2(bounds.minZ),
    maxZ: round2(bounds.maxZ),
  }
}

function segmentsMeet(a: Pt, b: Pt, c: Pt, d: Pt, proper: boolean): boolean {
  const cross = (p: Pt, q: Pt, r: Pt) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (proper)
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  const on = (p: Pt, q: Pt, r: Pt) =>
    Math.abs(cross(p, q, r)) < 1e-9 &&
    r[0] >= Math.min(p[0], q[0]) - 1e-9 &&
    r[0] <= Math.max(p[0], q[0]) + 1e-9 &&
    r[1] >= Math.min(p[1], q[1]) - 1e-9 &&
    r[1] <= Math.max(p[1], q[1]) + 1e-9
  if (
    ((d1 >= 0 && d2 <= 0) || (d1 <= 0 && d2 >= 0)) &&
    ((d3 >= 0 && d4 <= 0) || (d3 <= 0 && d4 >= 0))
  )
    return true
  return on(c, d, a) || on(c, d, b) || on(a, b, c) || on(a, b, d)
}

function eachEdge(polygon: readonly Pt[], fn: (a: Pt, b: Pt) => boolean): boolean {
  for (let i = 0; i < polygon.length; i++)
    if (fn(polygon[i]!, polygon[(i + 1) % polygon.length]!)) return true
  return false
}

/** Area overlap: a corner strictly inside the other, or edges crossing. A shared edge is not overlap. */

/** Area overlap: a corner strictly inside the other, or edges crossing. A shared edge is not overlap. */
export function polygonsOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  const ab = polygonBounds(a as Vec2[])
  const bb = polygonBounds(b as Vec2[])
  if (ab.maxX <= bb.minX || bb.maxX <= ab.minX || ab.maxZ <= bb.minZ || bb.maxZ <= ab.minZ)
    return false
  if (a.some((point) => pointInPolygon(point as Vec2, b as Vec2[], false))) return true
  if (b.some((point) => pointInPolygon(point as Vec2, a as Vec2[], false))) return true
  return eachEdge(a, (a1, a2) => eachEdge(b, (b1, b2) => segmentsMeet(a1, a2, b1, b2, true)))
}

/** Overlap, or contact: a corner on the other's boundary, or edges meeting at all. */

/** Overlap, or contact: a corner on the other's boundary, or edges meeting at all. */
export function polygonsTouch(a: readonly Pt[], b: readonly Pt[]): boolean {
  if (polygonsOverlap(a, b)) return true
  const ab = polygonBounds(a as Vec2[])
  const bb = polygonBounds(b as Vec2[])
  if (
    ab.maxX < bb.minX - 1e-9 ||
    bb.maxX < ab.minX - 1e-9 ||
    ab.maxZ < bb.minZ - 1e-9 ||
    bb.maxZ < ab.minZ - 1e-9
  )
    return false
  if (a.some((point) => pointInPolygon(point as Vec2, b as Vec2[], true))) return true
  if (b.some((point) => pointInPolygon(point as Vec2, a as Vec2[], true))) return true
  return eachEdge(a, (a1, a2) => eachEdge(b, (b1, b2) => segmentsMeet(a1, a2, b1, b2, false)))
}

const buildingLevelsOf = (nodes: SceneNodes, buildingId: string) =>
  levelsOf(nodes).filter((level) => level.parentId === buildingId)

const occupiedOf = (nodes: SceneNodes, buildingId: string) =>
  buildingLevelsOf(nodes, buildingId).filter((level) => levelRole(nodes, level).role === 'occupied')

type VolumeMeta = {
  id: string
  name: string
  shape: Shape
  storeyIndex: number
  partIndex: number
  court?: boolean
  setbackMeters?: number
  cantileverMeters?: number
  cantileverSupport?: string
  courtPolygon?: Pt[]
}

type ZoneLike = AnyNode & { type: 'zone'; polygon: Pt[] }

const volumeMetaOf = (node: AnyNode): VolumeMeta | null => {
  const meta = (node as { metadata?: Record<string, unknown> }).metadata?.volume
  if (!meta || typeof meta !== 'object') return null
  const volume = meta as VolumeMeta
  return typeof volume.id === 'string' ? volume : null
}

function roofFacts(nodes: SceneNodes, roof: AnyNode) {
  const childIds = (roof as { children?: string[] }).children ?? []
  const segs = childIds
    .map((id: string) => nodes[id])
    .filter((node: AnyNode | undefined) => node?.type === 'roof-segment') as (AnyNode & {
    roofType?: string
    pitch?: number
  })[]
  return {
    roofIds: [roof.id],
    types: [...new Set(segs.map((segment) => segment.roofType ?? 'gable'))],
    pitches: [...new Set(segs.map((segment) => segment.pitch ?? 40))],
    segmentIds: segs.map((segment) => segment.id),
    heightMeters: segs.length
      ? round2(Math.max(...segs.map((segment) => getActiveRoofHeight(segment as never))))
      : 0,
  }
}

/**
 * The building as volumes. Tagged rooms report their recorded volume; the rest are grouped by
 * touching footprints on a level and overlapping footprints between levels, and marked inferred.
 */
export function readMassing(nodes: SceneNodes, buildingId?: string) {
  const buildings = queryNodes<AnyNode>(nodes, { type: 'building' }).filter(
    (node) => !buildingId || node.id === buildingId,
  )
  if (buildingId && !buildings.length)
    refuse('building_not_found', `Building not found: ${buildingId}.`, { buildingId })
  const elevations = getLevelElevations(nodes as Record<string, AnyNode>) as Map<
    string,
    { baseY: number; height: number }
  >

  const describeBuilding = (building: AnyNode) => {
    const occupied = occupiedOf(nodes, building.id)
    const levelIndex = new Map<string, number>(
      occupied.map((level, index) => [level.id as string, index]),
    )
    const zones = queryNodes<ZoneLike>(nodes, { type: 'zone' }).filter(
      (node) => !!node.parentId && levelIndex.has(node.parentId),
    )
    const roofs = queryNodes<RoofNode>(nodes, { type: 'roof' })

    type Group = { zones: ZoneLike[]; meta: VolumeMeta | null }
    const groups: Group[] = []
    const tagged = new Map<string, Group>()
    const untagged: ZoneLike[] = []
    for (const zone of zones) {
      const meta = volumeMetaOf(zone)
      if (!meta) {
        untagged.push(zone)
        continue
      }
      const group = tagged.get(meta.id) ?? { zones: [], meta }
      group.zones.push(zone)
      tagged.set(meta.id, group)
    }
    groups.push(...tagged.values())
    const parent = untagged.map((_, i) => i)
    const find = (i: number): number => {
      let root = i
      while (parent[root] !== root) root = parent[root]!
      return root
    }
    for (let i = 0; i < untagged.length; i++)
      for (let j = i + 1; j < untagged.length; j++) {
        const a = untagged[i]!
        const b = untagged[j]!
        const la = levelIndex.get(a.parentId!)!
        const lb = levelIndex.get(b.parentId!)!
        const linked =
          la === lb
            ? polygonsTouch(a.polygon, b.polygon)
            : Math.abs(la - lb) === 1 && polygonsOverlap(a.polygon, b.polygon)
        if (linked) parent[find(i)] = find(j)
      }
    const inferred = new Map<number, ZoneLike[]>()
    untagged.forEach((zone, i) => {
      const root = find(i)
      inferred.set(root, [...(inferred.get(root) ?? []), zone])
    })
    for (const groupZones of inferred.values()) groups.push({ zones: groupZones, meta: null })

    const volumes = groups.map((group, groupOrder) => {
      const byLevel = new Map<string, ZoneLike[]>()
      for (const zone of group.zones) {
        if (volumeMetaOf(zone)?.court) continue
        byLevel.set(zone.parentId!, [...(byLevel.get(zone.parentId!) ?? []), zone])
      }
      const levelIds = [...byLevel.keys()].sort((a, b) => levelIndex.get(a)! - levelIndex.get(b)!)
      const storeyFootprints = levelIds.map((levelId) => {
        const levelZones = byLevel.get(levelId)!
        return {
          levelId,
          levelIndex: levelIndex.get(levelId)!,
          heightMeters: round2(elevations.get(levelId)?.height ?? DEFAULT_LEVEL_HEIGHT),
          baseElevationMeters: round2(elevations.get(levelId)?.baseY ?? 0),
          areaSqMeters: round2(
            levelZones.reduce((sum, zone) => sum + polygonArea(zone.polygon as Vec2[]), 0),
          ),
          bounds: boundsOf(levelZones.map((zone) => zone.polygon)),
          zoneIds: levelZones.map((zone) => zone.id),
        }
      })
      const topLevelId = levelIds.at(-1)!
      const topPolygons = byLevel.get(topLevelId)!.map((zone) => zone.polygon)
      const volumeId = group.meta?.id ?? `inferred_${building.id}_${groupOrder}`
      const ownRoof =
        roofs.find(
          (roof) =>
            (roof as { metadata?: Record<string, unknown> }).metadata?.volumeId === volumeId,
        ) ??
        roofs.find((roof) => {
          const [x, , z] = (roof.position as number[]) ?? []
          if (x === undefined || z === undefined) return false
          const reference = (roof as { metadata?: Record<string, unknown> }).metadata
            ?.referenceLevelId
          const levelMatch = roof.parentId === topLevelId || reference === topLevelId
          return (
            levelMatch &&
            topPolygons.some((polygon) => pointInPolygon([x, z], polygon as Vec2[], true))
          )
        })
      const courtPolygon = group.zones
        .map(volumeMetaOf)
        .find((meta) => meta?.courtPolygon)?.courtPolygon
      let setbackMeters = group.meta?.setbackMeters ?? null
      let cantilever = group.meta?.cantileverMeters
        ? { meters: group.meta.cantileverMeters, support: group.meta.cantileverSupport ?? null }
        : null
      if (!group.meta && storeyFootprints.length > 1) {
        const ground = storeyFootprints[0]!.bounds
        const upper = storeyFootprints.at(-1)!.bounds
        const insets = [
          upper.minX - ground.minX,
          ground.maxX - upper.maxX,
          upper.minZ - ground.minZ,
          ground.maxZ - upper.maxZ,
        ]
        if (insets.every((inset) => inset > 0.05)) setbackMeters = round2(Math.min(...insets))
        else if (insets.some((inset) => inset < -0.05))
          cantilever = { meters: round2(-Math.min(...insets)), support: null }
      }
      return {
        volumeId,
        name: group.meta?.name ?? group.zones[0]?.name ?? volumeId,
        shape: group.meta?.shape ?? null,
        source: group.meta ? ('tagged' as const) : ('inferred' as const),
        storeys: levelIds.length,
        baseLevelIndex: levelIndex.get(levelIds[0]!)!,
        totalHeightMeters: round2(
          storeyFootprints.reduce((sum, storey) => sum + storey.heightMeters, 0),
        ),
        topElevationMeters: round2(
          (elevations.get(topLevelId)?.baseY ?? 0) +
            (elevations.get(topLevelId)?.height ?? DEFAULT_LEVEL_HEIGHT),
        ),
        storeyFootprints,
        roof: ownRoof ? roofFacts(nodes, ownRoof) : null,
        court: courtPolygon
          ? {
              polygon: courtPolygon,
              areaSqMeters: round2(polygonArea(courtPolygon as Vec2[])),
              bounds: boundsOf([courtPolygon]),
            }
          : null,
        setbackMeters,
        cantilever,
        attachedTo: [] as string[],
      }
    })
    const groundPolygons = volumes.map((volume) => {
      const first = volume.storeyFootprints[0]!
      return first.zoneIds.map((id) => (nodes[id] as ZoneLike).polygon)
    })
    volumes.forEach((volume, i) => {
      volume.attachedTo = volumes
        .filter(
          (other, j) =>
            i !== j &&
            other.baseLevelIndex === volume.baseLevelIndex &&
            groundPolygons[i]!.some((a) => groundPolygons[j]!.some((b) => polygonsTouch(a, b))),
        )
        .map((other) => other.volumeId)
    })
    volumes.sort(
      (a, b) =>
        b.storeys - a.storeys ||
        b.storeyFootprints[0]!.areaSqMeters - a.storeyFootprints[0]!.areaSqMeters ||
        a.storeyFootprints[0]!.bounds.minX - b.storeyFootprints[0]!.bounds.minX ||
        a.storeyFootprints[0]!.bounds.minZ - b.storeyFootprints[0]!.bounds.minZ ||
        String(a.name).localeCompare(String(b.name)),
    )
    return {
      buildingId: building.id,
      buildingName: building.name ?? null,
      volumes,
    }
  }

  return buildings.map(describeBuilding)
}

export type MassingBuilding = ReturnType<typeof readMassing>[number]
