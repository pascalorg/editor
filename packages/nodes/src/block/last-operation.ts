import type { AnyNodeId, BlockNode, BlockTopology, SceneApi } from '@pascal-app/core'
import type { SelectionAffordanceHistoryApi } from '@pascal-app/editor'
import {
  applyBlockCommand,
  type BlockCommand,
  type BlockCommandResult,
  type BlockSelection,
  blockSelectionVertexIds,
} from './commands'

type SuccessfulBlockCommandResult = Extract<BlockCommandResult, { ok: true }>

export type BlockOperationServices = {
  historyApi: SelectionAffordanceHistoryApi
  readOnly: boolean
  sceneApi: Pick<SceneApi, 'get' | 'update'>
}

export type BlockLastOperation = {
  baseTopology: BlockTopology
  command: BlockCommand
  historyDepth: number
  label: string
  nodeId: AnyNodeId
  resultSelection: BlockSelection
  resultTopology: BlockTopology
}

export type BlockLastOperationReplacement =
  | { ok: true; operation: BlockLastOperation }
  | { ok: false; error: string }

export type BlockOperationCommit =
  | { ok: true; changed: false }
  | {
      ok: true
      changed: true
      operation: BlockLastOperation
      result: SuccessfulBlockCommandResult
    }
  | { ok: false; error: string }

type RepeatSelection = BlockSelection & { activeId: string | null }
type Point = [number, number, number]

function sameTopology(left: BlockTopology, right: BlockTopology): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function selectionCentroid(topology: BlockTopology, selection: BlockSelection): Point | null {
  const selectedIds = blockSelectionVertexIds(topology, selection)
  const points = topology.vertices.filter((vertex) => selectedIds.has(vertex.id))
  if (points.length === 0) return null
  const total = points.reduce(
    (sum, vertex) => vertex.position.map((value, index) => sum[index]! + value) as Point,
    [0, 0, 0] as Point,
  )
  return total.map((value) => value / points.length) as Point
}

function commandForRepeat(
  command: BlockCommand,
  topology: BlockTopology,
  selection: RepeatSelection,
): BlockCommand | null {
  const activeId = selection.activeId ?? selection.ids.at(-1)
  switch (command.type) {
    case 'translate-components':
      return selection.ids.length > 0 ? { ...command, selection } : null
    case 'rotate-components': {
      const pivot = selectionCentroid(topology, selection)
      return pivot ? { ...command, selection, pivot } : null
    }
    case 'scale-components': {
      const pivot = selectionCentroid(topology, selection)
      return pivot ? { ...command, selection, pivot } : null
    }
    case 'extrude-faces':
      return selection.mode === 'face' && selection.ids.length > 0
        ? { ...command, faceIds: selection.ids }
        : null
    case 'inset-faces':
      return selection.mode === 'face' && selection.ids.length > 0
        ? { ...command, faceIds: selection.ids }
        : null
    case 'bevel-edges':
      return selection.mode === 'edge' && selection.ids.length > 0
        ? { ...command, edgeIds: selection.ids }
        : null
    case 'loop-cut':
      return selection.mode === 'edge' && activeId ? { ...command, edgeId: activeId } : null
    default:
      return null
  }
}

export function recordCommittedBlockOperation(
  services: BlockOperationServices,
  nodeId: AnyNodeId,
  label: string,
  baseTopology: BlockTopology,
  command: BlockCommand,
  result: SuccessfulBlockCommandResult,
): BlockLastOperation {
  return {
    baseTopology,
    command,
    historyDepth: services.historyApi.depth(),
    label,
    nodeId,
    resultSelection: result.selection,
    resultTopology: result.topology,
  }
}

export function commitBlockOperation(
  services: BlockOperationServices,
  nodeId: AnyNodeId,
  label: string,
  baseTopology: BlockTopology,
  command: BlockCommand,
): BlockOperationCommit {
  if (services.readOnly) return { ok: false, error: 'Scene is read-only' }
  const result = applyBlockCommand(baseTopology, command)
  if (!result.ok) return result
  if (sameTopology(baseTopology, result.topology)) return { ok: true, changed: false }

  services.sceneApi.update(nodeId, { topology: result.topology })
  return {
    ok: true,
    changed: true,
    operation: recordCommittedBlockOperation(
      services,
      nodeId,
      label,
      baseTopology,
      command,
      result,
    ),
    result,
  }
}

export function replaceCommittedBlockOperation(
  services: BlockOperationServices,
  operation: BlockLastOperation,
  command: BlockCommand,
): BlockLastOperationReplacement {
  if (services.readOnly) return { ok: false, error: 'Scene is read-only' }
  const current = services.sceneApi.get<BlockNode>(operation.nodeId)
  if (current?.type !== 'block' || !sameTopology(current.topology, operation.resultTopology)) {
    return { ok: false, error: 'The last operation is no longer the latest scene change' }
  }
  if (services.historyApi.depth() !== operation.historyDepth) {
    return { ok: false, error: 'Scene history changed after the last operation' }
  }

  const result = applyBlockCommand(operation.baseTopology, command)
  if (!result.ok) return result

  const restored = services.historyApi.replaceLatest(operation.historyDepth, () => {
    const baseline = services.sceneApi.get<BlockNode>(operation.nodeId)
    if (baseline?.type !== 'block' || !sameTopology(baseline.topology, operation.baseTopology)) {
      return false
    }
    services.sceneApi.update(operation.nodeId, { topology: result.topology })
    return true
  })
  if (!restored) return { ok: false, error: 'Could not restore the operation baseline' }

  return {
    ok: true,
    operation: recordCommittedBlockOperation(
      services,
      operation.nodeId,
      operation.label,
      operation.baseTopology,
      command,
      result,
    ),
  }
}

export function repeatCommittedBlockOperation(
  services: BlockOperationServices,
  operation: BlockLastOperation,
  selection: RepeatSelection,
): BlockLastOperationReplacement {
  if (services.readOnly) return { ok: false, error: 'Scene is read-only' }
  const current = services.sceneApi.get<BlockNode>(operation.nodeId)
  if (current?.type !== 'block' || !sameTopology(current.topology, operation.resultTopology)) {
    return { ok: false, error: 'The last operation is no longer the latest scene change' }
  }
  if (services.historyApi.depth() !== operation.historyDepth) {
    return { ok: false, error: 'Scene history changed after the last operation' }
  }
  const command = commandForRepeat(operation.command, current.topology, selection)
  if (!command) return { ok: false, error: 'The current selection cannot repeat this operation' }
  const result = applyBlockCommand(current.topology, command)
  if (!result.ok) return result
  services.sceneApi.update(operation.nodeId, { topology: result.topology })
  return {
    ok: true,
    operation: recordCommittedBlockOperation(
      services,
      operation.nodeId,
      operation.label,
      current.topology,
      command,
      result,
    ),
  }
}
