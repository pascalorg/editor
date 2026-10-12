import { type AnyNode, resolveWallFeaturePlacement, type WallNode } from '@pascal-app/core'

/** Trims end at feature mouths on the affected face; they do not wrap into the recess. */
export function wallFeatureTrimRanges(
  wall: WallNode,
  face: 'a' | 'b',
  nodes: Readonly<Record<string, AnyNode>>,
  bottom: number,
  height: number,
): [number, number][] {
  return Object.values(nodes).flatMap((node) => {
    if (node.type !== 'wall-feature' || node.parentId !== wall.id || !node.visible || !wall.visible)
      return []
    try {
      const p = resolveWallFeaturePlacement(nodes, node)
      if (p.face !== face || p.bounds.y1 <= bottom + 1e-6 || p.bounds.y0 >= bottom + height - 1e-6)
        return []
      return [[p.bounds.u0, p.bounds.u1] as [number, number]]
    } catch {
      return []
    }
  })
}
