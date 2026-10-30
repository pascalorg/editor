import type { AnyNode, SeparatorNode, WallNode } from '@pascal-app/core'

/**
 * Invisible walls (room separators) as the wall snapping reads walls: a line
 * with no thickness. A drafted or dragged invisible-wall end catches another's
 * ends and body this way, and a pushed one lines up with them, as walls do
 * with walls. Never written to the scene.
 */
export function separatorWallLine(separator: SeparatorNode): WallNode {
  return {
    object: 'node',
    id: separator.id as string as WallNode['id'],
    type: 'wall',
    name: separator.name,
    parentId: separator.parentId,
    visible: true,
    metadata: {},
    children: [],
    start: separator.start,
    end: separator.end,
    thickness: 0,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

/** The invisible walls on `levelId` as wall lines, leaving out `exclude`. */
export function levelSeparatorLines(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string | null,
  exclude: ReadonlySet<string> = new Set(),
): WallNode[] {
  return Object.values(nodes).flatMap((node) =>
    node.type === 'separator' && node.parentId === levelId && !exclude.has(node.id)
      ? [separatorWallLine(node)]
      : [],
  )
}
