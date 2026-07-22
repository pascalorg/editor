import {
  ConstructionDimensionNode,
  type ConstructionDimensionNode as ConstructionDimensionNodeType,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  type MeasurementAnchor,
  type MeasurementPoint,
  resolveLevelId,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  resolveSurfacePlanPointSnap,
  useEditor,
} from '@pascal-app/editor'
import { matchMeasurementFeatureForNode, resolveMeasurementAnchor } from '../measurement/resolve'

const SEMANTIC_FEATURE_SNAP_DISTANCE = 0.2
const SEMANTIC_FEATURE_BYPASS_DISTANCE = 0.012

function semanticWitnessAnchor(
  point: MeasurementPoint,
  wallIds: readonly string[],
  nodes: Parameters<typeof resolveLevelId>[1],
  maxDistance: number,
): MeasurementAnchor {
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
  if (!closest) return point
  return {
    kind: 'feature',
    reference: {
      nodeId: closest.node.id,
      featureId: closest.match.feature.id,
      parameters: closest.match.parameters,
    },
    fallback: closest.match.point,
  }
}

function withRefreshedFallbacks(
  node: ConstructionDimensionNodeType,
  nodes: Parameters<typeof resolveLevelId>[1],
): ConstructionDimensionNodeType['anchors'] {
  return node.anchors.map((anchor) => {
    if (Array.isArray(anchor)) return anchor
    const resolved = resolveMeasurementAnchor(anchor, (id) => nodes[id])
    return { ...anchor, fallback: resolved.point }
  })
}

export const moveConstructionDimensionWitnessAffordance: FloorplanAffordance<ConstructionDimensionNodeType> =
  {
    start({ node, nodes, payload }): FloorplanAffordanceSession {
      const witnessIndex = (payload as { witnessIndex?: unknown }).witnessIndex
      const originalAnchors = withRefreshedFallbacks(node, nodes)
      const levelId = resolveLevelId(node, nodes)
      let latest: ConstructionDimensionNodeType['anchors'] | null = null

      if (!Number.isInteger(witnessIndex)) {
        return {
          affectedIds: [node.id],
          apply() {},
          canCommit: () => false,
        }
      }

      return {
        affectedIds: [node.id],
        apply({ planPoint, modifiers }) {
          const forceFree = modifiers.altKey === true
          const gridStep = !forceFree && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
          const fallbackPoint: [number, number] =
            gridStep > 0
              ? [
                  Math.round(planPoint[0] / gridStep) * gridStep,
                  Math.round(planPoint[1] / gridStep) * gridStep,
                ]
              : [planPoint[0], planPoint[1]]
          const magnetic = !forceFree && isMagneticSnapActive()
          const snapped = resolveSurfacePlanPointSnap({
            rawPoint: [planPoint[0], planPoint[1]],
            fallbackPoint,
            excludeId: node.id,
            levelId,
            movingId: node.id,
            nodes,
            magnetic,
          })
          const point: MeasurementPoint = [snapped.point[0], 0, snapped.point[1]]
          const nextAnchor = semanticWitnessAnchor(
            point,
            snapped.wallIds,
            nodes,
            magnetic ? SEMANTIC_FEATURE_SNAP_DISTANCE : SEMANTIC_FEATURE_BYPASS_DISTANCE,
          )
          const anchors = originalAnchors.map((anchor, index) =>
            index === witnessIndex ? nextAnchor : anchor,
          )
          if (!ConstructionDimensionNode.safeParse({ ...node, anchors }).success) {
            latest = null
            useLiveNodeOverrides.getState().clear(node.id)
            return
          }
          latest = anchors
          useLiveNodeOverrides.getState().set(node.id, { anchors })
        },
        canCommit: () => latest !== null,
        commit() {
          const anchors = latest
          useLiveNodeOverrides.getState().clear(node.id)
          if (anchors) useScene.getState().updateNode(node.id, { anchors })
        },
      }
    },
  }

export const moveConstructionDimensionBaselineAffordance: FloorplanAffordance<ConstructionDimensionNodeType> =
  {
    start({ node }) {
      let latest: [number, number] | null = null
      return {
        affectedIds: [node.id],
        apply({ planPoint }) {
          const origin: [number, number] = [planPoint[0], planPoint[1]]
          const baseline = { ...node.baseline, origin }
          if (!ConstructionDimensionNode.safeParse({ ...node, baseline }).success) return
          latest = origin
          useLiveNodeOverrides.getState().set(node.id, { baseline })
        },
        canCommit: () => latest !== null,
        commit() {
          useLiveNodeOverrides.getState().clear(node.id)
          if (latest) {
            useScene.getState().updateNode(node.id, {
              baseline: { ...node.baseline, origin: latest },
            })
          }
        },
      }
    },
  }
