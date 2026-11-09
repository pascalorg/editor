import {
  type AnyNode,
  type AnyNodeId,
  createSceneApi,
  nodeRegistry,
  resolveLevelId,
} from '@pascal-app/core'
import type { AgentOperation, SceneChanges } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import { cabinetHostedChildUpdates } from './hosted-resize'
import { cabinetPlacementNotice } from './placement-notice'
import { alignCabinetRun, fitCabinetWallFillers } from './run-finishing'

export const finishKitchenRun: AgentOperation<{ runId: string; action: 'align' | 'fill' }> = (
  before,
  input,
) => {
  const run = before[input.runId]
  if (run?.type !== 'cabinet')
    return refuse('cabinet_run_not_found', 'Choose a kitchen run to finish.')
  const nodes = { ...before } as Record<AnyNodeId, AnyNode>
  const updateNode = (id: AnyNodeId, data: Partial<AnyNode>) => {
    if (nodes[id]) nodes[id] = { ...nodes[id], ...data } as AnyNode
  }
  const deleteNode = (id: AnyNodeId) => {
    const node = nodes[id]
    if (!node) return
    for (const child of Object.values(nodes).filter((entry) => entry.parentId === id))
      deleteNode(child.id)
    const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    if (parent && 'children' in parent)
      updateNode(parent.id, {
        children: parent.children.filter((child) => child !== id),
      } as Partial<AnyNode>)
    delete nodes[id]
  }
  const scene = createSceneApi({
    getState: () => ({
      nodes,
      rootNodeIds: [],
      dirtyNodes: new Set<AnyNodeId>(),
      updateNode,
      deleteNode,
      createNode(node, parentId) {
        const parent = parentId ? nodes[parentId] : undefined
        nodes[node.id] = parentId ? { ...node, parentId } : node
        if (parent && 'children' in parent && !parent.children.some((id) => id === node.id))
          updateNode(parent.id, { children: [...parent.children, node.id] } as Partial<AnyNode>)
      },
      markDirty() {},
    }),
    temporal: { getState: () => ({ pause() {}, resume() {} }) },
  })
  if (input.action === 'align') alignCabinetRun(run, scene)
  else fitCabinetWallFillers(run, scene)
  const hosted = cabinetHostedChildUpdates(before as Record<AnyNodeId, AnyNode>, nodes)
  if (!hosted)
    return refuse(
      'hosted_items_unsupported',
      'Unable to finish while keeping hosted items supported. Move items on the countertop and try again.',
    )
  for (const [id, data] of hosted) updateNode(id, data)
  const changes: SceneChanges = { create: [], update: [], delete: [] }
  for (const [id, node] of Object.entries(nodes)) {
    if (!before[id])
      changes.create!.push({ node, ...(node.parentId ? { parentId: node.parentId } : {}) })
    else if (JSON.stringify(before[id]) !== JSON.stringify(node))
      changes.update!.push({ id, data: node })
  }
  for (const id of Object.keys(before)) if (!nodes[id as AnyNodeId]) changes.delete!.push(id)
  return {
    result: {
      runId: run.id,
      action: input.action,
      createdIds: changes.create!.map(({ node }) => node.id),
      updatedIds: changes.update!.map(({ id }) => id),
    },
    changes,
  }
}

export const checkKitchenClearance: AgentOperation<{ nodeId: string }> = (nodes, input) => {
  const node = nodes[input.nodeId]
  if (node?.type !== 'cabinet' && node?.type !== 'cabinet-module')
    return refuse('cabinet_not_found', 'Choose a kitchen run or module to check.')
  const levelId = resolveLevelId(node, nodes)
  const unavailable = Object.values(nodes).find(
    (candidate) =>
      'position' in candidate &&
      resolveLevelId(candidate, nodes) === levelId &&
      !nodeRegistry.has(candidate.type),
  )
  if (unavailable)
    return refuse(
      'node_capability_unavailable',
      `Load the ${unavailable.type} plugin definitions before checking kitchen clearance.`,
    )
  const notice = cabinetPlacementNotice(node, { nodes })
  return { result: { nodeId: node.id, clear: !notice, warning: notice?.line ?? null } }
}
