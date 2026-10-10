import { fillLevelHeights, type LevelHeightWrite } from '@pascal-app/core/agent-operations'
import type { AnyNode } from '@pascal-app/core/schema'
import type { Patch } from '../bridge/scene-bridge'
import { registerPatchGuard } from './patch-guards'

/**
 * A level is written with a height (L68): a create without one, or an update clearing it, gets the
 * height the editor's load would derive, said in the answer's notes. After the honest-update check,
 * which turns a `null` into a cleared field.
 */
function levelHeights(patches: Patch[], scene: Readonly<Record<string, AnyNode>>) {
  return fillLevelHeights(patches as unknown as LevelHeightWrite[], scene)
}

registerPatchGuard({ name: 'level-heights', order: 30, run: levelHeights })
