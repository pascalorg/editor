import { refuse } from '../agent-tools/refusal'
import type { AnyNode } from '../schema'
import { requirePlanGuide } from './plan-calibration'
import {
  type AddedBalcony,
  buildingMapBalconies,
  buildingMapGroups,
  type PlanReading,
  type PlanRole,
  readingOf,
} from './plan-survey'
import type { AgentOperation } from './types'

type CorrectInput = {
  guideIds: string[]
  roles?: Record<string, PlanRole>
  addBalconies?: AddedBalcony[]
  dropBalconies?: [number, number][]
  reset?: boolean
}

/**
 * `correct_plan_reading`: the survey reads a building map by rule; the model corrects it where the
 * plan says otherwise, and every later operation reads the corrected version (Victor floor 03's
 * loggias, drawn inside the outline, were invisible to the rule). Kept on each guide, so a floor's
 * family takes one correction and it survives the turn.
 */
export const correctPlanReading: AgentOperation<CorrectInput> = (nodes, input) => {
  const update: { id: string; data: Partial<AnyNode> }[] = []
  const readings: Record<string, unknown>[] = []
  for (const guideId of input.guideIds) {
    const { guide } = requirePlanGuide(nodes, guideId)
    const shapeIds = new Set(
      ((guide.metadata.referenceContours ?? []) as { id: string }[]).map((contour) => contour.id),
    )
    for (const id of Object.keys(input.roles ?? {}))
      if (!shapeIds.has(id))
        refuse(
          'unknown_shape',
          `${guide.name ?? guide.id} has no shape ${id}: survey_plan_references and get_plan_reference list them.`,
          { guideId, shapeId: id },
        )
    const before = input.reset ? {} : readingOf(guide)
    const roles = { ...before.roles, ...input.roles }
    const addBalconies = [...(before.addBalconies ?? []), ...(input.addBalconies ?? [])]
    const dropBalconies = [...(before.dropBalconies ?? []), ...(input.dropBalconies ?? [])]
    const reading: PlanReading = {
      ...(Object.keys(roles).length ? { roles } : {}),
      ...(addBalconies.length ? { addBalconies } : {}),
      ...(dropBalconies.length ? { dropBalconies } : {}),
    }
    const metadata = { ...guide.metadata, planReading: reading }
    const corrected = { ...guide, metadata }
    const groups = buildingMapGroups(corrected)
    if (!groups)
      refuse(
        'not_a_building_map',
        `${guide.name ?? guide.id} is not read as a building map${Object.keys(roles).length ? ' with these roles' : ''}: there is no reading to correct.`,
        { guideId },
      )
    readings.push({
      guideId,
      name: guide.name ?? guide.id,
      apartments: groups.apartments.length,
      cores: groups.cores.length,
      balconies: buildingMapBalconies(corrected)?.balconies.length ?? 0,
    })
    update.push({ id: guideId, data: { metadata } as Partial<AnyNode> })
  }
  return {
    result: {
      readings,
      next: 'survey_plan_references, select, the balcony steps and apply_facade scope balconies now read the corrected plans.',
    },
    changes: { update },
  }
}
