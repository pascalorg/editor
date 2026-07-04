import {
  type AnyNode,
  type AnyNodeId,
  type CabinetModuleNode as CabinetModuleNodeType,
  type CabinetNode as CabinetNodeType,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useScene,
} from '@pascal-app/core'
import { isMagneticSnapActive, useEditor } from '@pascal-app/editor'
import { cabinetModuleParentFrame } from './move-frame'

/**
 * 2D floor-plan move for a cabinet module — the parity twin of the 3D
 * `movable.parentFrame` path. A module's `position` is run-local (rotated
 * frame), so the generic overlay translate — which writes plan-space
 * coordinates — teleports modules of any rotated / offset run and skips
 * sibling edge-mating. Each tick: grid-snap the cursor in plan frame,
 * convert through `planToLocal`, magnet against sibling modules, write the
 * local position, and bump the run's layout revision so spans / countertop
 * re-flow live (module position is not in the run's geometryKey). History is
 * paused by the overlay; its snapshot-diff commit makes the drag one undo
 * step covering both the module and the run metadata.
 */
export const cabinetModuleFloorplanMoveTarget: FloorplanMoveTarget<CabinetModuleNodeType> = ({
  node,
  nodes,
}) => {
  const moduleId = node.id as AnyNodeId
  const run = cabinetModuleParentFrame.resolveParent(
    node as AnyNode,
    nodes,
  ) as CabinetNodeType | null
  const originalLocal = [...node.position] as [number, number, number]
  let lastLocal: [number, number, number] = originalLocal

  const bumpRunLayoutRevision = (runId: AnyNodeId) => {
    const liveRun = useScene.getState().nodes[runId]
    if (liveRun?.type !== 'cabinet') return
    const metadata =
      liveRun.metadata && typeof liveRun.metadata === 'object' && !Array.isArray(liveRun.metadata)
        ? (liveRun.metadata as Record<string, unknown>)
        : {}
    const revision =
      typeof metadata.cabinetLayoutRevision === 'number' ? metadata.cabinetLayoutRevision : 0
    useScene
      .getState()
      .updateNodes([
        { id: runId, data: { metadata: { ...metadata, cabinetLayoutRevision: revision + 1 } } },
      ])
  }

  const session: FloorplanMoveTargetSession = {
    affectedIds: run ? [moduleId, run.id as AnyNodeId] : [moduleId],
    apply({ planPoint, modifiers }) {
      const snap = (value: number) => {
        if (modifiers.shiftKey) return value
        const step = useEditor.getState().gridSnapStep
        return Math.round(value / step) * step
      }
      const planX = snap(planPoint[0])
      const planZ = snap(planPoint[1])

      // Orphan module (no cabinet run parent): plain plan-frame translate,
      // same as the generic overlay would have done.
      if (!run) {
        lastLocal = [planX, originalLocal[1], planZ]
        useScene.getState().updateNodes([{ id: moduleId, data: { position: lastLocal } }])
        return
      }

      let local = cabinetModuleParentFrame.planToLocal(run, planX, originalLocal[1], planZ)
      if (isMagneticSnapActive() && !modifiers.altKey && !modifiers.shiftKey) {
        const snapFn = cabinetModuleParentFrame.magneticSnap
        if (snapFn) {
          local = snapFn(node as AnyNode, run, local, useScene.getState().nodes)
        }
      }
      lastLocal = local
      useScene.getState().updateNodes([{ id: moduleId, data: { position: local } }])
      bumpRunLayoutRevision(run.id as AnyNodeId)
    },
    canCommit() {
      const live = useScene.getState().nodes[moduleId]
      if (live?.type !== 'cabinet-module') return false
      return lastLocal[0] !== originalLocal[0] || lastLocal[2] !== originalLocal[2]
    },
  }
  return session
}
