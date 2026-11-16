import { refuse } from '../agent-tools/refusal'
import { planRampGroundRelease, requireRampChangeBudget } from '../lib/ramp-terrain'
import { applySceneChanges, mergeSceneChanges } from './apply-changes'
import { descendantsOf } from './scene-queries'
import type { AgentOperation, SceneChanges } from './types'

/** `delete_node`: the editor's Delete, which takes a node with everything under it. */
export const deleteNode: AgentOperation<{ id: string }> = (nodes, { id }) => {
  if (!nodes[id]) refuse('node_not_found', `Node not found: ${id}.`, { id })
  const deletedIds = [id, ...descendantsOf(nodes, id).map((node) => node.id)]
  let working = nodes
  const releases: SceneChanges[] = []
  for (const removedId of deletedIds) {
    const node = nodes[removedId]
    if (node?.type !== 'ramp' || deletedIds.includes(node.terrainEffect?.siteId ?? '')) continue
    const release = planRampGroundRelease(node, working)
    releases.push(release)
    working = applySceneChanges(working, release)
  }
  const changes = releases.length
    ? mergeSceneChanges([...releases, { delete: [id] }])
    : { delete: [id] }
  if (releases.length) requireRampChangeBudget(changes, nodes)
  return { result: { deletedIds }, changes }
}
