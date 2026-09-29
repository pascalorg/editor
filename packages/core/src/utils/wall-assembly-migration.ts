import type { WallAssembly } from '../schema/nodes/wall'
import { isLegacyWallAssembly, wallAssemblyFromLegacy } from '../systems/wall/wall-assembly'

export type WallAssemblyMigration = {
  changed: boolean
  nodes: Record<string, unknown>
}

/**
 * Converts every wall that still stores the WS5 `WallAssembly` (#937) to F2
 * layers (`wallAssemblyFromLegacy`). The layer sum is the WS5 total, so
 * `thickness` and the drawing stay the same.
 *
 * Pure, idempotent and server-safe: the editor loader and the hosted scene
 * authority both run it, so both compare and persist the same canonical field.
 */
export function migrateLegacyWallAssemblies(nodes: Record<string, unknown>): WallAssemblyMigration {
  let changed = false
  const next: Record<string, unknown> = { ...nodes }
  for (const [id, node] of Object.entries(nodes)) {
    if (node === null || typeof node !== 'object') continue
    const record = node as { type?: unknown; assembly?: unknown }
    if (record.type !== 'wall' || !isLegacyWallAssembly(record.assembly)) continue
    next[id] = { ...record, assembly: wallAssemblyFromLegacy(record.assembly as WallAssembly) }
    changed = true
  }
  return { changed, nodes: changed ? next : nodes }
}
