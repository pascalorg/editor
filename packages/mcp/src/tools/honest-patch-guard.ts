import { honestNodePatch } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import type { AnyNode } from '@pascal-app/core/schema'
import type { Patch } from '../bridge/scene-bridge'
import { type PatchRefusalCode, PatchRefusedError, registerPatchGuard } from './patch-guards'

/**
 * Each update checked to do what it says, in the batch's order (a node an earlier op created is
 * the one updated): a field the node would drop, a material the library lacks or a field a set
 * one hides is refused, naming it; `null` clears. The cleaned data is what is written.
 */
function honestUpdates(patches: Patch[], scene: Readonly<Record<string, AnyNode>>) {
  // The batch over the scene, read id by id.
  const written = new Map<string, AnyNode | undefined>()
  for (const [index, patch] of patches.entries()) {
    if (patch.op === 'create') written.set(patch.node.id, patch.node)
    else if (patch.op === 'delete') written.set(patch.id, undefined)
    else if (patch.op === 'update') {
      const current = written.has(patch.id) ? written.get(patch.id) : scene[patch.id]
      if (!current) continue
      try {
        patch.data = honestNodePatch(
          current,
          patch.data as Record<string, unknown>,
        ) as Partial<AnyNode>
      } catch (error) {
        if (!isAgentRefusal(error)) throw error
        throw new PatchRefusedError(error.code as PatchRefusalCode, index, patch.id, error.message)
      }
      written.set(patch.id, { ...current, ...patch.data } as AnyNode)
    }
  }
}

registerPatchGuard({ name: 'honest-updates', order: 20, run: honestUpdates })
