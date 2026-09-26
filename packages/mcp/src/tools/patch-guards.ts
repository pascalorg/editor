import { type NodeDeletionScene, nodeRegistry, planNodeDeletion } from '@pascal-app/core'
import { type AnyNode, type AnyNodeId, parseNode } from '@pascal-app/core/schema'
import type { Patch } from '../bridge/scene-bridge'

export type PatchRefusalCode = 'node_exists' | 'immutable_field' | 'invalid_update'

/**
 * A patch op refused because it would break node identity or add schema
 * issues. The message starts with the code because MCP clients only see the
 * message; the code, patch index and node id also travel as `McpError` data.
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
 * Fields an update may restate but not change. `parentId` stays writable:
 * the store reconciles both parents' `children` on a reparent.
 */
const IMMUTABLE_FIELDS = ['id', 'type', 'object', 'children'] as const

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Schema issues of a node, keyed `path: message`, from its kind's schema: the
 * core per-kind schema, or the registered plugin definition's. `null` for a
 * kind this runtime has no schema for, which is then not validated.
 */
function schemaIssues(node: Record<string, unknown>): Set<string> | null {
  const type = node.type
  if (typeof type !== 'string') return null
  const schema = nodeRegistry.get(type)?.schema as
    | { safeParse: (value: unknown) => { success: boolean; error?: { issues: ZodIssueLike[] } } }
    | undefined
  const result = schema ? schema.safeParse(node) : parseNode(node)
  const issues = result.success ? [] : (result.error?.issues ?? [])
  if (!schema && issues.some((issue) => issue.code === 'invalid_union')) return null
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
 * - any op on a node an earlier delete in the patch removed.
 *
 * Deletes run through core's `planNodeDeletion`, the store's own planner, so
 * kind cascades and walls merged across a deleted junction are seen exactly.
 * Lives in the tool layer so every bridge behind `apply_patch` inherits it.
 */
export function assertPatchKeepsIdentity(
  patches: readonly Patch[],
  nodes: Readonly<Record<string, AnyNode>>,
  rootNodeIds: readonly AnyNodeId[],
): void {
  let scene: NodeDeletionScene = {
    nodes: { ...nodes } as NodeDeletionScene['nodes'],
    rootNodeIds: [...rootNodeIds],
    collections: {},
  }
  const at = (id: string) => scene.nodes[id as AnyNodeId]
  const put = (node: AnyNode) => {
    scene.nodes[node.id as AnyNodeId] = node
  }

  patches.forEach((patch, index) => {
    if (patch.op === 'create') {
      const node = patch.node as AnyNode & { id?: unknown }
      if (typeof node?.id !== 'string') return
      if (at(node.id)) {
        throw new PatchRefusedError(
          'node_exists',
          index,
          node.id,
          `create id "${node.id}" already exists. Use op "update" to change it, or delete it earlier in the same patch to replace it.`,
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
      const current = at(patch.id)
      if (!current)
        throw new Error(`invalid patch: patches[${index}] update id "${patch.id}" not found`)
      if (!patch.data || typeof patch.data !== 'object') return
      const data = patch.data as Record<string, unknown>
      for (const field of IMMUTABLE_FIELDS) {
        const before = (current as Record<string, unknown>)[field]
        if (field in data && !sameValue(data[field], before)) {
          throw new PatchRefusedError(
            'immutable_field',
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
        const oldParent = current.parentId ? at(current.parentId) : undefined
        if (oldParent) put(withoutChild(oldParent, patch.id))
        const newParent = typeof data.parentId === 'string' ? at(data.parentId) : undefined
        if (newParent) put(withChild(newParent, patch.id))
      }
      put(merged)
      return
    }

    if (patch.op === 'delete') {
      if (!at(patch.id))
        throw new Error(`invalid patch: patches[${index}] delete id "${patch.id}" not found`)
      const plan = planNodeDeletion(scene, [patch.id])
      scene = { nodes: plan.nodes, rootNodeIds: plan.rootNodeIds, collections: plan.collections }
    }
  })
}
