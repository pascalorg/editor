import { type NodeWrite, seatWrittenRoofs } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import type { AnyNode } from '@pascal-app/core/schema'
import type { Patch } from '../bridge/scene-bridge'
import { type PatchRefusalCode, PatchRefusedError, registerPatchGuard } from './patch-guards'

/**
 * The roof-level rule: a roof the patch puts on its walls' storey is seated on the level above by
 * ops appended to the patch, said in notes, so every refusal's patchIndex stays on the model's own
 * op; storey content on a roof level, a walled level declared the roof level and a roof level
 * moved under a storey are refused. After the level heights, before the identity check, which
 * checks the appended ops too.
 */
function roofLevels(patches: Patch[], scene: Readonly<Record<string, AnyNode>>) {
  try {
    return seatWrittenRoofs(patches as unknown as NodeWrite[], scene)
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    const { index, id } = error.details as { index: number; id: string }
    throw new PatchRefusedError(error.code as PatchRefusalCode, index, id, error.message)
  }
}

registerPatchGuard({ name: 'roof-levels', order: 40, run: roofLevels })
