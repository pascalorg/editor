import { parseSlabConstruction } from '../lib/floor-plates'
import {
  computePlateSurfacePartition,
  parseRoomFinishRole,
  plateFinishKey,
  plateLevelContext,
  plateOpeningLandings,
} from '../lib/plate-surface'
import {
  area,
  difference,
  intersection,
  type MultiPolygon,
  type Polygon,
  type Ring,
} from '../lib/polygon-boolean'
import { getRenderableSlabPolygon, prepareSlabPolygonContext } from '../lib/slab-polygon'
import type { AnyNode, DoorNode, SlabNode, WallNode, WindowNode, ZoneNode } from '../schema'

function slabFinish(slab: SlabNode) {
  return slab.slots?.surface ?? slab.material ?? slab.materialPreset ?? 'library:wood-woodplank48'
}

function legacySurfaces(legacy: Record<string, unknown>, levelId: string) {
  const children = Object.values(legacy).filter(
    (node) => (node as AnyNode).parentId === levelId,
  ) as AnyNode[]
  const slabs = children.filter((node): node is SlabNode => node.type === 'slab')
  if (slabs.some((slab) => slab.plateRole)) return []
  const context = prepareSlabPolygonContext({
    walls: children.filter((node): node is WallNode => node.type === 'wall'),
    siblingSlabs: slabs,
  })
  return slabs
    .filter((slab) => slab.visible !== false && !slab.recessed)
    .map(parseSlabConstruction)
    .sort((a, b) => b.elevation - a.elevation || a.id.localeCompare(b.id))
    .map((slab) => ({
      elevation: slab.elevation,
      polygons: { outer: getRenderableSlabPolygon(slab, context), holes: slab.holes },
      finish: slabFinish(slab),
    }))
}

function regionRings(polygon: Polygon): Ring[] {
  if (!polygon.holes.length) return [polygon.outer]
  const xs = [...new Set([...polygon.outer, ...polygon.holes.flat()].map(([x]) => x))].sort(
    (a, b) => a - b,
  )
  const zs = polygon.outer.map(([, z]) => z)
  const minZ = Math.min(...zs),
    maxZ = Math.max(...zs)
  return xs.slice(1).flatMap((x, i) =>
    intersection(polygon, [
      [xs[i]!, minZ],
      [x, minZ],
      [x, maxZ],
      [xs[i]!, maxZ],
    ]).map((part) => part.outer),
  )
}

/** Preserve the formerly plate-owned finish as ordinary, editable room paint. */
export function migrateExteriorThresholds(
  source: Record<string, AnyNode>,
  legacy: Record<string, unknown> = source,
): Record<string, AnyNode> {
  const pending = new Set(
    Object.values(source)
      .filter(
        (node) =>
          (node.type === 'door' || node.type === 'window') &&
          (legacy[node.id] as DoorNode | WindowNode | undefined)?.floorThresholdVersion !== 1,
      )
      .map((node) => node.id as string),
  )
  if (!pending.size) return source
  const nodes = { ...source }
  for (const level of Object.values(source)) {
    if (level.type !== 'level') continue
    const context = plateLevelContext(level, (id) => source[id])
    if (!context.openings?.some((opening) => pending.has(opening.id))) continue
    const landings = plateOpeningLandings(context).filter(
      (landing) => landing.exterior && pending.has(landing.openingId),
    )
    if (!landings.length) continue
    const original = legacySurfaces(legacy, level.id)
    for (const plate of context.slabs) {
      if (plate.visible === false) continue
      const partition = computePlateSurfacePartition(plate, context)
      if (!partition) continue
      const fallback = slabFinish(plate)
      for (const landing of landings) {
        let index = 0
        for (const cell of partition.cells) {
          if (parseRoomFinishRole(cell.role)?.zoneId !== landing.zoneId) continue
          let remaining = intersection(cell.polygons, landing.polygons)
          if (area(remaining) < 1e-6) continue
          const preserved: Array<{
            polygons: MultiPolygon
            finish: ReturnType<typeof slabFinish>
          }> = []
          // Raw pre-plate scenes still have their original slabs. Reading only
          // the merged plate would preserve an earlier migration's lost finish.
          for (const surface of original) {
            if (Math.abs(surface.elevation - plate.elevation) > 0.02 + 1e-9) continue
            const polygons = intersection(remaining, surface.polygons)
            if (area(polygons) < 1e-6) continue
            preserved.push({ polygons, finish: surface.finish })
            remaining = difference(remaining, polygons)
          }
          if (area(remaining) >= 1e-6) preserved.push({ polygons: remaining, finish: fallback })
          const regions = preserved.flatMap(({ polygons, finish }) =>
            plateFinishKey(cell.finish ?? fallback) === plateFinishKey(finish)
              ? []
              : polygons.flatMap(regionRings).map((polygon) => ({
                  id: `threshold:${landing.openingId}:${plate.id}:${index++}`,
                  polygon,
                  finish,
                })),
          )
          if (!regions.length) continue
          const zone = nodes[landing.zoneId] as ZoneNode
          nodes[zone.id] = {
            ...zone,
            floor: {
              ...zone.floor,
              regions: [...(zone.floor?.regions ?? []), ...regions],
            },
          }
        }
      }
    }
  }
  // Stamp every existing opening, even interior ones: a later room deletion
  // must not turn a newly exterior doorway into another legacy migration.
  for (const id of pending) nodes[id] = { ...nodes[id], floorThresholdVersion: 1 } as AnyNode
  return nodes
}
