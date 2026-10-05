import { type AnyNode, type AnyNodeId, type LevelNode, UnitNode } from '../schema'
import { cloneLevelSubtree } from '../utils/clone-scene-graph'

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

/**
 * Material field keys per kind, used by the `structure` duplicate preset
 * to strip materials from the cloned subtree. Lookup table replaces the
 * legacy per-kind switch — the Phase 6 grep gate flagged `case '<kind>':`
 * in this file as the remaining per-kind dispatch outside the registry.
 *
 * Future: move this to a `capabilities.materialFields` declaration on
 * each kind's `NodeDefinition` so adding a new kind with materials is a
 * registry-only edit. Today the registry doesn't surface material fields
 * in a uniform way (each kind's panel reads / writes them directly), so
 * this map mirrors the legacy behavior 1:1.
 */
const MATERIAL_FIELDS_BY_KIND: Record<string, ReadonlyArray<string>> = {
  wall: [
    'material',
    'materialPreset',
    'interiorMaterial',
    'interiorMaterialPreset',
    'exteriorMaterial',
    'exteriorMaterialPreset',
  ],
  slab: ['material', 'materialPreset'],
  ceiling: ['material', 'materialPreset'],
  fence: ['material', 'materialPreset'],
  shelf: ['material', 'materialPreset'],
  'roof-segment': ['material', 'materialPreset'],
  'stair-segment': ['material', 'materialPreset'],
  window: ['material', 'materialPreset'],
  door: ['material', 'materialPreset'],
  roof: [
    'material',
    'materialPreset',
    'topMaterial',
    'topMaterialPreset',
    'edgeMaterial',
    'edgeMaterialPreset',
    'wallMaterial',
    'wallMaterialPreset',
  ],
  stair: [
    'material',
    'materialPreset',
    'railingMaterial',
    'railingMaterialPreset',
    'treadMaterial',
    'treadMaterialPreset',
    'sideMaterial',
    'sideMaterialPreset',
  ],
}

function stripMaterials(node: AnyNode): AnyNode {
  const fields = MATERIAL_FIELDS_BY_KIND[node.type]
  if (!fields) return node
  const next = { ...node } as Record<string, unknown>
  for (const field of fields) delete next[field]
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

/** The building a level belongs to; a bootstrap level may only be listed in its children. */
export function levelBuildingId(nodes: Record<AnyNodeId, AnyNode>, level: LevelNode) {
  return (level.parentId as AnyNodeId | null) ?? findLevelBuildingId(nodes, level.id)
}

export function buildLevelDuplicateCreateOps({
  nodes,
  level,
  levels,
  preset,
  position = 'above',
}: {
  nodes: Record<AnyNodeId, AnyNode>
  level: LevelNode
  levels: LevelNode[]
  preset: LevelDuplicatePreset
  /** Below, the copy takes the original's floor and the original moves up with the rest. */
  position?: 'above' | 'below'
}) {
  const { clonedNodes, newLevelId, idMap } = cloneLevelSubtree(nodes, level.id)
  const parentBuildingId = levelBuildingId(nodes, level)
  const nextLevelNumber = position === 'above' ? level.level + 1 : level.level
  // Only the floors in the way move up: a free floor index above the copy (floors deleted before
  // copying, as the agents' build guide does) is filled, not carried up. Pushing every floor above
  // sent Victor run 10's floor 8 from index 7 to 10.
  const shiftedLevels: { id: string; level: number }[] = []
  let free = nextLevelNumber
  for (const entry of levels
    .filter(
      (candidate) =>
        (position === 'below' || candidate.id !== level.id) && candidate.level >= nextLevelNumber,
    )
    .sort((a, b) => a.level - b.level)) {
    if (entry.level > free) break
    shiftedLevels.push({ id: entry.id, level: entry.level + 1 })
    free = entry.level + 1
  }

  const filteredNodes = clonedNodes
    .filter((node) => shouldKeepNode(node, preset))
    .map((node) => (preset === 'structure' ? stripMaterials(node) : node))

  const keptIds = new Set(filteredNodes.map((node) => node.id))

  const cleanedNodes = filteredNodes.map((node) => {
    if (!('children' in node && Array.isArray(node.children))) {
      return node
    }

    return {
      ...node,
      children: node.children.filter((childId) => keptIds.has(childId as AnyNodeId)),
    } as AnyNode
  })

  if (parentBuildingId && nodes[parentBuildingId]?.type === 'building') {
    for (const unit of Object.values(nodes)) {
      if (
        unit.type !== 'unit' ||
        unit.parentId !== parentBuildingId ||
        unit.members.length === 0 ||
        !unit.members.every((id) => {
          const zone = nodes[id]
          const remapped = idMap.get(id)
          return (
            zone?.type === 'zone' &&
            zone.parentId === level.id &&
            remapped !== undefined &&
            keptIds.has(remapped as AnyNodeId)
          )
        })
      )
        continue
      cleanedNodes.push(
        UnitNode.parse({
          ...unit,
          id: undefined,
          parentId: parentBuildingId,
          name: `${unit.name} copy`,
          members: unit.members.map((id) => idMap.get(id)),
        }),
      )
    }
  }

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
    skippedNodes: clonedNodes.filter((node) => !keptIds.has(node.id as AnyNodeId)),
  }
}
