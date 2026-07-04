import type { AnyNode } from '@pascal-app/core/schema'

type FactoryPatch = Record<string, unknown>
type NodeMap = Record<string, AnyNode | undefined>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function nodeMetadata(node: AnyNode | undefined) {
  return isRecord(node?.metadata) ? node.metadata : {}
}

function patchNodeMetadata(patch: FactoryPatch) {
  const node = isRecord(patch.node) ? patch.node : undefined
  return isRecord(node?.metadata) ? node.metadata : {}
}

function nodeStationId(node: AnyNode | undefined) {
  return stringValue(nodeMetadata(node).stationId)
}

function patchStationId(patch: FactoryPatch) {
  return stringValue(patchNodeMetadata(patch).stationId)
}

function parentStationId(node: AnyNode | undefined, nodes: NodeMap) {
  const parentId = typeof node?.parentId === 'string' ? node.parentId : undefined
  return parentId ? nodeStationId(nodes[parentId]) : undefined
}

function replacementParentId(nodes: NodeMap, stationId: string) {
  for (const node of Object.values(nodes)) {
    if (!node || nodeStationId(node) !== stationId) continue
    if (parentStationId(node, nodes) === stationId) continue
    if (typeof node.parentId === 'string' && node.parentId) return node.parentId
  }
  return undefined
}

export function stationRerunSpecFromResult(result: unknown) {
  if (!isRecord(result)) return null
  const metadata = isRecord(result.workflowRerun) ? result.workflowRerun : undefined
  const stationId = stringValue(metadata?.stationId)
  const stageId = stringValue(metadata?.stageId)
  const sourceRunId = stringValue(metadata?.sourceRunId)
  if (!(stationId && stageId && sourceRunId)) return null
  return { stationId, stageId, sourceRunId }
}

export function topLevelStationNodeIds(nodes: NodeMap, stationId: string) {
  return Object.values(nodes)
    .filter((node): node is AnyNode => {
      if (!node || nodeStationId(node) !== stationId) return false
      return parentStationId(node, nodes) !== stationId
    })
    .map((node) => String(node.id))
}

export function prepareStationRerunPatches(input: {
  result: unknown
  nodes: NodeMap
  patches: unknown[]
}) {
  const spec = stationRerunSpecFromResult(input.result)
  if (!spec) return input.patches
  const stationDeletes = topLevelStationNodeIds(input.nodes, spec.stationId).map((id) => ({
    op: 'delete',
    id,
  }))
  if (stationDeletes.length === 0) return input.patches
  const parentId = replacementParentId(input.nodes, spec.stationId)
  const prepared = input.patches.map((patch) => {
    if (!isRecord(patch) || patch.op !== 'create') return patch
    if (patchStationId(patch) !== spec.stationId) return patch
    const parentRef = isRecord(patch.node) ? stringValue(patch.node.parentId) : undefined
    const parentIsCreatedInBatch =
      parentRef &&
      input.patches.some(
        (candidate) =>
          isRecord(candidate) && isRecord(candidate.node) && candidate.node.id === parentRef,
      )
    if (parentIsCreatedInBatch || !parentId) return patch
    return { ...patch, parentId }
  })
  return [...stationDeletes, ...prepared]
}
