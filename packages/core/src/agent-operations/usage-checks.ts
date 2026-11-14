import { isUsageType, ROOM_ENTRY_TYPE, ROOM_FOLDED_TYPES } from '../agent-tools/verify-scene-usage'
import { USAGE_TYPES, usageIssueSteps } from '../spatial/usage-field/findings'
import { sdfChecksOn } from '../spatial/usage-field/flag'
import { registerSceneCheck } from './verify-scene'

/**
 * The finding types a `type` question is about: itself, or what a room's one entry holds. A usage
 * type no measurement gives is a misspelt one, and its answer names the types there are: every
 * measurement is taken, as for a question with no type.
 */
function askedTypes(type: unknown): ReadonlySet<string> | undefined {
  if (typeof type !== 'string' || type.length === 0) return undefined
  if (type === ROOM_ENTRY_TYPE) return new Set<string>(ROOM_FOLDED_TYPES)
  return isUsageType(type) && !USAGE_TYPES.has(type) ? undefined : new Set([type])
}

/**
 * Passages, turning circles, pockets and wall objects, measured on the real shapes of the scene
 * (`spatial/usage-field`). Off unless a host turns usage checks on; off, it adds nothing. A
 * question about one finding type takes the measurements that give it, and none for a type that
 * is not a usage finding.
 */
registerSceneCheck({
  name: 'usage',
  order: 60,
  run: (nodes, input) =>
    sdfChecksOn() ? usageIssueSteps(nodes, { types: askedTypes(input.type) }) : [],
})
