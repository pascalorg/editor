import type { AnyNode, AnyNodeId } from '../schema'
import { deriveLegacyLevelHeight } from '../services/level-height'

/** A write's operations, as apply_patch and update_node carry them. */
export type LevelHeightWrite =
  | { op: 'create'; node: AnyNode }
  | { op: 'update'; id: string; data: Record<string, unknown> }
  | { op: 'delete'; id: string }

const round = (value: number) => Math.round(value * 100) / 100

/**
 * A level written without a height reads as legacy data: the editor's load derives its storey
 * plane from what it holds and rewrites its walls, stairs and ceilings to match, while a session
 * that wrote it reads 2.5 m (L68). A write that creates a level without one, or clears it, gets
 * the height the editor would derive, from what the level holds once the whole write lands (an
 * empty level: the default storey height), so every reader agrees. Fills the operations in place
 * and returns a note per level filled, for the write's answer.
 */
export function fillLevelHeights(
  ops: LevelHeightWrite[],
  scene: Readonly<Record<string, AnyNode>>,
): string[] {
  const after: Record<string, AnyNode> = { ...scene }
  for (const op of ops) {
    if (op.op === 'create') after[op.node.id] = op.node
    else if (op.op === 'delete') delete after[op.id]
    else if (after[op.id]) after[op.id] = { ...after[op.id], ...op.data } as AnyNode
  }

  const notes: string[] = []
  const derive = (levelId: string) => {
    const level = after[levelId]
    if (level?.type !== 'level') return null
    // The level's own list, and what names it as parent: a create lists no children yet.
    const held = Object.values(after)
      .filter((node) => node.parentId === levelId)
      .map((node) => node.id)
    const children = [...new Set([...(level.children ?? []), ...held])].filter((id) => after[id])
    const height = deriveLegacyLevelHeight(levelId, {
      ...after,
      [levelId]: { ...level, children },
    } as Record<AnyNodeId, AnyNode>)
    const holds = children.some((id) => after[id]?.type === 'wall' || after[id]?.type === 'ceiling')
    notes.push(
      holds
        ? `level ${levelId}: height ${round(height)} m derived from its walls and ceilings, as the editor reads a level written without one`
        : `level ${levelId}: height ${round(height)} m, the default storey height, as nothing on it gives one`,
    )
    return height
  }

  for (const op of ops) {
    if (op.op === 'create') {
      if (op.node.type !== 'level' || (op.node as { height?: unknown }).height != null) continue
      const height = derive(op.node.id)
      if (height !== null) (op.node as { height?: number }).height = height
    } else if (op.op === 'update' && 'height' in op.data && op.data.height == null) {
      if (after[op.id]?.type !== 'level') continue
      const height = derive(op.id)
      if (height !== null) op.data.height = height
    }
  }
  return notes
}
