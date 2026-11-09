import type { AnyNode, AnyNodeId } from '../schema'
import { DERIVED_WRITER_TOKEN, type DerivedWriteOptions } from '../store/derived-node-guard'
import { omitUndefined } from '../utils/omit-undefined'
import type { NodePatch, SceneNodes } from './structure-kernel'
import { reconcileSceneStructure, type StructureIdFactory } from './structure-reconcile'

type StructureStoreLike = {
  getState: () => {
    nodes: SceneNodes
    createNodes: (
      ops: { node: AnyNode; parentId?: AnyNodeId }[],
      options?: DerivedWriteOptions,
    ) => void
    updateNodes: (
      updates: { id: AnyNodeId; data: Partial<AnyNode> }[],
      options?: DerivedWriteOptions,
    ) => void
    deleteNodes: (ids: AnyNodeId[], options?: DerivedWriteOptions) => void
  }
}

/**
 * The only sanctioned writer of derived construction into a scene store.
 *
 * Runs the pure kernel over the requested levels and applies its patches while
 * holding the derived-writer capability, so plates and auto ceilings reach the
 * store through the guarded actions without any caller being able to forge the
 * capability. Both the browser's commit subscriber (`initSpaceDetectionSync`)
 * and the headless MCP bridge go through here.
 *
 * Callers own history framing: pause scene history around this call so the
 * derived writes join the triggering edit's undo step
 * (`wiki/architecture/space-detection.md`).
 */
export function applyStructureReconciliation(
  sceneStore: StructureStoreLike,
  options: {
    levelIds?: string[]
    previousNodes?: SceneNodes
    mintId: StructureIdFactory
  },
): NodePatch[] {
  const capability: DerivedWriteOptions = { derivedWriter: DERIVED_WRITER_TOKEN }
  const { patches } = reconcileSceneStructure({
    levelIds: options.levelIds,
    nodes: sceneStore.getState().nodes,
    previousNodes: options.previousNodes,
    mintId: options.mintId,
  })
  const state = sceneStore.getState()
  const creates = patches.flatMap((patch) =>
    patch.op === 'create'
      ? [{ node: omitUndefined(patch.node), parentId: patch.node.parentId as AnyNodeId }]
      : [],
  )
  const updates = patches.flatMap((patch) =>
    patch.op === 'update'
      ? [
          {
            id: patch.id,
            // Top-level undefined is the store's remove-field instruction, not a stored value.
            data: Object.fromEntries(
              Object.entries(patch.data).map(([key, value]) => [key, omitUndefined(value)]),
            ),
          },
        ]
      : [],
  )
  const deletes = patches.flatMap((patch) => (patch.op === 'delete' ? [patch.id] : []))
  if (creates.length) state.createNodes(creates, capability)
  if (updates.length) state.updateNodes(updates, capability)
  if (deletes.length) {
    // Retiring a derived ceiling must not cascade into the children the kernel
    // just re-parented off it.
    const hosts = deletes.filter((id) => sceneStore.getState().nodes[id]?.type === 'ceiling')
    if (hosts.length)
      state.updateNodes(
        hosts.map((id) => ({ id, data: { children: [] } as Partial<AnyNode> })),
        capability,
      )
    state.deleteNodes(deletes, capability)
  }
  return patches
}
