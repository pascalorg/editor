import {
  type AnyNodeId,
  type FloorplanAffordance,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  type LeanToExtensionNode,
  snapScalar,
  useLiveNodeOverrides,
  type WallNode,
} from '@pascal-app/core'
import { getSegmentGridStep } from '@pascal-app/editor'
import { deriveLeanToResizePatch } from './parametrics'

type ResizePayload = { dimension: 'projection' | 'span'; side?: 1 | -1 }

export const leanToResizeAffordance: FloorplanAffordance<LeanToExtensionNode> = {
  start({ node, nodes, payload, initialPlanPoint, sceneApi }) {
    const wall = node.parentId
      ? (nodes[node.parentId as AnyNodeId] as WallNode | undefined)
      : undefined
    if (wall?.type !== 'wall' || !sceneApi) {
      return { affectedIds: [], apply() {}, canCommit: () => false }
    }
    const { dimension, side = 1 } = payload as ResizePayload
    const outwardSign = Math.cos(node.rotation[1]) >= 0 ? 1 : -1
    let along: readonly [number, number]
    let outward: readonly [number, number]
    // On a curved host the drag axes are the wall arc's tangent / normal at
    // the lean-to's along-wall position, not the straight chord direction.
    if (isCurvedWall(wall)) {
      const arcLength = Math.max(1e-6, getWallCurveLength(wall))
      const t = Math.max(0, Math.min(1, node.position[0] / arcLength))
      const frame = getWallCurveFrameAt(wall, t)
      along = [frame.tangent.x, frame.tangent.y]
      outward = [frame.normal.x * outwardSign, frame.normal.y * outwardSign]
    } else {
      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const length = Math.max(1e-6, Math.hypot(dx, dz))
      along = [dx / length, dz / length]
      outward = [-along[1] * outwardSign, along[0] * outwardSign]
    }
    const axis = dimension === 'projection' ? outward : along
    const initialAxis = initialPlanPoint[0] * axis[0] + initialPlanPoint[1] * axis[1]
    const initialValue = dimension === 'projection' ? node.projection : node.span
    const initialPosition = node.position
    let lastPatch: Partial<LeanToExtensionNode> = {}

    return {
      affectedIds: [node.id as AnyNodeId],
      apply({ planPoint }) {
        const currentAxis = planPoint[0] * axis[0] + planPoint[1] * axis[1]
        const raw = initialValue + (currentAxis - initialAxis) * side
        const step = getSegmentGridStep()
        const value = Math.max(0.5, step > 0 ? snapScalar(raw, step) : raw)
        lastPatch =
          dimension === 'projection'
            ? { projection: value, ...deriveLeanToResizePatch(node, { projection: value }) }
            : {
                span: value,
                autoSpan: false,
                position: [
                  initialPosition[0] + (side * (value - initialValue)) / 2,
                  initialPosition[1],
                  initialPosition[2],
                ],
              }
        useLiveNodeOverrides.getState().set(node.id as AnyNodeId, lastPatch)
        sceneApi.markDirty(node.id as AnyNodeId)
      },
      canCommit: () => Object.keys(lastPatch).length > 0,
      commit() {
        useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
        sceneApi.update(node.id as AnyNodeId, lastPatch)
      },
    }
  },
}
