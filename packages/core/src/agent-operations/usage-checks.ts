import { type UsageIssue, usageIssues } from '../spatial/usage-field/findings'
import { sdfChecksOn } from '../spatial/usage-field/flag'
import { registerSceneCheck } from './verify-scene'

/**
 * Passages, turning circles, pockets and wall objects, measured on the real shapes of the scene
 * (`spatial/usage-field`). Off unless a host turns usage checks on; off, it adds nothing.
 */
registerSceneCheck({
  name: 'usage',
  order: 60,
  run: (nodes) => (sdfChecksOn() ? (usageIssues(nodes) as UsageIssue[]) : []),
})
