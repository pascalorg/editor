import type { AgentOperations } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import { planSlabFeaturePlacement } from '@pascal-app/core/building'
import { SlabFeatureNode } from '@pascal-app/core/schema'

type Create = Pick<SlabFeatureNode, 'mode' | 'x' | 'z' | 'width' | 'length' | 'depth'> & {
  hostId: string
  finishRef?: string
}
type Update = Partial<Omit<Create, 'hostId' | 'finishRef'>> & {
  featureId: string
  finishRef?: string | null
}
function parse(value: unknown) {
  const result = SlabFeatureNode.safeParse(value)
  if (!result.success)
    refuse('slab_feature_invalid_data', 'Invalid slab feature fields.', {
      issues: result.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    })
  return result.data
}
export const slabFeatureAgentOperations = {
  pascal_create_slab_feature(nodes, input: Create) {
    const host = nodes[input.hostId]
    if (host?.type !== 'slab' && host?.type !== 'slab-feature')
      refuse('slab_feature_host_required', 'Select a slab or slab bump.', { hostId: input.hostId })
    const { hostId, finishRef, ...fields } = input
    const node = parse({
      ...fields,
      parentId: hostId,
      ...(finishRef ? { slots: { surface: finishRef } } : {}),
    })
    try {
      planSlabFeaturePlacement(nodes, node)
    } catch (err) {
      refuse(
        'slab_feature_invalid_placement',
        err instanceof Error ? err.message : 'Invalid placement.',
      )
    }
    return {
      result: { featureId: node.id, hostId },
      changes: {
        create: [{ node, parentId: host.id }],
        update: [{ id: host.id, data: { children: [...new Set([...host.children, node.id])] } }],
      },
    }
  },
  pascal_update_slab_feature(nodes, input: Update) {
    const current = nodes[input.featureId]
    if (current?.type !== 'slab-feature')
      refuse('slab_feature_required', 'Select a slab feature.', { featureId: input.featureId })
    const { featureId, finishRef, ...patch } = input,
      slots = { ...current.slots }
    if (finishRef === null) delete slots.surface
    else if (finishRef !== undefined) slots.surface = finishRef
    const node = parse({
      ...current,
      ...patch,
      slots: Object.keys(slots).length ? slots : undefined,
    })
    try {
      planSlabFeaturePlacement(nodes, node)
    } catch (err) {
      refuse(
        'slab_feature_invalid_placement',
        err instanceof Error ? err.message : 'Invalid placement.',
      )
    }
    return {
      result: { featureId },
      changes: { update: [{ id: node.id, data: { ...patch, slots: node.slots } }] },
    }
  },
} satisfies AgentOperations
