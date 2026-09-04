import { type AnyNode, getFloorStackedPosition, useScene } from '@pascal-app/core'

/**
 * Where a plant actually stands: its stored base plus whatever the host elects
 * under it — a stacked slab (deck, plinth) or the sculpted ground.
 *
 * Stored positions are flat by contract (`[x, 0, z]`); the lift is presentation
 * and is never committed. For an ordinary per-node kind the host's
 * `FloorElevationSystem` applies it for free, but it writes to each node's
 * *registered* object — and for a collective renderer that object is the
 * invisible selection proxy, not the instance. So an instanced kind has to
 * resolve this itself, at every point it writes a transform. Reading
 * `node.position[1]` raw is what left every plant at `y = 0`: floating under a
 * deck and buried in a hillside.
 *
 * Kept in its own module, free of any Three.js or React import, so the seam is
 * testable without a canvas — see `elevation.test.ts`.
 */
export function plantElevation(
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
 * The ghost's Y for a draft the placement tool has not committed yet.
 *
 * Same question as {@link plantElevation}, but the draft is unparented, so the
 * level it will land on has to be named explicitly — the resolver reads
 * `parentId` first and only falls back to `levelId`.
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
