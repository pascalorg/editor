import {
  type AnyNode,
  type AnyNodeId,
  isDerivedNode,
  isRegistrySelectable,
  type LevelNode,
  nodeRegistry,
  resolveBuildingForLevel,
  resolveLevelId,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'

function isVisibleSelectableNode(node: AnyNode): boolean {
  if ((node as { visible?: boolean }).visible === false) return false
  return isRegistrySelectable(node.type)
}

/**
 * Derived construction (a room's automatic floor plate or ceiling) belongs to its rooms, so a box
 * never takes it along: a box round a porch would otherwise catch the house's shared floor plate,
 * and deleting the selection took the floor out from under every room on it. A click still selects
 * one on its own.
 */
const boxSelectable = (node: AnyNode) => !isDerivedNode(node)

export function collectSelectableCandidateIds(): string[] {
  const { levelId } = useViewer.getState().selection
  const { nodes } = useScene.getState()
  const { phase } = useEditor.getState()
  const result: string[] = []
  const seen = new Set<string>()
  const addNode = (node: AnyNode | undefined) => {
    if (
      !node ||
      node.type === 'zone' ||
      seen.has(node.id) ||
      (node as { visible?: boolean }).visible === false
    )
      return
    seen.add(node.id)
    result.push(node.id)
  }
  const visitLevelDescendant = (id: AnyNodeId) => {
    const node = nodes[id]
    if (
      !node ||
      node.type === 'zone' ||
      seen.has(node.id) ||
      (node as { visible?: boolean }).visible === false
    )
      return

    // A ceiling's hung lights and fans are still the box's; the ceiling is not.
    if (isRegistrySelectable(node.type) && boxSelectable(node)) {
      addNode(node)
    }

    const children = 'children' in node && Array.isArray(node.children) ? node.children : []
    for (const childId of children) {
      visitLevelDescendant(childId as AnyNodeId)
    }
  }

  if (phase === 'site') {
    for (const node of Object.values(nodes)) {
      if (node.type === 'building') addNode(node)
    }
    return result
  }

  if (!levelId) return []
  const levelNode = nodes[levelId as AnyNodeId] as LevelNode | undefined
  if (levelNode?.type !== 'level') return []

  for (const childId of levelNode.children) {
    visitLevelDescendant(childId as AnyNodeId)
  }

  const buildingId = resolveBuildingForLevel(levelId as AnyNodeId, nodes)
  for (const node of Object.values(nodes)) {
    if (!node || node.type === 'level' || !isVisibleSelectableNode(node) || !boxSelectable(node))
      continue

    const def = nodeRegistry.get(node.type)
    const isBuildingScoped = def?.floorplanScope === 'building'
    const parentId = (node as { parentId?: AnyNodeId | null }).parentId
    if (isBuildingScoped && buildingId && parentId === buildingId) {
      addNode(node)
      continue
    }

    if (!isBuildingScoped && resolveLevelId(node, nodes) === levelId) {
      addNode(node)
    }
  }

  return result
}
