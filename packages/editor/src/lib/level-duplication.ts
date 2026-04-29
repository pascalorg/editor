import { cloneLevelSubtree } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, AnyNodeId, LevelNode } from '@pascal-app/core/schema'

export type LevelDuplicatePreset =
  | 'everything'
  | 'structure'
  | 'structure-materials'
  | 'structure-furniture'

const NON_DUPLICABLE_NODE_TYPES = new Set<AnyNode['type']>(['scan', 'guide', 'spawn'])
const STRUCTURAL_NODE_TYPES = new Set<AnyNode['type']>([
  'level',
  'wall',
  'fence',
  'zone',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'window',
  'door',
])

function shouldKeepNode(node: AnyNode, preset: LevelDuplicatePreset) {
  if (NON_DUPLICABLE_NODE_TYPES.has(node.type)) return false
  if (preset === 'everything') return true
  if (preset === 'structure-furniture') return true
  if (preset === 'structure' || preset === 'structure-materials') {
    return STRUCTURAL_NODE_TYPES.has(node.type)
  }
  return true
}

function stripMaterials(node: AnyNode): AnyNode {
  const next = { ...node } as Record<string, unknown>

  switch (node.type) {
    case 'wall':
      delete next.material
      delete next.materialPreset
      delete next.interiorMaterial
      delete next.interiorMaterialPreset
      delete next.exteriorMaterial
      delete next.exteriorMaterialPreset
      break
    case 'slab':
    case 'ceiling':
    case 'fence':
    case 'roof-segment':
    case 'stair-segment':
    case 'window':
    case 'door':
      delete next.material
      delete next.materialPreset
      break
    case 'roof':
      delete next.material
      delete next.materialPreset
      delete next.topMaterial
      delete next.topMaterialPreset
      delete next.edgeMaterial
      delete next.edgeMaterialPreset
      delete next.wallMaterial
      delete next.wallMaterialPreset
      break
    case 'stair':
      delete next.material
      delete next.materialPreset
      delete next.railingMaterial
      delete next.railingMaterialPreset
      delete next.treadMaterial
      delete next.treadMaterialPreset
      delete next.sideMaterial
      delete next.sideMaterialPreset
      break
  }

  return next as AnyNode
}

function findLevelBuildingId(nodes: Record<AnyNodeId, AnyNode>, levelId: AnyNodeId) {
  for (const node of Object.values(nodes)) {
    if (node.type !== 'building' || !('children' in node) || !Array.isArray(node.children)) {
      continue
    }

    if ((node.children as AnyNodeId[]).includes(levelId)) {
      return node.id as AnyNodeId
    }
  }

  return undefined
}

export function buildLevelDuplicateCreateOps({
  nodes,
  level,
  levels,
  preset,
}: {
  nodes: Record<AnyNodeId, AnyNode>
  level: LevelNode
  levels: LevelNode[]
  preset: LevelDuplicatePreset
}) {
  const { clonedNodes, newLevelId } = cloneLevelSubtree(nodes, level.id)
  const parentBuildingId =
    (level.parentId as AnyNodeId | null) ?? findLevelBuildingId(nodes, level.id)
  const nextLevelNumber = level.level + 1
  const shiftedLevels = levels
    .filter((entry) => entry.id !== level.id && entry.level >= nextLevelNumber)
    .map((entry) => ({
      id: entry.id,
      level: entry.level + 1,
    }))

  const filteredNodes = clonedNodes
    .filter((node) => shouldKeepNode(node, preset))
    .map((node) => (preset === 'structure' ? stripMaterials(node) : node))

  const keptIds = new Set(filteredNodes.map((node) => node.id))

  const cleanedNodes = filteredNodes.map((node) => {
    if (!('children' in node) || !Array.isArray(node.children)) {
      return node
    }

    return {
      ...node,
      children: node.children.filter((childId) => keptIds.has(childId as AnyNodeId)),
    } as AnyNode
  })

  return {
    createOps: cleanedNodes.map((node) => ({
      node:
        node.id === newLevelId
          ? ({
              ...node,
              level: nextLevelNumber,
            } as AnyNode)
          : node,
      parentId:
        node.id === newLevelId
          ? parentBuildingId
          : ((node.parentId as AnyNodeId | null) ?? undefined),
    })),
    newLevelId,
    shiftedLevels,
  }
}
