import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  defaultI18n,
  type FloorplanAffordance,
  type PipeSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, snapPointToGrid, useFloorplanMode } from '@pascal-app/editor'
import { planRunEndCapFollowUpdates } from '../shared/automatic-run-end-cap'
import { detectFittingEndpoint, planFittingEndpointReaim } from '../shared/fitting-endpoint-reaim'
import { editPipeGrade, pipeUpdatesPreserveGrades } from './grade-operation'
import { pipeGradesMatch, preservePipeGrades } from './slope'

type Point = [number, number, number]
type Update = { id: AnyNodeId; data: Partial<AnyNode> }

/** Shown when an endpoint drag (2D or 3D) is held because it would regrade or turn a collar. */
export const pipeGradeBlockedNotice = /* i18n */ {
  id: 'node.pipeSegment.gradeNotice.blocked',
  message:
    'This edit cannot preserve the pipe grade and connected collars. Adjust the fitting or use Grade and flow.',
}

export const pipeGradePointAffordance: FloorplanAffordance<PipeSegmentNode> = {
  start({ node, payload, nodes }) {
    const index = (payload as { pointIndex: number }).pointIndex
    const initialPath = node.path.map((p) => [...p] as Point)
    const point = initialPath[index]
    const isEndpoint = index === 0 || index === initialPath.length - 1
    // Like the 3D handles: a straight run whose other end sits on an elbow
    // swings that elbow to follow the drag instead of refusing the turn.
    const fittingEndpoint = isEndpoint
      ? detectFittingEndpoint('pipe-segment', initialPath, index, nodes)
      : null
    let updates: Update[] = []
    let noticeId: number | null = null
    const previewIds = new Set<AnyNodeId>()
    const clear = () => {
      for (const id of previewIds) {
        useLiveNodeOverrides.getState().clear(id)
        useScene.getState().markDirty(id)
      }
      previewIds.clear()
    }
    const showNotice = () => {
      const floorplan = useFloorplanMode.getState()
      if (noticeId !== null && floorplan.notice?.id === noticeId) return
      floorplan.showNotice(defaultI18n._(pipeGradeBlockedNotice))
      noticeId = useFloorplanMode.getState().notice?.id ?? null
    }
    const dismissNotice = () => {
      const floorplan = useFloorplanMode.getState()
      if (noticeId !== null && floorplan.notice?.id === noticeId) floorplan.dismissNotice()
      noticeId = null
    }

    const reaimUpdates = (dragged: Point): Update[] | null => {
      if (!fittingEndpoint) return null
      const constrained = preservePipeGrades(
        initialPath,
        initialPath.map((p, i) => (i === index ? dragged : p)),
        index,
      )
      const plan = constrained
        ? planFittingEndpointReaim(fittingEndpoint, index, constrained[index]!)
        : null
      if (!plan || !pipeGradesMatch(initialPath, plan.path)) return null
      const next: Update[] = [
        { id: node.id, data: { path: plan.path, wallAttachment: undefined } },
        plan.fittingUpdate,
        ...planRunEndCapFollowUpdates(
          node,
          { ...node, path: plan.path },
          index === 0 ? 'start' : 'end',
          nodes,
        ),
      ]
      return pipeUpdatesPreserveGrades(nodes, next) ? next : null
    }
    const gradedUpdates = (dragged: Point, detach: boolean): Update[] | null => {
      try {
        const outcome = editPipeGrade(
          nodes,
          { nodeId: node.id, action: 'endpoint', pointIndex: index, point: dragged, detach },
          { activeLevelId: node.parentId },
        )
        return (outcome.changes?.update ?? []).map((entry) => ({
          ...entry,
          id: entry.id as AnyNodeId,
        }))
      } catch {
        return null
      }
    }

    return {
      affectedIds: [
        ...new Set([
          node.id,
          ...(fittingEndpoint ? [fittingEndpoint.fitting.id as AnyNodeId] : []),
          ...analyzePortConnectivity(node, nodes).connections.map(
            (connection) => connection.nodeId,
          ),
        ]),
      ],
      apply({ planPoint, modifiers }) {
        if (!point) return
        const [x, z] = isGridSnapActive()
          ? snapPointToGrid([planPoint[0], planPoint[1]])
          : planPoint
        const dragged: Point = [x, point[1], z]
        const next =
          fittingEndpoint && !modifiers.altKey
            ? reaimUpdates(dragged)
            : gradedUpdates(dragged, modifiers.altKey)
        // A refused frame keeps the last valid preview, as the 3D handles do.
        if (!next) {
          showNotice()
          return
        }
        dismissNotice()
        clear()
        updates = next
        useLiveNodeOverrides
          .getState()
          .setMany(updates.map((entry) => [entry.id, entry.data as Record<string, unknown>]))
        for (const entry of updates) {
          previewIds.add(entry.id)
          useScene.getState().markDirty(entry.id)
        }
      },
      canCommit: () => updates.length > 0,
      commit() {
        dismissNotice()
        clear()
        useScene.getState().updateNodes(updates)
      },
    }
  },
}
