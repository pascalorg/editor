import {
  type AnyNodeId,
  collectAlignmentAnchors,
  createSceneApi,
  type FloorplanMoveTarget,
  movingAlignmentAnchors,
  type RoofNode,
  snapScalar,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  getSegmentGridStep,
  isGridSnapActive,
  isMagneticSnapActive,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { prepareSeatedRoofEdit } from './roof-level-target'

/** Whole-roof plan moves admit their final seat before the dispatcher resumes history. */
export const roofFloorplanMoveTarget: FloorplanMoveTarget<RoofNode> = ({
  node,
  nodes,
  sceneApi,
}) => {
  const id = node.id as AnyNodeId
  const scene = sceneApi ?? createSceneApi(useScene)
  const resolveCursor = createFloorplanCursorResolver({
    original: [node.position[0], node.position[2]],
    metadata: node.metadata,
  })
  const candidates = collectAlignmentAnchors(nodes, node.id, node.parentId).filter(
    (anchor) => !node.children.includes(anchor.nodeId),
  )
  let position: [number, number, number] | null = null
  let prepared: (() => void) | null = null
  const canCommit = () => {
    prepared = null
    if (!position) return false
    const result = prepareSeatedRoofEdit(scene, { update: [{ id, data: { position } }] }, id)
    if (typeof result !== 'function') return false
    prepared = result
    return true
  }

  return {
    affectedIds: [id],
    apply({ planPoint }) {
      prepared = null
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      const snap = (value: number) => (step > 0 ? snapScalar(value, step) : value)
      const point = resolveCursor(planPoint, { snap })
      const moving = movingAlignmentAnchors(node, nodes, point[0], point[1], node.rotation)
      const { point: aligned } = applyFloorplanAlignment(point, moving, candidates, {
        applySnap: isMagneticSnapActive(),
      })
      position = [aligned[0], node.position[1], aligned[1]]
      useLiveNodeOverrides.getState().set(id, { position })
      scene.markDirty(id)
    },
    canCommit,
    commit() {
      if (!prepared && !canCommit()) return
      const write = prepared
      prepared = null
      useLiveNodeOverrides.getState().clear(id)
      write?.()
    },
  }
}
