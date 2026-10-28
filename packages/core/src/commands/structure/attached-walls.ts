import type { AnyNode, AnyNodeId, SeparatorNode, WallNode } from '../../schema'
import { planAttachedWallUpdates, type WallPlanPoint } from '../../systems/wall/wall-move'
import { planAttachedSeparatorUpdates } from './move-separators'

/**
 * The writes that keep walls T'd into a moving wall on it
 * (`planAttachedWallUpdates`): each such wall's new ends and, where its start
 * moved, the doors, windows and wall items on it shifted along so they stay
 * where they were. A wall whose opening the stretch would leave off its ends
 * lets go instead. The invisible walls on it come along too
 * (`planAttachedSeparatorUpdates`), so a porch they close off it stays closed.
 * `exclude` are walls the move already rewrites.
 */
export function planAttachedWallChanges(
  nodes: Readonly<Record<string, AnyNode>>,
  movingWallId: string,
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
  nextStart: WallPlanPoint,
  nextEnd: WallPlanPoint,
  exclude: ReadonlySet<string> = new Set(),
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const moving = nodes[movingWallId]
  if (moving?.type !== 'wall') return []
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' &&
      node.parentId === moving.parentId &&
      node.id !== moving.id &&
      !exclude.has(node.id),
  )
  const children = Object.values(nodes).filter(
    (node) => 'position' in node && Array.isArray(node.position) && node.parentId,
  )
  const changes: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  for (const update of planAttachedWallUpdates(
    walls,
    originalStart,
    originalEnd,
    nextStart,
    nextEnd,
  )) {
    const wall = nodes[update.id] as WallNode
    const length = Math.hypot(update.end[0] - update.start[0], update.end[1] - update.start[1])
    const ux = (update.end[0] - update.start[0]) / length
    const uz = (update.end[1] - update.start[1]) / length
    // How far the old start sits along the wall from the new one.
    const shift = (wall.start[0] - update.start[0]) * ux + (wall.start[1] - update.start[1]) * uz
    const hosted = children.filter((child) => child.parentId === wall.id)
    const moved = hosted.map((child) => {
      const position = (child as AnyNode & { position: [number, number, number] }).position
      return { child, position, x: position[0] + shift }
    })
    if (moved.some(({ x }) => x < 0 || x > length)) continue
    changes.push({ id: wall.id as AnyNodeId, data: { start: update.start, end: update.end } })
    if (Math.abs(shift) < 1e-9) continue
    for (const { child, position, x } of moved) {
      changes.push({
        id: child.id as AnyNodeId,
        data: {
          position: [x, position[1], position[2]],
          ...('wallT' in child ? { wallT: x / length } : {}),
        } as Partial<AnyNode>,
      })
    }
  }
  const separators = Object.values(nodes).filter(
    (node): node is SeparatorNode =>
      node.type === 'separator' && node.parentId === moving.parentId && !exclude.has(node.id),
  )
  for (const update of planAttachedSeparatorUpdates(
    separators,
    originalStart,
    originalEnd,
    nextStart,
    nextEnd,
  ))
    changes.push({ id: update.id as AnyNodeId, data: { start: update.start, end: update.end } })
  return changes
}
