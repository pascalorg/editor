import { floorPlateAtGroundContact, supportDerivedFloorHeight } from '../lib/floor-foundation-datum'
import { expandFloorIntentChanges } from '../lib/floor-intent-changes'
import { footprintIoU } from '../lib/floor-plates'
import { getDefaultLevelName } from '../lib/level-name'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  generateId,
  type LevelNode,
  UnitNode,
} from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import { isDerivedNode } from '../store/derived-node-guard'
import { cloneLevelSubtree, remapNodeReferences } from '../utils/clone-scene-graph'

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
  // sent a tall build's floor 8 from index 7 to 10.
  const shiftedLevels: { id: LevelNode['id']; level: number; name?: undefined }[] = []
  let free = nextLevelNumber
  for (const entry of levels
    .filter(
      (candidate) =>
        (position === 'below' || candidate.id !== level.id) && candidate.level >= nextLevelNumber,
    )
    .sort((a, b) => a.level - b.level)) {
    if (entry.level > free) break
    shiftedLevels.push({
      id: entry.id,
      level: entry.level + 1,
      // A stored placeholder would pin the old floor's name; cleared, it reads by its new place.
      ...(entry.name === getDefaultLevelName(entry.level) || entry.name === `Level ${entry.level}`
        ? { name: undefined }
        : {}),
    })
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

  const copy = cleanedNodes.find((node) => node.id === newLevelId) as LevelNode
  copy.level = nextLevelNumber
  // Unnamed like a level from the add buttons, so it reads by its place in the building.
  delete copy.name
  copy.baseElevation = 0
  copy.parentId = parentBuildingId ?? null
  const draft = {
    ...nodes,
    ...Object.fromEntries(shiftedLevels.map(({ id, ...data }) => [id, { ...nodes[id], ...data }])),
    ...Object.fromEntries(cleanedNodes.map((node) => [node.id, node])),
  } as Record<AnyNodeId, AnyNode>

  // A ground footprint carries its lift into the storey stack. Repeating
  // that lift on its upper copy would add the foundation height a second time.
  const sourceByCopy = new Map([...idMap].map(([source, target]) => [target, source]))
  const constructionChanges = Object.values(draft).flatMap((node) => {
    const source = nodes[(sourceByCopy.get(node.id) ?? node.id) as AnyNodeId]
    if (
      node.type !== 'slab' ||
      node.plateRole !== 'base' ||
      source?.type !== 'slab' ||
      !(
        floorPlateAtGroundContact(nodes, source) ||
        (sourceByCopy.has(node.id) && source.foundation?.type === 'solid')
      ) ||
      floorPlateAtGroundContact(draft, node)
    )
      return []
    const reference = supportDerivedFloorHeight(draft, node)
    return [
      {
        id: node.id,
        data: {
          floorHeight: undefined,
          referenceFloorElevation: reference,
          elevation: reference - DEFAULT_SLAB_ELEVATION + node.thickness,
          foundation: { type: 'none' as const },
        } as Partial<AnyNode>,
      },
    ]
  })
  for (const { id, data } of expandFloorIntentChanges(draft, constructionChanges)) {
    draft[id] = { ...draft[id], ...data } as AnyNode
    for (const [key, value] of Object.entries(data))
      if (value === undefined) delete (draft[id] as Record<string, unknown>)[key]
  }

  const surfaces = cleanedNodes.filter(isDerivedNode).map((node) => draft[node.id] as typeof node)
  for (const surface of surfaces) delete draft[surface.id]
  draft[newLevelId] = { ...copy, children: copy.children.filter((id) => !!draft[id]) }
  let generated = reconcileSceneStructure({
    nodes: draft,
    levelIds: [newLevelId],
    mintId: generateId,
  }).nodes as Record<string, AnyNode>
  const surfaceIds = new Map<string, string>()
  for (const surface of surfaces) {
    const linked =
      surface.type === 'slab' ? surface.zoneIds : surface.type === 'ceiling' ? [surface.zoneId] : []
    const target = Object.values(generated)
      .filter(
        (node) =>
          node.parentId === newLevelId &&
          node.type === surface.type &&
          (node.type === 'slab' && surface.type === 'slab'
            ? node.plateRole === surface.plateRole &&
              node.zoneIds?.some((id) => linked?.includes(id))
            : node.type === 'ceiling' && linked?.includes(node.zoneId)),
      )
      .sort((a, b) => {
        if (a.id === surface.id) return -1
        if (b.id === surface.id) return 1
        if (!isDerivedNode(a) || !isDerivedNode(b)) return 0
        const footprint = { outer: surface.polygon, holes: surface.holes ?? [] }
        return (
          footprintIoU(footprint, { outer: b.polygon, holes: b.holes ?? [] }) -
          footprintIoU(footprint, { outer: a.polygon, holes: a.holes ?? [] })
        )
      })[0]
    if (!target) continue
    surfaceIds.set(surface.id, target.id)
    if (target.type === 'slab' && surface.type === 'slab' && target.plateRole === 'base') {
      const {
        thickness,
        elevation,
        floorHeight,
        referenceFloorElevation,
        foundation,
        material,
        materialPreset,
        slots,
        name,
      } = surface
      generated[target.id] = {
        ...target,
        thickness,
        elevation,
        floorHeight,
        referenceFloorElevation,
        foundation,
        material,
        materialPreset,
        slots,
        name,
      }
    }
    if (target.type === 'ceiling' && surface.type === 'ceiling')
      generated[target.id] = {
        ...target,
        height: surface.height,
        material: surface.material,
        materialPreset: surface.materialPreset,
        slots: surface.slots,
      }
  }
  // Everything hosted on a copied surface (ceiling lights, supports, decks,
  // lean-tos, hangers) follows it to its regenerated id.
  for (const node of Object.values(generated))
    if (sourceByCopy.has(node.id)) generated[node.id] = remapNodeReferences(node, surfaceIds)
  for (const id of surfaceIds.values()) {
    const surface = generated[id]
    if (surface?.type === 'ceiling')
      generated[id] = {
        ...surface,
        children: Object.values(generated)
          .filter((node) => node.parentId === id)
          .map((node) => node.id as CeilingNode['children'][number]),
      }
  }
  generated = reconcileSceneStructure({
    nodes: generated,
    levelIds: [newLevelId],
    mintId: generateId,
  }).nodes as Record<string, AnyNode>
  const created = Object.values(generated).filter((node) => !nodes[node.id])
  const updateOps = Object.values(generated).flatMap((node) => {
    const old = nodes[node.id]
    if (!old || JSON.stringify(old) === JSON.stringify(node)) return []
    const data = Object.fromEntries(
      [...new Set([...Object.keys(old), ...Object.keys(node)])]
        .filter(
          (key) =>
            JSON.stringify((old as Record<string, unknown>)[key]) !==
            JSON.stringify((node as Record<string, unknown>)[key]),
        )
        .map((key) => [key, (node as Record<string, unknown>)[key]]),
    ) as Partial<AnyNode>
    const rebase = constructionChanges.find((change) => change.id === node.id)
    return [{ id: node.id, data: { ...data, ...rebase?.data } as Partial<AnyNode> }]
  })
  return {
    createOps: created.map((node) => ({
      node,
      parentId:
        node.id === newLevelId
          ? parentBuildingId
          : ((node.parentId as AnyNodeId | null) ?? undefined),
    })),
    newLevelId,
    shiftedLevels,
    updateOps,
    skippedNodes: clonedNodes.filter((node) => !keptIds.has(node.id as AnyNodeId)),
  }
}
