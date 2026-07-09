import {
  type AnyNode,
  type AnyNodeId,
  type CabinetModuleNode as CabinetModuleNodeType,
  type CabinetNode as CabinetNodeType,
  createSceneApi,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  type SceneApi,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, isMagneticSnapActive, useEditor } from '@pascal-app/editor'
import { cabinetModuleParentFrame } from './move-frame'
import { bumpCabinetRunLayoutRevision, syncCornerRunsFromSourceModule } from './run-ops'
import { resolveCabinetModuleWallSnapLocal } from './wall-snap'

type SceneUpdate = { id: AnyNodeId; data: Partial<AnyNode> }

function mergeSceneUpdate(
  updates: Map<AnyNodeId, Partial<AnyNode>>,
  id: AnyNodeId,
  patch: Partial<AnyNode>,
) {
  updates.set(id, {
    ...((updates.get(id) ?? {}) as Record<string, unknown>),
    ...patch,
  } as Partial<AnyNode>)
}

function collectCabinetModuleMoveCommitUpdates({
  lastLocal,
  moduleId,
  runId,
}: {
  lastLocal: [number, number, number]
  moduleId: AnyNodeId
  runId: AnyNodeId
}): SceneUpdate[] | null {
  const baseNodes = useScene.getState().nodes as Record<AnyNodeId, AnyNode>
  const nodes: Record<AnyNodeId, AnyNode> = { ...baseNodes }
  const updates = new Map<AnyNodeId, Partial<AnyNode>>()
  let unsupportedMutation = false

  const sceneApi: SceneApi = {
    get<N extends AnyNode = AnyNode>(id: AnyNodeId): N | undefined {
      return nodes[id] as N | undefined
    },
    nodes() {
      return nodes
    },
    update(id, patch) {
      const current = nodes[id]
      if (!current) return
      nodes[id] = { ...current, ...patch } as AnyNode
      mergeSceneUpdate(updates, id, patch)
    },
    upsert(node) {
      if (!nodes[node.id as AnyNodeId]) {
        unsupportedMutation = true
        return node.id as AnyNodeId
      }
      nodes[node.id as AnyNodeId] = node
      mergeSceneUpdate(updates, node.id as AnyNodeId, node as Partial<AnyNode>)
      return node.id as AnyNodeId
    },
    delete() {
      unsupportedMutation = true
    },
    restore() {},
    restoreAll() {},
    markDirty() {},
    pauseHistory() {},
    resumeHistory() {},
    getSubtree() {
      return null
    },
    cloneNodesInto() {
      unsupportedMutation = true
      return null
    },
  }

  sceneApi.update(moduleId, { position: lastLocal } as Partial<AnyNode>)
  const liveRun = sceneApi.get<CabinetNodeType>(runId)
  if (liveRun?.type !== 'cabinet') return Array.from(updates, ([id, data]) => ({ id, data }))
  bumpCabinetRunLayoutRevision(sceneApi, liveRun)

  const liveModule = sceneApi.get<CabinetModuleNodeType>(moduleId)
  if (liveModule?.type === 'cabinet-module') {
    syncCornerRunsFromSourceModule({
      module: liveModule,
      run: sceneApi.get<CabinetNodeType>(runId) ?? liveRun,
      sceneApi,
    })
  }

  if (unsupportedMutation) return null
  return Array.from(updates, ([id, data]) => ({ id, data }))
}

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

  const session: FloorplanMoveTargetSession = {
    affectedIds: run ? [moduleId, run.id as AnyNodeId] : [moduleId],
    apply({ planPoint }) {
      const snap = (value: number) =>
        isGridSnapActive()
          ? Math.round(value / useEditor.getState().gridSnapStep) *
            useEditor.getState().gridSnapStep
          : value
      const planX = snap(planPoint[0])
      const planZ = snap(planPoint[1])

      // Orphan module (no cabinet run parent): plain plan-frame translate,
      // same as the generic overlay would have done.
      if (!run) {
        lastLocal = [planX, originalLocal[1], planZ]
        useLiveNodeOverrides.getState().set(moduleId, { position: lastLocal })
        return
      }

      let local = cabinetModuleParentFrame.planToLocal(run, planX, originalLocal[1], planZ)
      if (isMagneticSnapActive()) {
        const snapFn = cabinetModuleParentFrame.magneticSnap
        if (snapFn) {
          local = snapFn(node as AnyNode, run, local, useScene.getState().nodes)
        }
      }
      // Wall attachment snap — 2D parity with the 3D move tool's
      // `groupMoveSnap` pass: active in every snapping mode except Off.
      if ((isGridSnapActive() || isMagneticSnapActive()) && run.parentId) {
        const snapped = resolveCabinetModuleWallSnapLocal({
          candidateLocal: local,
          module: node,
          nodes: useScene.getState().nodes,
          parentLevelId: run.parentId as AnyNodeId,
          run,
        })
        if (snapped) local = snapped
      }
      lastLocal = local
      useLiveNodeOverrides.getState().set(moduleId, { position: local })
      useScene.getState().markDirty(run.id as AnyNodeId)
    },
    canCommit() {
      const live = useScene.getState().nodes[moduleId]
      if (live?.type !== 'cabinet-module') return false
      return lastLocal[0] !== originalLocal[0] || lastLocal[2] !== originalLocal[2]
    },
    commit() {
      const scene = useScene.getState()
      useLiveNodeOverrides.getState().clear(moduleId)
      if (!run) {
        scene.updateNodes([{ id: moduleId, data: { position: lastLocal } }])
        return
      }
      const runId = run.id as AnyNodeId
      const updates = collectCabinetModuleMoveCommitUpdates({ lastLocal, moduleId, runId })
      if (updates) {
        scene.updateNodes(updates)
        return
      }

      scene.updateNodes([{ id: moduleId, data: { position: lastLocal } }])
      const liveRun = useScene.getState().nodes[runId]
      if (liveRun?.type !== 'cabinet') return
      const sceneApi = createSceneApi(useScene)
      bumpCabinetRunLayoutRevision(sceneApi, liveRun)
      // 2D ↔ 3D parity with `cabinetModuleParentFrame.onCommit`: re-anchor
      // linked L-corner runs to the moved module's new edge.
      const liveModule = useScene.getState().nodes[moduleId]
      if (liveModule?.type === 'cabinet-module') {
        syncCornerRunsFromSourceModule({
          module: liveModule,
          run: sceneApi.get(runId) ?? liveRun,
          sceneApi,
        })
      }
    },
  }
  return session
}
