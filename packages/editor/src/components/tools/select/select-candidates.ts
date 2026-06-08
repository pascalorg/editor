import {
  type AnyNode,
  type AnyNodeId,
  isRegistrySelectable,
  type LevelNode,
  nodeRegistry,
  resolveBuildingForLevel,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'

export function isFurnishSelectableCandidate(node: AnyNode): boolean {
  if (node.type === 'item') {
    return node.asset.category !== 'door' && node.asset.category !== 'window'
  }

  const def = nodeRegistry.get(node.type)
  return Boolean(def?.category === 'furnish' && def.capabilities.selectable)
}

export function isStructureSelectableCandidate(node: AnyNode): boolean {
  if (
    node.type === 'wall' ||
    node.type === 'fence' ||
    node.type === 'column' ||
    node.type === 'elevator' ||
    node.type === 'slab' ||
    node.type === 'ceiling' ||
    node.type === 'roof' ||
    node.type === 'stair' ||
    node.type === 'spawn' ||
    node.type === 'window' ||
    node.type === 'door'
  ) {
    return true
  }

  if (node.type === 'item') {
    return node.asset.category === 'door' || node.asset.category === 'window'
  }

  const def = nodeRegistry.get(node.type)
  return Boolean(def && def.category !== 'furnish' && def.capabilities.selectable)
}

export function collectSelectableCandidateIds(): string[] {
  const { levelId } = useViewer.getState().selection
  const { nodes } = useScene.getState()
  const { phase, structureLayer } = useEditor.getState()
  const result: string[] = []
  const seen = new Set<string>()
  const addNode = (node: AnyNode | undefined) => {
    if (!node || seen.has(node.id)) return
    seen.add(node.id)
    result.push(node.id)
  }

  if (phase === 'site') {
    for (const node of Object.values(nodes)) {
      if (node.type === 'building') addNode(node)
    }
    return result
  }

  if (!levelId) return []
  const levelNode = nodes[levelId as AnyNodeId] as LevelNode | undefined
  if (!levelNode || levelNode.type !== 'level') return []

  if (phase === 'structure' && structureLayer === 'zones') {
    for (const childId of levelNode.children) {
      const node = nodes[childId as AnyNodeId]
      if (node?.type === 'zone') addNode(node)
    }
    return result
  }

  for (const childId of levelNode.children) {
    const node = nodes[childId as AnyNodeId]
    if (!node) continue

    if (phase === 'furnish') {
      if (isFurnishSelectableCandidate(node)) addNode(node)
      continue
    }

    if (node.type === 'wall' || node.type === 'fence') {
      addNode(node)
      const hostedChildren = 'children' in node && Array.isArray(node.children) ? node.children : []
      for (const hostedChildId of hostedChildren) {
        const child = nodes[hostedChildId as AnyNodeId]
        if (!child) continue
        if (
          child.type === 'window' ||
          child.type === 'door' ||
          (child.type === 'item' &&
            (child.asset.category === 'door' || child.asset.category === 'window'))
        ) {
          addNode(child)
        }
      }
      continue
    }

    if (isStructureSelectableCandidate(node)) {
      addNode(node)
    }
  }

  const buildingId = resolveBuildingForLevel(levelId as AnyNodeId, nodes)
  const buildingNode = buildingId ? nodes[buildingId] : undefined
  const buildingChildren =
    buildingNode && 'children' in buildingNode && Array.isArray(buildingNode.children)
      ? (buildingNode.children as AnyNodeId[])
      : []
  for (const childId of buildingChildren) {
    const node = nodes[childId]
    if (!node || node.type === 'level' || !isRegistrySelectable(node.type)) continue
    if (phase === 'furnish') {
      if (isFurnishSelectableCandidate(node)) addNode(node)
    } else if (isStructureSelectableCandidate(node)) {
      addNode(node)
    }
  }

  return result
}
