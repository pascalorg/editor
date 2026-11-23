import { refuse } from '../agent-tools/refusal'
import { cloneNodesInto, collectSubtree } from '../registry/subtree'
import type { AnyNode, AnyNodeId } from '../schema'
import { isDerivedNode } from '../store/derived-node-guard'
import { achievedChanges } from './achieved'
import { planNodeMove } from './move-plan'
import { levelIdOf, levelsOf } from './scene-queries'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

type DuplicateNodeInput = {
  ids: string[]
  offset?: number[]
  targetLevelId?: string
}

const DEDICATED_TOOL: Record<string, string> = {
  level: 'duplicate_level',
  zone: 'duplicate_zone',
  roof: 'create_roof',
  'roof-segment': 'create_roof',
}

// Kinds the editor does not copy node by node: scene structure with its own tools, plus the
// kinds whose definitions declare themselves not duplicable (a spawn is one per level).
const REFUSED_TYPES = new Set([
  'site',
  'building',
  'level',
  'zone',
  'roof',
  'roof-segment',
  'guide',
  'unit',
  'floor-opening',
  'stair-segment',
  'separator',
  'facade',
  'scan',
  'spawn',
])

/** The parent classes the editor copies a root from, as its clipboard roots are decided. */
function requireCopyableRoot(nodes: SceneNodes, node: AnyNode) {
  if (isDerivedNode(node) || REFUSED_TYPES.has(node.type)) {
    const dedicated = DEDICATED_TOOL[node.type]
    refuse(
      'duplicate_not_supported',
      `A ${node.type} is not copied node by node${dedicated ? `; use ${dedicated}` : ''}.`,
      { id: node.id, type: node.type },
    )
  }
  const parent = node.parentId ? nodes[node.parentId] : undefined
  const hostedRoot =
    (parent?.type === 'wall' &&
      (node.type === 'door' || node.type === 'window' || node.type === 'item')) ||
    (parent?.type === 'ceiling' && node.type === 'item') ||
    parent?.type === 'roof-segment'
  if (parent?.type !== 'level' && !hostedRoot)
    refuse(
      'duplicate_root_invalid',
      `${node.type} ${node.id} is copied as part of its parent${parent ? ` (${parent.type} ${parent.id})` : ''}; name the parent instead.`,
      { id: node.id, type: node.type, parentId: node.parentId ?? null },
    )
  return parent
}

function isDescendantOf(nodes: SceneNodes, id: string, rootIds: ReadonlySet<string>): boolean {
  let parentId = nodes[id]?.parentId
  while (parentId) {
    if (rootIds.has(parentId)) return true
    parentId = nodes[parentId]?.parentId
  }
  return false
}

/** Derived plates are rebuilt by the host's reconciler, as the editor's copy leaves them out. */
function withoutDerived(subtree: AnyNode[]): AnyNode[] {
  const pruned = new Set<string>()
  return subtree.filter((node, index) => {
    // collectSubtree lists parents before children, so a pruned parent prunes its subtree.
    if (index > 0 && (isDerivedNode(node) || (node.parentId && pruned.has(node.parentId)))) {
      pruned.add(node.id)
      return false
    }
    return true
  })
}

/** Host references inside the copied set point at the copies, as the editor's paste remaps them. */
function remapHostRefs(cloned: AnyNode[], idMap: ReadonlyMap<AnyNodeId, AnyNodeId>) {
  for (const node of cloned) {
    const record = node as unknown as Record<string, unknown>
    for (const field of ['wallId', 'roofSegmentId'] as const) {
      const value = record[field]
      if (typeof value === 'string') {
        const fresh = idMap.get(value as AnyNodeId)
        if (fresh) record[field] = fresh
      }
    }
  }
}

/** A stair copied to another floor climbs from that floor, as the editor's paste re-aims it. */
function reaimStairs(nodes: SceneNodes, cloned: AnyNode[], targetLevelId: string | undefined) {
  if (!targetLevelId) return
  const target = nodes[targetLevelId]
  if (target?.type !== 'level') return
  const next = levelsOf(nodes).find(
    (level) => level.parentId === target.parentId && level.level > target.level,
  )
  for (const node of cloned) {
    if (node.type !== 'stair') continue
    const stair = node as unknown as Record<string, unknown>
    stair.fromLevelId = targetLevelId
    stair.toLevelId = next?.id ?? null
  }
}

/**
 * `duplicate_node`: the editor's Duplicate — the same clone its duplicate-without-move path
 * makes (`collectSubtree` + `cloneNodesInto`), its clipboard's root rules, and its paste's
 * host-reference remap, with the offset seated by the same plan as `move_node`.
 */
export const duplicateNode: AgentOperation<DuplicateNodeInput> = (nodes, input) => {
  const targetLevel = input.targetLevelId ? nodes[input.targetLevelId] : undefined
  if (input.targetLevelId && targetLevel?.type !== 'level')
    refuse('level_not_found', `Level not found: ${input.targetLevelId}.`, {
      levelId: input.targetLevelId,
    })

  const requested = [...new Set(input.ids)]
  for (const id of requested) {
    if (!nodes[id]) refuse('node_not_found', `Node not found: ${id}.`, { id })
  }
  const roots: AnyNode[] = []
  const skippedIds: string[] = []
  for (const id of requested) {
    const node = nodes[id] as AnyNode
    const parent = requireCopyableRoot(nodes, node)
    if (isDescendantOf(nodes, id, new Set(requested.filter((other) => other !== id)))) {
      skippedIds.push(id)
      continue
    }
    if (targetLevel && parent?.type !== 'level' && levelIdOf(nodes, id) !== targetLevel.id)
      refuse(
        'hosted_root_level',
        `${node.type} ${id} is hosted on ${parent?.type} ${parent?.id} on another level; copy its host, or copy it without targetLevelId.`,
        { id, hostId: parent?.id ?? null, targetLevelId: targetLevel.id },
      )
    roots.push(node)
  }

  const clonedAll: AnyNode[] = []
  const idMap = new Map<AnyNodeId, AnyNodeId>()
  const copies: { sourceId: string; copyId: string; type: string; descendantCount: number }[] = []
  for (const root of roots) {
    const subtree = collectSubtree(nodes as Record<AnyNodeId, AnyNode>, root.id as AnyNodeId)
    if (!subtree) refuse('node_not_found', `Node not found: ${root.id}.`, { id: root.id })
    const members = withoutDerived([subtree.root, ...subtree.descendants])
    const parentId = (
      targetLevel && nodes[root.parentId ?? '']?.type === 'level' ? targetLevel.id : root.parentId
    ) as AnyNodeId
    const cloned = cloneNodesInto(members, { rootId: root.id as AnyNodeId, parentId })
    for (const [source, fresh] of cloned.idMap) idMap.set(source, fresh)
    clonedAll.push(...cloned.nodes)
    copies.push({
      sourceId: root.id,
      copyId: cloned.rootId,
      type: root.type,
      descendantCount: cloned.nodes.length - 1,
    })
  }
  remapHostRefs(clonedAll, idMap)
  reaimStairs(nodes, clonedAll, input.targetLevelId)

  const offset = input.offset ?? [0, 0]
  if (offset[0] || offset[1]) {
    const withClones: Record<string, AnyNode> = { ...nodes }
    for (const node of clonedAll) withClones[node.id] = node
    for (const copy of copies) {
      const clone = withClones[copy.copyId] as AnyNode
      const plan = planNodeMove(withClones, clone, { by: offset }, { checkOverlap: false })
      Object.assign(clone, plan.data)
    }
  }

  const changes: SceneChanges = {
    create: clonedAll.map((node) => ({ node, parentId: node.parentId ?? undefined })),
  }
  return {
    result: {
      ok: true as const,
      copies,
      totalCreated: clonedAll.length,
      skippedIds,
      message: `Duplicated ${copies.length} node${copies.length === 1 ? '' : 's'} (${clonedAll.length} created)`,
      achieved: achievedChanges(nodes, changes),
    },
    changes,
  }
}
