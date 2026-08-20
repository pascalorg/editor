import {
  type AnyNodeId,
  type BlockTopology,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import {
  applyBlockCommand,
  type BlockCommand,
  type BlockCommandResult,
  type BlockSelection,
  blockSelectionVertexIds,
} from './commands'

type SuccessfulBlockCommandResult = Extract<BlockCommandResult, { ok: true }>

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
  nodeId: AnyNodeId,
  label: string,
  baseTopology: BlockTopology,
  command: BlockCommand,
  result: SuccessfulBlockCommandResult,
): BlockLastOperation {
  return {
    baseTopology,
    command,
    historyDepth: useScene.temporal.getState().pastStates.length,
    label,
    nodeId,
    resultSelection: result.selection,
    resultTopology: result.topology,
  }
}

export function replaceCommittedBlockOperation(
  operation: BlockLastOperation,
  command: BlockCommand,
): BlockLastOperationReplacement {
  const scene = useScene.getState()
  const current = scene.nodes[operation.nodeId]
  if (scene.readOnly) return { ok: false, error: 'Scene is read-only' }
  if (current?.type !== 'block' || !sameTopology(current.topology, operation.resultTopology)) {
    return { ok: false, error: 'The last operation is no longer the latest scene change' }
  }
  if (useScene.temporal.getState().pastStates.length !== operation.historyDepth) {
    return { ok: false, error: 'Scene history changed after the last operation' }
  }

  const result = applyBlockCommand(operation.baseTopology, command)
  if (!result.ok) return result

  let restored = false
  runAsSingleSceneHistoryStep(useScene, () => {
    useScene.temporal.getState().undo()
    const baseline = useScene.getState().nodes[operation.nodeId]
    restored = baseline?.type === 'block' && sameTopology(baseline.topology, operation.baseTopology)
    if (!restored) {
      useScene.temporal.getState().redo()
      return
    }
    useScene.getState().updateNode(operation.nodeId, { topology: result.topology })
  })
  if (!restored) return { ok: false, error: 'Could not restore the operation baseline' }

  return {
    ok: true,
    operation: recordCommittedBlockOperation(
      operation.nodeId,
      operation.label,
      operation.baseTopology,
      command,
      result,
    ),
  }
}

export function repeatCommittedBlockOperation(
  operation: BlockLastOperation,
  selection: RepeatSelection,
): BlockLastOperationReplacement {
  const scene = useScene.getState()
  const current = scene.nodes[operation.nodeId]
  if (scene.readOnly) return { ok: false, error: 'Scene is read-only' }
  if (current?.type !== 'block' || !sameTopology(current.topology, operation.resultTopology)) {
    return { ok: false, error: 'The last operation is no longer the latest scene change' }
  }
  if (useScene.temporal.getState().pastStates.length !== operation.historyDepth) {
    return { ok: false, error: 'Scene history changed after the last operation' }
  }
  const command = commandForRepeat(operation.command, current.topology, selection)
  if (!command) return { ok: false, error: 'The current selection cannot repeat this operation' }
  const result = applyBlockCommand(current.topology, command)
  if (!result.ok) return result
  useScene.getState().updateNode(operation.nodeId, { topology: result.topology })
  return {
    ok: true,
    operation: recordCommittedBlockOperation(
      operation.nodeId,
      operation.label,
      current.topology,
      command,
      result,
    ),
  }
}
