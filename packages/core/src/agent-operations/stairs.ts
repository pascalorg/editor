import { refuse } from '../agent-tools/refusal'
import type { FitStairInput, MeasureStairInput } from '../agent-tools/stairs'
import type { AnyNode, StairNode } from '../schema'
import { StairDesignTargets } from '../schema/nodes/stair-design-targets'
import { planStairPreset, proposeStairLayouts } from '../systems/stair/stair-presets'
import { measureStair, planStairSizingEdit } from '../systems/stair/stair-sizing'
import { applySceneChanges } from './apply-changes'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

function requireStair(nodes: SceneNodes, stairId: string): StairNode {
  const stair = nodes[stairId]
  if (stair?.type !== 'stair')
    refuse('stair_required', `Stair ${stairId} was not found. Choose a stair id from the scene.`, {
      stairId,
    })
  return stair
}

export const measureStairOperation: AgentOperation<MeasureStairInput> = (nodes, input) => {
  const stair = requireStair(nodes, input.stairId)
  return {
    result: {
      measurements: measureStair(stair, nodes as Record<string, AnyNode>),
      layouts: proposeStairLayouts(stair, nodes as Record<string, AnyNode>, input.available),
    },
  }
}

export const fitStair: AgentOperation<FitStairInput> = (scene, input) => {
  const original = requireStair(scene, input.stairId)
  const stair = input.targets
    ? {
        ...original,
        designTargets: StairDesignTargets.parse({ ...original.designTargets, ...input.targets }),
      }
    : original
  const nodes: Record<string, AnyNode> = { ...scene, [stair.id]: stair }
  let changes: SceneChanges
  if (input.layout) {
    const plan = planStairPreset(stair, nodes, { ...input, layout: input.layout })
    changes = {
      delete: plan.removeIds,
      create: plan.segments
        .filter((segment) => !nodes[segment.id])
        .map((node) => ({ node, parentId: stair.id })),
      update: [
        ...plan.segments
          .filter((segment) => nodes[segment.id])
          .map((segment) => ({ id: segment.id, data: segment })),
        { id: stair.id, data: plan.stair },
      ],
    }
  } else {
    if (
      input.turn ||
      input.width !== undefined ||
      input.landingDepth !== undefined ||
      input.turningStrategy ||
      input.innerGap !== undefined ||
      input.walkingLineOffset !== undefined ||
      input.division
    )
      refuse(
        'stair_layout_required',
        'Choose a straight, L or U layout when specifying layout options.',
        { stairId: stair.id },
      )
    const updates = planStairSizingEdit(stair, nodes, input.fitRun)
    if (input.targets)
      updates[0]!.data = {
        ...updates[0]!.data,
        designTargets: stair.designTargets,
      } as Partial<AnyNode>
    changes = { update: updates }
  }
  const next = applySceneChanges(scene, changes)
  return {
    changes,
    result: { stairId: stair.id, measurements: measureStair(next[stair.id] as StairNode, next) },
  }
}
