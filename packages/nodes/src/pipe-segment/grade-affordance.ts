import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type FloorplanAffordance,
  type PipeSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, snapPointToGrid } from '@pascal-app/editor'
import { editPipeGrade } from './grade-operation'

export const pipeGradePointAffordance: FloorplanAffordance<PipeSegmentNode> = {
  start({ node, payload, nodes }) {
    const index = (payload as { pointIndex: number }).pointIndex
    const point = node.path[index]
    let updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
    const previewIds = new Set<AnyNodeId>()
    const clear = () => {
      for (const id of previewIds) {
        useLiveNodeOverrides.getState().clear(id)
        useScene.getState().markDirty(id)
      }
      previewIds.clear()
    }
    return {
      affectedIds: [
        node.id,
        ...analyzePortConnectivity(node, nodes).connections.map((connection) => connection.nodeId),
      ],
      apply({ planPoint, modifiers }) {
        clear()
        updates = []
        if (!point) return
        const [x, z] = isGridSnapActive()
          ? snapPointToGrid([planPoint[0], planPoint[1]])
          : planPoint
        try {
          const outcome = editPipeGrade(
            nodes,
            {
              nodeId: node.id,
              action: 'endpoint',
              pointIndex: index,
              point: [x, point[1], z],
              detach: modifiers.altKey,
            },
            { activeLevelId: node.parentId },
          )
          updates = (outcome.changes?.update ?? []).map((entry) => ({
            ...entry,
            id: entry.id as AnyNodeId,
          }))
          useLiveNodeOverrides
            .getState()
            .setMany(updates.map((entry) => [entry.id, entry.data as Record<string, unknown>]))
          for (const entry of updates) {
            previewIds.add(entry.id)
            useScene.getState().markDirty(entry.id)
          }
        } catch {
          /* Invalid frames leave the committed route in place. */
        }
      },
      canCommit: () => updates.length > 0,
      commit() {
        clear()
        useScene.getState().updateNodes(updates)
      },
    }
  },
}
