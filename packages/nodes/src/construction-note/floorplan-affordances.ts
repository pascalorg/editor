import {
  ConstructionNoteNode,
  type ConstructionNoteNode as ConstructionNoteNodeType,
  type FloorplanAffordance,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  constructionNoteCurveControlFromPoint,
  resolveConstructionNoteLeader,
} from './leader-geometry'
import { resolveConstructionNoteAnchor } from './resolve'

export const moveConstructionNoteAnchorAffordance: FloorplanAffordance<ConstructionNoteNodeType> = {
  start({ node }) {
    let latest: [number, number] | null = null
    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        const anchor: [number, number] = [planPoint[0], planPoint[1]]
        const next = {
          anchor,
          targetId: null,
          targetOffset: [0, 0] as [number, number],
        }
        if (!ConstructionNoteNode.safeParse({ ...node, ...next }).success) return
        latest = anchor
        useLiveNodeOverrides.getState().set(node.id, next)
      },
      canCommit: () => latest !== null,
      commit() {
        useLiveNodeOverrides.getState().clear(node.id)
        if (!latest) return
        useScene.getState().updateNode(node.id, {
          anchor: latest,
          targetId: null,
          targetOffset: [0, 0],
        })
      },
    }
  },
}

export const moveConstructionNoteTextAffordance: FloorplanAffordance<ConstructionNoteNodeType> = {
  start({ node }) {
    let latest: [number, number] | null = null
    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        const textPosition: [number, number] = [planPoint[0], planPoint[1]]
        if (!ConstructionNoteNode.safeParse({ ...node, textPosition }).success) return
        latest = textPosition
        useLiveNodeOverrides.getState().set(node.id, { textPosition })
      },
      canCommit: () => latest !== null,
      commit() {
        useLiveNodeOverrides.getState().clear(node.id)
        if (latest) useScene.getState().updateNode(node.id, { textPosition: latest })
      },
    }
  },
}

export const moveConstructionNoteCurveAffordance: FloorplanAffordance<ConstructionNoteNodeType> = {
  start({ node, nodes }) {
    const { point: anchor } = resolveConstructionNoteAnchor(node, (id) => nodes[id])
    const { elbow } = resolveConstructionNoteLeader(node, anchor)
    let latest: [number, number] | null = null
    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        const curveControl = constructionNoteCurveControlFromPoint(anchor, elbow, planPoint)
        if (!ConstructionNoteNode.safeParse({ ...node, curveControl }).success) return
        latest = curveControl
        useLiveNodeOverrides.getState().set(node.id, { curveControl })
      },
      canCommit: () => latest !== null,
      commit() {
        useLiveNodeOverrides.getState().clear(node.id)
        if (latest) useScene.getState().updateNode(node.id, { curveControl: latest })
      },
    }
  },
}
