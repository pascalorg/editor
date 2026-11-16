import { z } from 'zod'
import { addRampTool } from '../agent-tools/ramp'
import { refuse } from '../agent-tools/refusal'
import { rampDefaultTransitionLength } from '../lib/ramp'
import { rampFacts } from '../lib/ramp-facts'
import { planRampCreation } from '../lib/ramp-terrain'
import { queryNodes } from '../runtime/node-queries'
import { RampNode } from '../schema/nodes/ramp'
import { applySceneChanges } from './apply-changes'
import type { AgentOperation, SceneChanges } from './types'

const inputSchema = z.strictObject(addRampTool.input)

/** One atomic scene plan: only the new ramp and localized Site terrain change. */
export const addRamp: AgentOperation<z.output<typeof inputSchema>> = (nodes, rawInput) => {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const input = parsed.data
  const sites = queryNodes(nodes, { type: 'site' }).filter((node) => node.type === 'site')
  if (!input.siteId && sites.length > 1)
    refuse('ambiguous_site', 'Choose the Site that owns this ramp with siteId.')
  const site = input.siteId ? nodes[input.siteId] : sites[0]
  if (site?.type !== 'site') refuse('no_site', 'The scene has no matching Site for this ramp.')
  const node = RampNode.safeParse({
    ...input,
    parentId: site.id,
    name: input.name ?? 'Ramp',
    endHeight: input.endHeight ?? input.startHeight ?? 0,
  })
  if (!node.success) refuse('invalid_input', node.error.message)
  let ramp = node.data
  const defaultTransition = rampDefaultTransitionLength(ramp)
  ramp = {
    ...ramp,
    startTransition: input.startTransition ?? defaultTransition,
    endTransition: input.endTransition ?? defaultTransition,
  }
  if (input.endHeight === undefined) {
    if (!input.endTargetId)
      refuse('ramp_end_required', 'Give an endHeight or a modeled door or level endTargetId.')
    const endHeight = rampFacts(ramp, nodes).targets.end?.heightM
    if (endHeight === undefined || endHeight === null)
      refuse(
        'ramp_end_required',
        'The end target has no measurable height in this Site; give an explicit endHeight.',
        { targetId: input.endTargetId },
      )
    ramp = { ...ramp, endHeight }
  }
  const changes: SceneChanges = planRampCreation(ramp, nodes)
  const plannedNodes = applySceneChanges(nodes, changes)
  return {
    result: { rampId: ramp.id, siteId: site.id, facts: rampFacts(ramp, plannedNodes) },
    changes,
  }
}
