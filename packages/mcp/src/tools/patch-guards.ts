import {
  type NodeDeletionPlan,
  type NodeDeletionScene,
  nodeRegistry,
  planNodeDeletion,
  previewDefaultGutterRefresh,
  validateNodeRelations,
  wouldCreateHierarchyCycle,
} from '@pascal-app/core'
import { AnyNode, type AnyNodeId, nodeKindOf, parseNode } from '@pascal-app/core/schema'
import type { Patch } from '../bridge/scene-bridge'

export type PatchRefusalCode =
  | 'node_exists'
  | 'identity_change'
  | 'immutable_field'
  | 'invalid_parent'
  | 'invalid_update'
  | 'regenerated_default'

/**
 * A patch op refused because it would break node identity, the hierarchy or
 * the node's schema. apply_patch returns it as a tool error whose text is
 * JSON `{ code, patchIndex, id, message }`.
 */
export class PatchRefusedError extends Error {
  constructor(
    readonly code: PatchRefusalCode,
    readonly patchIndex: number,
    readonly nodeId: string,
    detail: string,
  ) {
    super(`${code}: patches[${patchIndex}] ${detail}`)
    this.name = 'PatchRefusedError'
  }
}

/**
 * Fields an update may restate but not change: `id` and `type` are the node's
 * identity, `object` and `children` its place in the graph. `parentId` stays
 * writable, checked below: the store reconciles both parents' `children`.
 */
const IMMUTABLE_FIELDS = [
  ['id', 'identity_change'],
  ['type', 'identity_change'],
  ['object', 'immutable_field'],
  ['children', 'immutable_field'],
] as const

const CORE_KINDS = new Set<string>(AnyNode.options.map(nodeKindOf))

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Schema issues of a node, keyed `path: message`, from its kind's schema: the
 * registered definition's, or the core per-kind schema. `null` only for a kind
 * with neither (a plugin kind this runtime has not registered), which is then
 * not validated.
 */
function schemaIssues(node: Record<string, unknown>): Set<string> | null {
  const type = node.type
  if (typeof type !== 'string') return null
  const schema = nodeRegistry.get(type)?.schema as
    | { safeParse: (value: unknown) => { success: boolean; error?: { issues: ZodIssueLike[] } } }
    | undefined
  if (!(schema || CORE_KINDS.has(type))) return null
  const result = schema ? schema.safeParse(node) : parseNode(node)
  const issues = result.success ? [] : (result.error?.issues ?? [])
  return new Set(issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
}

type ZodIssueLike = { code?: string; path: PropertyKey[]; message: string }

function withChild(parent: AnyNode, childId: string): AnyNode {
  const children = (parent as { children?: unknown }).children
  if (!Array.isArray(children) || children.includes(childId)) return parent
  return { ...parent, children: [...children, childId] } as AnyNode
}

function withoutChild(parent: AnyNode, childId: string): AnyNode {
  const children = (parent as { children?: unknown }).children
  if (!Array.isArray(children)) return parent
  return { ...parent, children: children.filter((id) => id !== childId) } as AnyNode
}

/**
 * Dry-runs a patch against the scene as each op leaves it and refuses:
 * - a create whose id is already present (`node_exists`): a silent replace
 *   orphans the old node's children;
 * - an update that changes `id`, `type`, `object` or `children`
 *   (`immutable_field`); restating the current value passes;
 * - an update whose merged node has schema issues the node did not have
 *   before (`invalid_update`); kinds without a schema in this runtime pass;
 * - any op on a node an earlier delete in the patch removed, or on a default
 *   gutter or downspout that delete regenerates, and any update of the roof
 *   segment holding them (`regenerated_default`).
 *
 * Deletes run through the bridge's own deletion preview (`planDeletion`; the
 * local bridge uses core's store planner), one call per run of consecutive
 * deletes as the bridge batches them, so cascades and wall merges are seen as
 * that bridge applies them. A bridge without a preview gets a stricter rule:
 * a create may not reuse any id present at the start of the patch.
 * An update of a roof segment unsettles the default gutters its refresh may
 * regenerate, as a delete does.
 * Lives in the tool layer so every bridge behind `apply_patch` inherits it.
 */
export function assertPatchKeepsIdentity(
  patches: readonly Patch[],
  nodes: Readonly<Record<string, AnyNode>>,
  rootNodeIds: readonly AnyNodeId[],
  planDeletion?: (scene: NodeDeletionScene, ids: AnyNodeId[]) => NodeDeletionPlan,
): void {
  const initialIds = new Set(Object.keys(nodes))
  let scene: NodeDeletionScene = {
    nodes: { ...nodes } as NodeDeletionScene['nodes'],
    rootNodeIds: [...rootNodeIds],
    collections: {},
  }
  const at = (id: string) => scene.nodes[id as AnyNodeId]
  const put = (node: AnyNode) => {
    scene.nodes[node.id as AnyNodeId] = node
  }

  // Default gutters and downspouts a delete run refreshes: the store may keep,
  // move or replace them with freshly minted ids, so later ops in the same
  // patch cannot address them reliably.
  const regenerated = new Map<string, number>()
  // Roof segments whose `children` that refresh rewrites: an update restating
  // their pre-delete children would bring back obsolete ids.
  const regeneratedHosts = new Map<string, number>()
  const refuseRegenerated = (index: number, id: string) => {
    const deleteIndex = regenerated.get(id)
    if (deleteIndex === undefined) return
    throw new PatchRefusedError(
      'regenerated_default',
      index,
      id,
      `"${id}" is a default gutter or downspout that the edit at patches[${deleteIndex}] regenerates. Address it in a separate apply_patch call.`,
    )
  }
  // Updating a roof or roof segment makes the store refresh that roof's
  // default gutters, with the same effect on ids as a delete's refresh.
  const unsettleRoofRefresh = (node: AnyNode, index: number) => {
    const roofId =
      node.type === 'roof' ? node.id : node.type === 'roof-segment' ? node.parentId : null
    if (!roofId) return
    const preview = previewDefaultGutterRefresh(scene.nodes, [roofId as AnyNodeId])
    for (const id of preview.unsettledIds) regenerated.set(id, index)
    for (const id of preview.regeneratedHostIds) regeneratedHosts.set(id, index)
  }
  let pendingDeletes: AnyNodeId[] = []
  const flushDeletes = (index: number) => {
    const plan = planDeletion
      ? planDeletion(scene, pendingDeletes)
      : planNodeDeletion(scene, pendingDeletes, { mintDefaults: false })
    for (const id of plan.unsettledIds) regenerated.set(id, index)
    for (const id of plan.regeneratedHostIds) regeneratedHosts.set(id, index)
    scene = { nodes: plan.nodes, rootNodeIds: plan.rootNodeIds, collections: plan.collections }
    pendingDeletes = []
  }

  patches.forEach((patch, index) => {
    if (patch.op === 'create') {
      // Parse like the store does, so defaults such as an empty `children`
      // list exist for later ops in the patch; the bridge reports schema errors.
      const parsed = parseNode(patch.node)
      const node = (parsed.success ? parsed.data : patch.node) as AnyNode & { id?: unknown }
      if (typeof node?.id !== 'string') return
      refuseRegenerated(index, node.id)
      const effectiveParentId = patch.parentId ?? (node.parentId as string | null | undefined)
      if (effectiveParentId) refuseRegenerated(index, effectiveParentId)
      if (at(node.id) || (!planDeletion && initialIds.has(node.id))) {
        throw new PatchRefusedError(
          'node_exists',
          index,
          node.id,
          planDeletion || at(node.id)
            ? `create id "${node.id}" already exists. Use op "update" to change it, or delete it earlier in the same patch to replace it.`
            : `create id "${node.id}" existed when the patch started, and this bridge cannot preview its deletes. Delete it in one apply_patch call and create it in the next.`,
        )
      }
      const parentId = patch.parentId ?? (node.parentId as string | null | undefined) ?? null
      if (patch.parentId !== undefined && !at(patch.parentId)) {
        throw new Error(
          `invalid patch: patches[${index}] create parentId "${patch.parentId}" not found`,
        )
      }
      put({ ...node, parentId } as AnyNode)
      const parent = parentId ? at(parentId) : undefined
      if (parent) put(withChild(parent, node.id))
      return
    }

    if (patch.op === 'update') {
      refuseRegenerated(index, patch.id)
      const hostDeleteIndex = regeneratedHosts.get(patch.id)
      if (hostDeleteIndex !== undefined) {
        throw new PatchRefusedError(
          'regenerated_default',
          index,
          patch.id,
          `the edit at patches[${hostDeleteIndex}] regenerates the default gutters and downspouts under "${patch.id}", so its children are not known yet. Update it in a separate apply_patch call.`,
        )
      }
      if (typeof patch.data?.parentId === 'string') refuseRegenerated(index, patch.data.parentId)
      const current = at(patch.id)
      if (!current)
        throw new Error(`invalid patch: patches[${index}] update id "${patch.id}" not found`)
      if (!patch.data || typeof patch.data !== 'object') return
      const data = patch.data as Record<string, unknown>
      for (const [field, code] of IMMUTABLE_FIELDS) {
        const before = (current as Record<string, unknown>)[field]
        if (field in data && !sameValue(data[field], before)) {
          throw new PatchRefusedError(
            code,
            index,
            patch.id,
            `update cannot change "${field}" of "${patch.id}" (${JSON.stringify(before)} → ${JSON.stringify(data[field])}). Create a new node, delete the old one, or reparent children through their own parentId.`,
          )
        }
      }
      const merged = { ...current, ...data } as AnyNode
      const issuesAfter = schemaIssues(merged as Record<string, unknown>)
      if (issuesAfter && issuesAfter.size > 0) {
        const issuesBefore = schemaIssues(current as Record<string, unknown>) ?? new Set<string>()
        const added = [...issuesAfter].filter((issue) => !issuesBefore.has(issue))
        if (added.length > 0) {
          throw new PatchRefusedError(
            'invalid_update',
            index,
            patch.id,
            `update of ${current.type} "${patch.id}" fails its schema: ${added.slice(0, 5).join('; ')}`,
          )
        }
      }
      if ('parentId' in data && data.parentId !== current.parentId) {
        const newParentId = typeof data.parentId === 'string' ? (data.parentId as AnyNodeId) : null
        if (wouldCreateHierarchyCycle(patch.id, newParentId, scene.nodes)) {
          throw new PatchRefusedError(
            'invalid_parent',
            index,
            patch.id,
            `update cannot move "${patch.id}" under ${JSON.stringify(data.parentId)}: it would create a hierarchy cycle.`,
          )
        }
        const newParent = typeof data.parentId === 'string' ? at(data.parentId) : undefined
        if (!(newParent && Array.isArray((newParent as { children?: unknown }).children))) {
          throw new PatchRefusedError(
            'invalid_parent',
            index,
            patch.id,
            `update cannot move "${patch.id}" under ${JSON.stringify(data.parentId)}: ${newParent ? `a ${newParent.type} holds no children` : 'no such node'}.`,
          )
        }
        const before = { ...scene.nodes }
        const oldParent = current.parentId ? at(current.parentId) : undefined
        if (oldParent) put(withoutChild(oldParent, patch.id))
        put(withChild(newParent, patch.id))
        put(merged)
        unsettleRoofRefresh(merged, index)
        try {
          validateNodeRelations(before, scene.nodes, [patch.id as AnyNodeId])
        } catch (err) {
          throw new PatchRefusedError(
            'invalid_parent',
            index,
            patch.id,
            `${newParent.type} "${newParent.id}" does not accept "${patch.id}": ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        return
      }
      put(merged)
      unsettleRoofRefresh(merged, index)
      return
    }

    if (patch.op === 'delete') {
      refuseRegenerated(index, patch.id)
      if (!at(patch.id) || pendingDeletes.includes(patch.id as AnyNodeId)) {
        throw new Error(`invalid patch: patches[${index}] delete id "${patch.id}" not found`)
      }
      pendingDeletes.push(patch.id as AnyNodeId)
      // The bridge applies a run of consecutive deletes as one deleteNodes
      // call, and wall merges and kind cascades depend on the whole id list,
      // so plan the run together once it ends.
      if (patches[index + 1]?.op !== 'delete') flushDeletes(index)
    }
  })
}
