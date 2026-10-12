import type { AgentOperations } from '@pascal-app/core/agent-operations'
import { refuse } from '@pascal-app/core/agent-tools'
import { planWallFeaturePlacement } from '@pascal-app/core/building'
import { type AnyNodeId, WallFeatureNode } from '@pascal-app/core/schema'

type CreateInput = {
  hostId: string
  mode: 'niche' | 'bump'
  face?: 'a' | 'b'
  u: number
  bottom: number
  width: number
  height: number
  depth: number
  finishRef?: string
}

type UpdateInput = {
  featureId: string
  mode?: 'niche' | 'bump'
  face?: 'a' | 'b'
  u?: number
  bottom?: number
  width?: number
  height?: number
  depth?: number
  finishRef?: string | null
}

function appendChild(host: { children: AnyNodeId[] }, childId: AnyNodeId) {
  return { children: [...new Set([...host.children, childId])] }
}

function parseFeature(value: unknown) {
  const parsed = WallFeatureNode.safeParse(value)
  if (!parsed.success)
    refuse('wall_feature_invalid_data', 'Wall feature dimensions or fields are invalid.', {
      issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    })
  return parsed.data
}

export const wallFeatureAgentOperations = {
  pascal_create_wall_feature(nodes, input: CreateInput) {
    const host = nodes[input.hostId]
    if (host?.type !== 'wall' && host?.type !== 'wall-feature')
      refuse('wall_feature_host_required', `Host ${input.hostId} is not a wall or wall feature.`, {
        hostId: input.hostId,
      })
    if (host.type === 'wall-feature' && (host.mode !== 'bump' || input.mode !== 'niche'))
      refuse('wall_feature_invalid_nesting', 'Only a niche can be hosted by a wall-owned bump.', {
        hostId: input.hostId,
      })
    const feature = parseFeature({
      parentId: host.id,
      mode: input.mode,
      ...(host.type === 'wall' ? { face: input.face ?? 'a' } : {}),
      u: input.u,
      bottom: input.bottom,
      width: input.width,
      height: input.height,
      depth: input.depth,
      ...(input.finishRef ? { slots: { surface: input.finishRef } } : {}),
    })
    planWallFeaturePlacement({ ...nodes, [feature.id]: feature }, feature)
    return {
      result: { featureId: feature.id, hostId: host.id, mode: feature.mode },
      changes: {
        create: [{ node: feature, parentId: host.id }],
        update: [{ id: host.id, data: appendChild(host, feature.id) }],
      },
    }
  },

  pascal_update_wall_feature(nodes, input: UpdateInput) {
    const current = nodes[input.featureId]
    if (current?.type !== 'wall-feature')
      refuse('wall_feature_not_found', `Wall feature ${input.featureId} was not found.`, {
        featureId: input.featureId,
      })
    const { featureId: _featureId, finishRef, ...patch } = input
    const slots = { ...(current.slots ?? {}) }
    if (finishRef === null) delete slots.surface
    else if (finishRef !== undefined) slots.surface = finishRef
    const feature = parseFeature({
      ...current,
      ...patch,
      slots: Object.keys(slots).length ? slots : undefined,
    })
    planWallFeaturePlacement({ ...nodes, [feature.id]: feature }, feature)
    return {
      result: { featureId: feature.id, hostId: feature.parentId, mode: feature.mode },
      changes: {
        update: [
          {
            id: feature.id,
            data: {
              mode: feature.mode,
              face: feature.face,
              u: feature.u,
              bottom: feature.bottom,
              width: feature.width,
              height: feature.height,
              depth: feature.depth,
              slots: feature.slots,
            },
          },
        ],
      },
    }
  },
} satisfies AgentOperations
