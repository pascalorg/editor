import {
  type AnyNode,
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
import { getSegmentGridStep, isAngleSnapActive } from '@pascal-app/editor'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'
import {
  resolveLeanToEdgeSnapTargets,
  resolveLeanToPlanCenter,
  resolveLeanToSpanResizeProposal,
} from './layout'
import { deriveLeanToResizePatch } from './parametrics'
import { moveLeanToAlongSlabEdge } from './placement'

type ResizePayload = { dimension: 'projection' | 'span'; side?: 1 | -1 }

export const leanToResizeAffordance: FloorplanAffordance<LeanToExtensionNode> = {
  start({ node, nodes, payload, initialPlanPoint, sceneApi }) {
    if (!sceneApi) return { affectedIds: [], apply() {}, canCommit: () => false }
    const wall = node.parentId
      ? (nodes[node.parentId as AnyNodeId] as WallNode | undefined)
      : undefined
    const { dimension, side = 1 } = payload as ResizePayload
    const outwardSign = Math.cos(node.rotation[1]) >= 0 ? 1 : -1
    let along: readonly [number, number]
    let outward: readonly [number, number]
    if (wall?.type === 'wall' && isCurvedWall(wall)) {
      const arcLength = Math.max(1e-6, getWallCurveLength(wall))
      const t = Math.max(0, Math.min(1, node.position[0] / arcLength))
      const frame = getWallCurveFrameAt(wall, t)
      along = [frame.tangent.x, frame.tangent.y]
      outward = [frame.normal.x * outwardSign, frame.normal.y * outwardSign]
    } else if (wall?.type === 'wall') {
      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const length = Math.max(1e-6, Math.hypot(dx, dz))
      along = [dx / length, dz / length]
      outward = [-along[1] * outwardSign, along[0] * outwardSign]
    } else {
      const cos = Math.cos(node.rotation[1])
      const sin = Math.sin(node.rotation[1])
      along = [cos, -sin]
      outward = [sin, cos]
    }
    const axis = dimension === 'projection' ? outward : along
    const initialAxis = initialPlanPoint[0] * axis[0] + initialPlanPoint[1] * axis[1]
    const initialValue = dimension === 'projection' ? node.projection : node.span
    let lastPatch: Partial<LeanToExtensionNode> = {}

    return {
      affectedIds: [node.id as AnyNodeId],
      apply({ planPoint, modifiers }) {
        const currentAxis = planPoint[0] * axis[0] + planPoint[1] * axis[1]
        const raw = initialValue + (currentAxis - initialAxis) * side
        const step = modifiers.altKey ? 0 : getSegmentGridStep()
        const value = Math.max(0.5, step > 0 ? snapScalar(raw, step) : raw)
        if (dimension === 'projection') {
          lastPatch = {
            projection: value,
            ...deriveLeanToResizePatch(node, { projection: value }),
          }
        } else if (wall?.type === 'wall') {
          const proposal = resolveLeanToSpanResizeProposal({
            node,
            wall,
            rawSpan: value,
            side: side > 0 ? 'right' : 'left',
            edgeSnapTargets: modifiers.altKey
              ? []
              : resolveLeanToEdgeSnapTargets(node, wall, nodes),
          })
          lastPatch = {
            span: proposal.span,
            autoSpan: false,
            position: proposal.position,
            ...(proposal.target
              ? {
                  highEdgeHeight: proposal.highEdgeHeight,
                  lowEdgeHeight: proposal.lowEdgeHeight,
                  pitch: proposal.pitch,
                }
              : {}),
          }
        } else {
          const centerShift = (side * (value - node.span)) / 2
          const proposedPosition: LeanToExtensionNode['position'] = [
            node.position[0] + along[0] * centerShift,
            node.position[1],
            node.position[2] + along[1] * centerShift,
          ]
          const resolved =
            node.hostKind === 'slab-edge'
              ? moveLeanToAlongSlabEdge(
                  { ...node, autoSpan: false, span: value },
                  [proposedPosition[0], proposedPosition[2]],
                  nodes as Record<AnyNodeId, AnyNode>,
                )
              : null
          lastPatch = {
            span: value,
            autoSpan: false,
            position: resolved?.position ?? proposedPosition,
            ...(resolved ? { hostSlabEdgeT: resolved.hostSlabEdgeT } : {}),
          }
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

export const leanToRotateAffordance: FloorplanAffordance<LeanToExtensionNode> = {
  start({ node, initialPlanPoint, sceneApi }) {
    if (!(sceneApi && node.hostKind === 'freestanding')) {
      return { affectedIds: [], apply() {}, canCommit: () => false }
    }
    const nodeId = node.id as AnyNodeId
    const [centerX, centerZ] = resolveLeanToPlanCenter(node)
    const rotationY = node.rotation[1]
    const center: [number, number] = [
      node.position[0] + centerX * Math.cos(rotationY) + centerZ * Math.sin(rotationY),
      node.position[2] - centerX * Math.sin(rotationY) + centerZ * Math.cos(rotationY),
    ]
    const initialAngle = Math.atan2(
      initialPlanPoint[1] - center[1],
      initialPlanPoint[0] - center[0],
    )
    let lastRotation = node.rotation[1]
    return {
      affectedIds: [nodeId],
      apply({ planPoint }) {
        const delta = rotateAffordanceDelta({
          center,
          initialAngle,
          planPoint,
          free: !isAngleSnapActive(),
        })
        lastRotation = node.rotation[1] - delta
        useLiveNodeOverrides.getState().set(nodeId, {
          rotation: [node.rotation[0], lastRotation, node.rotation[2]],
        })
        sceneApi.markDirty(nodeId)
      },
      canCommit: () => true,
      commit() {
        useLiveNodeOverrides.getState().clear(nodeId)
        sceneApi.update(nodeId, {
          rotation: [node.rotation[0], lastRotation, node.rotation[2]],
        })
      },
    }
  },
}
