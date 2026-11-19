import { type AnyNode, TreeNode, treeFacts } from '@pascal-app/core'

/** The same solid-footprint rule as addTree, including courtyard holes. Alt never bypasses it. */
export function isTreePositionAllowed(
  node: TreeNode,
  position: readonly [number, number, number],
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  const candidate = TreeNode.safeParse({ ...node, position: [...position] })
  return candidate.success && treeFacts(candidate.data, nodes).trunkBuildingId === null
}
