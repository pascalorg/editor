import { createFloorOpeningIndex, floorOpeningTargets } from '../lib/floor-opening-intent'
import { applyStructureReconciliation } from '../lib/structure-commit'
import type { NodePatch, SceneNodes } from '../lib/structure-kernel'
import type { AnyNode } from '../schema'
import { generateId } from '../schema/base'
import type { SceneStore } from '../store/use-scene'

/** Re-derives the structure of every level an owned opening change cut into or out of. */
export function reconcileOwnedFloorOpeningChanges(
  store: Pick<SceneStore, 'getState'>,
  before: SceneNodes,
  changes: NodePatch[],
) {
  const after = store.getState().nodes
  const oldIndex = createFloorOpeningIndex(before)
  const newIndex = createFloorOpeningIndex(after)
  const levels = new Set<string>()
  for (const change of changes) {
    const id = change.op === 'create' ? change.node.id : change.id
    for (const [nodes, index] of [
      [before, oldIndex],
      [after, newIndex],
    ] as const) {
      const opening = (nodes as Record<string, AnyNode>)[id]
      if (opening?.type !== 'floor-opening') continue
      for (const target of floorOpeningTargets(nodes, opening, index)) levels.add(target.levelId)
    }
  }
  if (levels.size)
    applyStructureReconciliation(store, { levelIds: [...levels], mintId: generateId })
}
