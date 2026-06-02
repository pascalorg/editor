// Pure TypeScript — no imports from packages/mcp, packages/viewer, or apps/editor.
// Scene operations are injected to keep this module testable and layer-clean.

import {
  BuildingNode,
  DoorNode,
  GuideNode,
  LevelNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import type { AnyNode } from '../../schema/types'
import type { CoordsJSON } from './dxf-geometry-parser'
import type { MergedOpening, MergedWall, MergeResult } from './dxf-merge-engine'

// ─── Injected scene operations ────────────────────────────────────────────────

/**
 * Minimal interface the importer needs from the host environment.
 * Pass a `SceneOperations` adapter from @pascal-app/mcp, or a test double.
 */
export type SceneOps = {
  /** Create a node and attach it to parentId. Returns the new node's scene id. */
  createNode(node: AnyNode, parentId?: string): string
  /**
   * Reload a stored scene by id into the in-memory bridge.
   * Called on live_sync_version_conflict before retrying a mutation.
   */
  reloadScene(sceneId: string): Promise<boolean>
}

// ─── Import options & result ──────────────────────────────────────────────────

export type ImportOptions = {
  /** Load this scene before writing. Also used as the target for version-conflict reloads. */
  sceneId?: string
  /** URL of the DXF preview PNG. When provided, a GuideNode overlay is created (Step 9). */
  guideImageUrl?: string
  /** Label stored in the new level's metadata.label. Default: "Level 1". */
  levelLabel?: string
  /** Level elevation in metres. Default: 0. */
  floorElevation?: number
  /** Floor-to-ceiling height stored in level metadata. Default: 2.8 m. */
  floorHeight?: number
}

export type ImportResult = {
  buildingId: string
  levelId: string
  /** Maps MergeResult wall id (e.g. "w_001") → scene node id */
  wallIds: Record<string, string>
  /** Maps MergeResult opening id (e.g. "o_001") → scene node id */
  openingIds: Record<string, string>
  /** Maps MergeResult zone id (e.g. "z_001") → scene node id */
  zoneIds: Record<string, string>
  guideId?: string
  warnings: string[]
}

// ─── Version-conflict retry ───────────────────────────────────────────────────

const MAX_RETRIES = 3
const CONFLICT_SIGNAL = 'live_sync_version_conflict'

/**
 * Wraps a synchronous createNode call with up to MAX_RETRIES conflict retries.
 * On each conflict the scene is reloaded, then the operation is re-attempted.
 * Throws a user-readable message when all retries are exhausted.
 */
async function withConflictRetry<T>(
  op: () => T,
  reload: () => Promise<void>,
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return op()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes(CONFLICT_SIGNAL)) throw err // non-conflict: rethrow immediately
      if (attempt === MAX_RETRIES) throw new Error('导入冲突，请刷新页面后重试')
      await reload()
    }
  }
  /* istanbul ignore next */
  throw new Error('unreachable')
}

// ─── Wall-local position for doors/windows ────────────────────────────────────

/**
 * Convert a 0–1 parametric position along a wall centreline to the wall-local
 * X coordinate (metres from start), clamped so the opening fits inside the wall.
 */
function wallLocalX(wall: MergedWall, t: number, openingWidth: number): number {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < openingWidth) return len / 2
  return Math.max(openingWidth / 2, Math.min(len - openingWidth / 2, t * len))
}

// ─── Node builders ────────────────────────────────────────────────────────────

function buildWallNode(w: MergedWall): AnyNode {
  return WallNode.parse({
    start: w.start,
    end: w.end,
    thickness: w.thickness,
    height: w.height,
    visible: true,
    metadata: {
      importSource: 'dxf',
      ...(w.layerName !== undefined ? { layerName: w.layerName } : {}),
      ...(w.wallType !== null ? { wallType: w.wallType } : {}),
      needsReview: w.needsReview,
      ...(w.importWarning !== undefined ? { importWarning: w.importWarning } : {}),
    },
  })
}

function buildOpeningNode(o: MergedOpening, sceneWallId: string, wall: MergedWall): AnyNode {
  const localX = wallLocalX(wall, o.positionAlongWall, o.width)
  if (o.kind === 'door') {
    return DoorNode.parse({
      wallId: sceneWallId,
      width: o.width,
      height: o.height,
      position: [localX, o.height / 2, 0],
    })
  }
  // window
  return WindowNode.parse({
    wallId: sceneWallId,
    width: o.width,
    height: o.height,
    // Sill at 0.9 m above floor (standard residential window sill)
    position: [localX, 0.9 + o.height / 2, 0],
  })
}

function buildGuideNode(coords: CoordsJSON, url: string): AnyNode {
  const w = coords.bbox.maxX - coords.bbox.minX
  return GuideNode.parse({
    url,
    opacity: 50,
    scaleReference: {
      start: [coords.bbox.minX, coords.bbox.minY],
      end: [coords.bbox.maxX, coords.bbox.minY],
      realLengthMeters: w > 0 ? w : 1,
      measuredLengthUnits: w > 0 ? w : 1,
      metersPerUnit: 1,
      label: 'DXF import',
    },
  })
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Write a fully-merged DXF import into the active Pascal scene.
 *
 * Mandatory write order (§9):
 *   1. BuildingNode
 *   2. LevelNode
 *   3. WallNode × N
 *   4. DoorNode × M     (after walls — doors reference wallId)
 *   5. WindowNode × K   (after walls)
 *   6. ZoneNode × Z
 *   7. GuideNode        (DXF PNG overlay, optional)
 */
export async function importDxfScene(
  mergeResult: MergeResult,
  coords: CoordsJSON,
  sceneOps: SceneOps,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const warnings = [...mergeResult.warnings]
  const { sceneId, guideImageUrl, levelLabel = 'Level 1' } = options

  const reload = sceneId
    ? async () => {
        await sceneOps.reloadScene(sceneId)
      }
    : async () => {
        /* no stored scene to reload */
      }

  const run = <T>(op: () => T) => withConflictRetry(op, reload)

  // ── Step 2: building ───────────────────────────────────────────────────────
  const building = BuildingNode.parse({})
  const buildingId = await run(() => sceneOps.createNode(building))

  // ── Step 3: level ──────────────────────────────────────────────────────────
  const level = LevelNode.parse({
    level: options.floorElevation ?? 0,
    metadata: {
      height: options.floorHeight ?? 2.8,
      label: levelLabel,
    },
  })
  const levelId = await run(() => sceneOps.createNode(level, buildingId))

  // ── Step 4: walls ──────────────────────────────────────────────────────────
  const wallIds: Record<string, string> = {}
  for (const w of mergeResult.walls) {
    const sceneId_ = await run(() => sceneOps.createNode(buildWallNode(w), levelId))
    wallIds[w.id] = sceneId_
  }

  // ── Steps 5–6: openings (doors then windows) ───────────────────────────────
  const openingIds: Record<string, string> = {}

  for (const pass of ['door', 'window'] as const) {
    for (const o of mergeResult.openings) {
      if (o.kind !== pass) continue

      const sceneWallId = wallIds[o.wallId]
      if (!sceneWallId) {
        warnings.push(`Opening ${o.id}: wall ${o.wallId} not in scene — skipped`)
        continue
      }
      const mergedWall = mergeResult.walls.find(w => w.id === o.wallId)
      if (!mergedWall) {
        warnings.push(`Opening ${o.id}: wall data missing — skipped`)
        continue
      }

      const sceneOpeningId = await run(() =>
        sceneOps.createNode(buildOpeningNode(o, sceneWallId, mergedWall), sceneWallId),
      )
      openingIds[o.id] = sceneOpeningId
    }
  }

  // Skip unresolved openings with a warning
  for (const o of mergeResult.openings) {
    if (o.kind === 'unresolved') {
      warnings.push(`Opening ${o.id}: type unresolved — skipped (manual placement required)`)
    }
  }

  // ── Step 7: zones ──────────────────────────────────────────────────────────
  const zoneIds: Record<string, string> = {}
  for (const z of mergeResult.zones) {
    if (z.polygon.length < 3) {
      warnings.push(`Zone ${z.id}: polygon has fewer than 3 vertices — skipped`)
      continue
    }
    const zoneNode = ZoneNode.parse({
      name: z.name ?? z.id,
      polygon: z.polygon,
      metadata: {
        importSource: 'dxf',
        ...(z.approxAreaM2 !== undefined ? { approxAreaM2: z.approxAreaM2 } : {}),
      },
    })
    const sceneZoneId = await run(() => sceneOps.createNode(zoneNode, levelId))
    zoneIds[z.id] = sceneZoneId
  }

  // ── Step 9: guide node (DXF PNG overlay) ──────────────────────────────────
  let guideId: string | undefined
  if (guideImageUrl) {
    const guideNode = buildGuideNode(coords, guideImageUrl)
    guideId = await run(() => sceneOps.createNode(guideNode, levelId))
  }

  return {
    buildingId,
    levelId,
    wallIds,
    openingIds,
    zoneIds,
    ...(guideId !== undefined ? { guideId } : {}),
    warnings,
  }
}
