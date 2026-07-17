import {
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  type MeasurementAnchor,
  MeasurementNode,
  type MeasurementNode as MeasurementNodeType,
  type MeasurementPoint,
  resolveLevelId,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { resolveSurfacePlanPointSnap } from '@pascal-app/editor'
import {
  constrainMeasurementPlanEditPoint,
  measurementEditAnchor,
  refreshMeasurementAnchorFallbacks,
  replaceMeasurementAnchor,
} from './edit'
import { matchMeasurementFeatureForNode, resolveMeasurementNode } from './resolve'

const SEMANTIC_FEATURE_SNAP_DISTANCE = 0.2
// Alt-bypass association mirrors the 3D tool's surface-verify tolerance: a
// feature binds only when the point already sits on it, never by attraction.
const SEMANTIC_FEATURE_BYPASS_DISTANCE = 0.012

function semanticWallAnchor(
  point: MeasurementPoint,
  wallIds: readonly string[],
  nodes: Parameters<typeof resolveLevelId>[1],
  maxDistance: number,
): { anchor?: MeasurementAnchor; point: MeasurementPoint } {
  const matches = wallIds.flatMap((id) => {
    const node = nodes[id]
    if (!node) return []
    const match = matchMeasurementFeatureForNode(
      node,
      (nodeId) => nodes[nodeId],
      point,
      maxDistance,
    )
    return match ? [{ match, node }] : []
  })
  const closest = matches.sort((a, b) => a.match.distance - b.match.distance)[0]
  if (!closest) return { point }
  return {
    anchor: {
      kind: 'feature',
      reference: {
        nodeId: closest.node.id,
        featureId: closest.match.feature.id,
        parameters: closest.match.parameters,
      },
      fallback: closest.match.point,
    },
    point: closest.match.point,
  }
}

export const measurementMoveVertexAffordance: FloorplanAffordance<MeasurementNodeType> = {
  start({ node, nodes, payload }): FloorplanAffordanceSession {
    const vertexIndex = (payload as { vertexIndex?: unknown }).vertexIndex
    const resolved = resolveMeasurementNode(node, (id) => nodes[id])
    const original = refreshMeasurementAnchorFallbacks(node.measurement, resolved.payload)
    const levelId = resolveLevelId(node, nodes)
    let latest: MeasurementNodeType['measurement'] | null = null

    if (!Number.isInteger(vertexIndex)) {
      return {
        affectedIds: [node.id],
        apply() {},
        canCommit: () => false,
      }
    }

    return {
      affectedIds: [node.id],
      apply({ planPoint, modifiers }) {
        // Measurement anchors always bind to real geometry — the construction
        // snapping-mode chip doesn't govern this analysis tool. Alt bypasses.
        // The raw fallback keeps free drags free: measurement geometry follows
        // the pointer, never the construction grid lattice.
        const snapped = resolveSurfacePlanPointSnap({
          rawPoint: [planPoint[0], planPoint[1]],
          fallbackPoint: [planPoint[0], planPoint[1]],
          excludeId: node.id,
          levelId,
          movingId: node.id,
          nodes,
          magnetic: !modifiers.altKey,
        })
        const point = constrainMeasurementPlanEditPoint(
          resolved.payload,
          vertexIndex as number,
          snapped.point,
        )
        const associated = point
          ? semanticWallAnchor(
              point,
              snapped.wallIds,
              nodes,
              modifiers.altKey ? SEMANTIC_FEATURE_BYPASS_DISTANCE : SEMANTIC_FEATURE_SNAP_DISTANCE,
            )
          : null
        const anchor =
          point && associated
            ? measurementEditAnchor(resolved.payload, associated.point, associated.anchor)
            : null
        const next = anchor
          ? replaceMeasurementAnchor(original, vertexIndex as number, anchor)
          : null
        if (!next || !MeasurementNode.safeParse({ ...node, measurement: next }).success) {
          latest = null
          useLiveNodeOverrides.getState().clear(node.id)
          return
        }
        latest = next
        useLiveNodeOverrides.getState().set(node.id, { measurement: next })
      },
      canCommit: () => latest !== null,
      commit() {
        const measurement = latest
        useLiveNodeOverrides.getState().clear(node.id)
        if (measurement) useScene.getState().updateNode(node.id, { measurement })
      },
    }
  },
}
