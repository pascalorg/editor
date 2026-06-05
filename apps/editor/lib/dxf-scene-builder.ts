// Server-side only — Node.js APIs allowed.
// Shared by /api/dxf-import-scene and /api/dxf-jobs/[jobId]/madori.

import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  AnyNode,
  BuildingNode,
  DoorNode,
  GuideNode,
  ItemNode,
  LevelNode,
  SiteNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import type { AnyNodeId, AnyNode as AnyNodeT } from '@pascal-app/core/schema'
import type { CoordsJSON, MergeResult, MergedFurniture, MergedOpening, MergedWall, MergedZone } from '@pascal-app/core/importers'
import { CATALOG_ITEMS } from '@pascal-app/editor/catalog'
import { getSceneOperations } from '@/lib/scene-store-server'

// ---------------------------------------------------------------------------

export type BuildResult = {
  graph: SceneGraph
  wallCount: number
  openingCount: number
  zoneCount: number
  furnitureCount: number
  warnings: string[]
}

/**
 * Convert a MergeResult + CoordsJSON into a SceneGraph ready for persistence.
 * This is the pure construction step — no I/O.
 */
export function buildGraph(
  mergeResult: MergeResult,
  coords: CoordsJSON,
  guideImageUrl?: string,
): BuildResult {
  const warnings: string[] = [...mergeResult.warnings]
  const nodes: Record<AnyNodeId, AnyNodeT> = {}

  // Compute wall bounding box so the SiteNode polygon covers the full building.
  // The default SiteNode is a 30×30m square which is too small for large floor plans.
  let bboxMinX = -15, bboxMaxX = 15, bboxMinZ = -15, bboxMaxZ = 15
  if (mergeResult.walls.length > 0) {
    bboxMinX = Infinity; bboxMaxX = -Infinity; bboxMinZ = Infinity; bboxMaxZ = -Infinity
    for (const w of mergeResult.walls) {
      bboxMinX = Math.min(bboxMinX, w.start[0], w.end[0])
      bboxMaxX = Math.max(bboxMaxX, w.start[0], w.end[0])
      bboxMinZ = Math.min(bboxMinZ, w.start[1], w.end[1])
      bboxMaxZ = Math.max(bboxMaxZ, w.start[1], w.end[1])
    }
    const pad = 2  // 2m margin around the building footprint
    bboxMinX -= pad; bboxMaxX += pad; bboxMinZ -= pad; bboxMaxZ += pad
  }

  // Skeleton: Site → Building → Level
  const site = SiteNode.parse({
    polygon: {
      type: 'polygon',
      points: [
        [bboxMinX, bboxMinZ],
        [bboxMaxX, bboxMinZ],
        [bboxMaxX, bboxMaxZ],
        [bboxMinX, bboxMaxZ],
      ],
    },
  })
  const building = BuildingNode.parse({})
  const level    = LevelNode.parse({ level: 0 })

  const siteId     = site.id     as AnyNodeId
  const buildingId = building.id as AnyNodeId
  const levelId    = level.id    as AnyNodeId
  const levelChildren: string[] = []

  // Walls
  let wallCount = 0
  // MergeResult wall id ("w_001") → generated WallNode scene id ("wall_xxxx")
  const wallIdMap: Record<string, AnyNodeId> = {}

  for (let i = 0; i < mergeResult.walls.length; i++) {
    const w = mergeResult.walls[i] as MergedWall
    try {
      const wall = WallNode.parse({
        start: w.start,
        end: w.end,
        thickness: w.thickness,
        height: w.height,
        metadata: {
          importSource: 'dxf',
          ...(w.layerName    ? { layerName:    w.layerName    } : {}),
          ...(w.wallType     ? { wallType:     w.wallType     } : {}),
          needsReview: w.needsReview,
          ...(w.importWarning ? { importWarning: w.importWarning } : {}),
        },
      })
      const linked: AnyNodeT = { ...(wall as AnyNodeT), parentId: levelId }
      const v = AnyNode.safeParse(linked)
      if (!v.success) { warnings.push(`wall[${i}] skipped: ${v.error.message}`); continue }
      nodes[wall.id as AnyNodeId] = v.data as AnyNodeT
      wallIdMap[w.id] = wall.id as AnyNodeId
      levelChildren.push(wall.id)
      wallCount++
    } catch (err) {
      warnings.push(`wall[${i}] error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Openings — doors first, then windows
  let openingCount = 0
  for (const pass of ['door', 'window'] as const) {
    for (let i = 0; i < mergeResult.openings.length; i++) {
      const o = mergeResult.openings[i] as MergedOpening
      if (o.kind !== pass) continue

      const sceneWallId = wallIdMap[o.wallId] ?? null
      if (!sceneWallId) { warnings.push(`opening[${i}] wallId ${o.wallId} not found — skipped`); continue }

      const wall    = mergeResult.walls.find(w => w.id === o.wallId) as MergedWall | undefined
      const wallLen = wall ? Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) : 1
      const localX  = Math.max(o.width / 2, Math.min(wallLen - o.width / 2, o.positionAlongWall * wallLen))

      try {
        const opening =
          pass === 'door'
            ? DoorNode.parse({ wallId: sceneWallId, width: o.width, height: o.height, position: [localX, o.height / 2, 0] })
            : WindowNode.parse({ wallId: sceneWallId, width: o.width, height: o.height, position: [localX, 0.9 + o.height / 2, 0] })

        const linked: AnyNodeT = { ...(opening as AnyNodeT), parentId: sceneWallId }
        const v = AnyNode.safeParse(linked)
        if (!v.success) { warnings.push(`opening[${i}] skipped: ${v.error.message}`); continue }
        nodes[opening.id as AnyNodeId] = v.data as AnyNodeT
        const wallNode = nodes[sceneWallId] as AnyNodeT & { children?: string[] }
        if (wallNode) wallNode.children = [...(wallNode.children ?? []), opening.id]
        openingCount++
      } catch (err) {
        warnings.push(`opening[${i}] error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Zones
  let zoneCount = 0
  for (let i = 0; i < mergeResult.zones.length; i++) {
    const z = mergeResult.zones[i] as MergedZone
    if (!z.polygon || z.polygon.length < 3) { warnings.push(`zone[${i}] polygon too small — skipped`); continue }
    try {
      const zone   = ZoneNode.parse({ name: z.name ?? `Room ${i + 1}`, polygon: z.polygon })
      const linked: AnyNodeT = { ...(zone as AnyNodeT), parentId: levelId }
      const v = AnyNode.safeParse(linked)
      if (!v.success) { warnings.push(`zone[${i}] skipped: ${v.error.message}`); continue }
      nodes[zone.id as AnyNodeId] = v.data as AnyNodeT
      levelChildren.push(zone.id)
      zoneCount++
    } catch (err) {
      warnings.push(`zone[${i}] error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Furniture — ItemNodes from Madori furniture conversion
  let furnitureCount = 0
  const catalogMap = new Map(CATALOG_ITEMS.map(c => [c.id, c]))

  for (let i = 0; i < (mergeResult.furniture ?? []).length; i++) {
    const f = mergeResult.furniture[i] as MergedFurniture
    const catalogItem = catalogMap.get(f.pascalItemId)
    if (!catalogItem) {
      warnings.push(`furniture[${i}] catalog item '${f.pascalItemId}' not found — skipped`)
      continue
    }
    try {
      const item = ItemNode.parse({
        position: f.position,
        rotation: [0, f.rotation, 0],
        asset: {
          id:          catalogItem.id,
          category:    catalogItem.category,
          name:        catalogItem.name,
          thumbnail:   catalogItem.thumbnail,
          src:         catalogItem.src,
          dimensions:  catalogItem.dimensions,
          offset:      catalogItem.offset   ?? [0, 0, 0],
          rotation:    catalogItem.rotation ?? [0, 0, 0],
          scale:       catalogItem.scale    ?? [1, 1, 1],
          ...(catalogItem.tags         ? { tags:         catalogItem.tags         } : {}),
          ...(catalogItem.surface      ? { surface:      catalogItem.surface      } : {}),
          ...(catalogItem.attachTo     ? { attachTo:     catalogItem.attachTo     } : {}),
          ...(catalogItem.floorPlanUrl ? { floorPlanUrl: catalogItem.floorPlanUrl } : {}),
        },
      })
      const linked: AnyNodeT = { ...(item as AnyNodeT), parentId: levelId }
      const v = AnyNode.safeParse(linked)
      if (!v.success) { warnings.push(`furniture[${i}] skipped: ${v.error.message}`); continue }
      nodes[item.id as AnyNodeId] = v.data as AnyNodeT
      levelChildren.push(item.id)
      furnitureCount++
    } catch (err) {
      warnings.push(`furniture[${i}] error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Guide node (DXF PNG overlay, optional)
  if (guideImageUrl) {
    try {
      const w = coords.bbox.maxX - coords.bbox.minX
      const guide = GuideNode.parse({
        url: guideImageUrl,
        opacity: 50,
        scaleReference: {
          start:               [coords.bbox.minX, coords.bbox.minY],
          end:                 [coords.bbox.maxX, coords.bbox.minY],
          realLengthMeters:    w > 0 ? w : 1,
          measuredLengthUnits: w > 0 ? w : 1,
          metersPerUnit:       1,
          label:               'DXF import',
        },
      })
      const linked: AnyNodeT = { ...(guide as AnyNodeT), parentId: levelId }
      nodes[guide.id as AnyNodeId] = linked
      levelChildren.push(guide.id)
    } catch { /* Guide node is optional */ }
  }

  // Wire up hierarchy
  nodes[levelId]    = { ...(level    as AnyNodeT), parentId: buildingId, children: levelChildren } as AnyNodeT
  nodes[buildingId] = { ...(building as AnyNodeT), parentId: siteId,     children: [levelId]     } as AnyNodeT
  nodes[siteId]     = { ...(site     as AnyNodeT),                        children: [buildingId]  } as AnyNodeT

  const graph: SceneGraph = {
    nodes:       nodes as SceneGraph['nodes'],
    rootNodeIds: [siteId] as SceneGraph['rootNodeIds'],
    collections: {} as SceneGraph['collections'],
  }

  return { graph, wallCount, openingCount, zoneCount, furnitureCount, warnings }
}

// ---------------------------------------------------------------------------

export type SaveOptions = {
  name?: string
  operation?: string
  guideImageUrl?: string
}

/**
 * Build a SceneGraph from MergeResult + CoordsJSON, persist it, and push a
 * live SSE event so subscribed tabs pick up the new scene immediately.
 * Returns the saved scene id and node counts.
 */
export async function buildAndSaveScene(
  mergeResult: MergeResult,
  coords: CoordsJSON,
  options: SaveOptions = {},
): Promise<{
  sceneId: string
  graph: SceneGraph
  wallCount: number
  openingCount: number
  zoneCount: number
  furnitureCount: number
  warnings: string[]
}> {
  const { name = 'DXF Import', operation = 'dxf_import', guideImageUrl } = options

  const { graph, wallCount, openingCount, zoneCount, furnitureCount, warnings } =
    buildGraph(mergeResult, coords, guideImageUrl)

  const ops = await getSceneOperations()

  const meta = await ops.saveScene({
    name,
    graph,
    saveMode:  'checkpoint',
    publish:   true,
    operation,
  })

  if (ops.canAppendSceneEvents) {
    try {
      await ops.appendSceneEvent({
        sceneId: meta.id,
        version: meta.version,
        kind:    operation,
        graph,
      })
    } catch (err) {
      console.warn('[dxf-scene-builder] appendSceneEvent failed (non-fatal):', err)
    }
  }

  return { sceneId: meta.id, graph, wallCount, openingCount, zoneCount, furnitureCount, warnings }
}
