'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

/**
 * Resolved current selection — selected node IDs plus a convenience
 * lookup into the live scene store. Returned shape is intentionally
 * narrow: hosts that need richer per-node state can compose this with
 * `useScene()` themselves.
 */
export type Selection = {
  /** Multi-select node IDs (drives the rest of the editor's UI). */
  selectedIds: AnyNodeId[]
  /** Currently active building context — surfaces / palettes filter on this. */
  buildingId: AnyNodeId | null
  /** Currently active level context. */
  levelId: AnyNodeId | null
  /** Currently active zone context. */
  zoneId: AnyNodeId | null
  /**
   * Resolved nodes for `selectedIds`. Missing entries (deleted nodes) are
   * filtered out, so the array length may be ≤ `selectedIds.length`.
   */
  selectedNodes: AnyNode[]
  /**
   * The single selected node, or `null` when zero or multiple nodes are
   * selected. Useful for "save as preset" / inspector gating where the
   * UI only makes sense for a unique selection.
   */
  selectedNode: AnyNode | null
}

/**
 * Subscribe to the current selection. Equivalent to reading from
 * `useViewer().selection` plus a live `useScene()` lookup, packaged as
 * a single hook so consumers building their own shells (community,
 * standalone editor app, embedders) don't have to learn the two
 * separate stores.
 *
 * Selection state intentionally lives in `useViewer` (it tracks the
 * camera / visibility hierarchy: building → level → zone → nodes), not
 * `useScene` — see `wiki/architecture/scene-registry.md`.
 */
export function useSelection(): Selection {
  const selection = useViewer((s) => s.selection)
  const nodes = useScene((s) => s.nodes)

  const selectedIds = selection.selectedIds as AnyNodeId[]
  const selectedNodes = selectedIds
    .map((id) => nodes[id])
    .filter((n): n is AnyNode => n !== undefined)
  const selectedNode = selectedNodes.length === 1 ? (selectedNodes[0] ?? null) : null

  return {
    selectedIds,
    buildingId: (selection.buildingId ?? null) as AnyNodeId | null,
    levelId: (selection.levelId ?? null) as AnyNodeId | null,
    zoneId: (selection.zoneId ?? null) as AnyNodeId | null,
    selectedNodes,
    selectedNode,
  }
}
