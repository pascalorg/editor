import { type AnyNode, getFloorStackedPosition, useScene } from '@pascal-app/core'

/**
 * Where a member actually rests: its stored base plus whatever the host elects
 * under it — a stacked slab or the sculpted ground. Stored positions are flat
 * by contract (`[x, 0, z]`); the lift is presentation. Mirrors the pattern the
 * Nature plugin uses for the same seam (see pascalorg/plugin-trees
 * `elevation.ts`).
 */
export function memberElevation(
  node: { id: string; type: string; position: [number, number, number] },
  nodes: Record<string, AnyNode> = useScene.getState().nodes,
): number {
  return getFloorStackedPosition({
    node: node as unknown as AnyNode,
    nodes,
    position: node.position,
  })[1]
}

/**
 * The ghost's Y for a draft the placement tool has not committed yet. The
 * draft is unparented, so the level it will land on is named explicitly — the
 * resolver reads `parentId` first and only falls back to `levelId`.
 */
export function draftElevation(
  draft: unknown,
  levelId: string,
  position: [number, number, number],
  nodes: Record<string, AnyNode> = useScene.getState().nodes,
): number {
  return getFloorStackedPosition({
    node: { ...(draft as AnyNode), parentId: null },
    nodes,
    position,
    rotation: (draft as { rotation?: unknown }).rotation,
    levelId,
  })[1]
}
