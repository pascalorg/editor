import { resolveLevelId } from '../lib/node-ancestry'
import { wallSupportForNodes } from '../lib/opening-floor-datum'
import type { AnyNode, WallNode } from '../schema'
import { getWallTop } from '../services/storey'

/**
 * A wall's base and height read from the records given, never from the open scene. The facade and
 * the balconies plan on records the store may not hold: a preview's scenario, or the hosted MCP's
 * scene on the server, where the store is a client module (2026-10-03: every MCP preview failed
 * with "use-scene … getState is not a function").
 */
export function wallBaseElevationIn(wall: WallNode, nodes: Readonly<Record<string, AnyNode>>) {
  return wallSupportForNodes(wall, nodes).elevation
}

export function wallEffectiveHeightIn(wall: WallNode, nodes: Readonly<Record<string, AnyNode>>) {
  const levelId = resolveLevelId(wall, nodes as Record<string, AnyNode>)
  const base = wallSupportForNodes(wall, nodes).elevation
  return getWallTop(wall, levelId, nodes as Record<string, AnyNode>, base) - base
}
