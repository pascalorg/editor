import { create } from 'zustand'

/**
 * Ephemeral preview state for wall move's bridge walls.
 *
 * When the user drags a wall whose corner neighbours are off-axis to
 * the move direction, the junction planner emits a `bridgePlan` for
 * each — a new wall that would be inserted between the original and
 * new corner on commit. The 3D `MoveWallTool` already renders these
 * as translucent ghost meshes mid-drag; the 2D `wallFloorplanMoveTarget`
 * writes here so the floor-plan SVG layer can render the same hint.
 *
 * Writer: `packages/nodes/src/wall/floorplan-move.ts` (on each `apply`,
 * cleared on `commit` and by the move overlay's cleanup).
 * Reader: `packages/editor/src/components/editor-2d/floorplan-wall-move-ghost-layer.tsx`.
 */
export type WallMoveGhostBridge = {
  id: string
  start: [number, number]
  end: [number, number]
  /** Plan-space thickness already passed through `getFloorplanWallThickness`. */
  thickness: number
  color: string
}

type WallMoveGhostsState = {
  bridges: WallMoveGhostBridge[]
  setBridges: (bridges: WallMoveGhostBridge[]) => void
  clear: () => void
}

export const useWallMoveGhosts = create<WallMoveGhostsState>((set) => ({
  bridges: [],
  setBridges: (bridges) => set({ bridges }),
  clear: () => set({ bridges: [] }),
}))
