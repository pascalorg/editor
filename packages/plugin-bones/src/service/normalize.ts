import { isMovedPosition, nearestUsableWall, WALL_MOUNTED_TYPES } from './placement'

/**
 * Anchor normalization for `bones:service` nodes — the service-side half of
 * the drag-commit design that dropped `parentFrame.onCommit` (frame.ts):
 * the host move tool's commit writes the on-axis plan point into `position`;
 * this converts it back to the wall-anchor encoding (`wallId` + `wallT`,
 * position reset to [0,0,0]) so the inspector's wallT slider stays live (the
 * "wallT inert after a gizmo drag" quirk stays retired) and the node data
 * reads like every hand-authored anchor.
 *
 * Same spot, different encoding: the conversion uses the exact
 * `nearestUsableWall` projection the renderer's position path resolves
 * through (placement.ts), so the box never moves. Inspector/MCP position
 * writes normalize the same way — for WALL types, position was always
 * documented as a nearest-wall-snapped escape hatch, and this materializes
 * that snap into the anchor.
 *
 *  - WALL-MOUNTED types only: floor types (sewer exit, heat pump) keep
 *    `position` as their real anchor — never touched.
 *  - No usable wall (island scene, curved-only walls): the position stays —
 *    the engines' position-wins path still resolves it.
 *  - Applied by the X-ray reconcile effect inside its history-paused batch
 *    (framing/renderer.tsx): a drag stays ONE undo entry, and the host's
 *    space-detection sync treats the write as baseline, not an edit.
 *    Without an X-ray node on the level nothing normalizes — position-wins
 *    keeps working; the slider quirk only ever mattered alongside the panel.
 *
 * Pure: returns update ops for the caller's batch.
 */

type LooseNode = Record<string, unknown>

export type ServiceAnchorUpdate = {
  id: string
  data: { wallId: string; wallT: number; position: [number, number, number] }
}

export function normalizeServiceAnchors(
  nodes: Record<string, LooseNode>,
  levelId: string,
): ServiceAnchorUpdate[] {
  const updates: ServiceAnchorUpdate[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'bones:service' || node.parentId !== levelId) continue
    const serviceType = node.serviceType
    if (typeof serviceType !== 'string' || !WALL_MOUNTED_TYPES.has(serviceType as never)) continue
    const position = node.position as readonly unknown[] | undefined
    if (!isMovedPosition(position)) continue
    const p = position as readonly [number, number, number]
    const hit = nearestUsableWall(
      nodes as Record<string, Record<string, unknown>>,
      node as { parentId?: string | null },
      [p[0], p[2]],
    )
    if (!hit) continue
    const id = String(node.id ?? '')
    if (!id) continue
    updates.push({
      id,
      data: { wallId: hit.wallId, wallT: hit.t, position: [0, 0, 0] },
    })
  }
  return updates
}
