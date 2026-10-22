import { refuse } from '../agent-tools/refusal'
import { buildGroundLevelChanges } from '../building/ground-level'
import type { AnyNode, AnyNodeId } from '../schema'
import { requireLevel } from './level-target'
import { levelRole } from './scene-queries'
import type { AgentOperation } from './types'

type SetGroundLevelInput = { levelId: string }

/**
 * `set_ground_level`: the level asked for becomes the building's ground floor — named on the
 * building, its floor the top of the foundation over grade (as the building's region and style seat it), index 0 — the same change the level panel's "Set as ground floor"
 * writes (`buildGroundLevelChanges`).
 */
export const setGroundLevel: AgentOperation<SetGroundLevelInput> = (nodes, input) => {
  const level = requireLevel(nodes, input.levelId)
  const { role } = levelRole(nodes, level)
  if (role !== 'occupied')
    refuse(
      'not_a_storey',
      `${level.name ?? level.id} (${level.id}) is a ${role === 'roof' ? 'roof' : 'support'} level, not a storey: it cannot stand at grade as the ground floor.`,
      { levelId: level.id, role },
    )
  const built = buildGroundLevelChanges({
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    levelId: level.id,
  })
  if (!built)
    refuse('no_building', `Level ${level.id} is not in a building, so it has no ground line.`, {
      levelId: level.id,
    })
  const { seat, moveBy } = built
  const floorElevation = Math.round((seat.floorElevation + moveBy) * 1e6) / 1e6
  const name = level.name ?? level.id
  const { aboveGrade, foundation } = seat
  const construction = {
    region: foundation.region,
    construction: foundation.construction.id,
    basis: foundation.basis,
  }
  const inches = Math.round(aboveGrade / 0.0254)
  if (built.unchanged)
    return {
      result: {
        ok: true,
        unchanged: true,
        levelId: level.id,
        buildingId: built.buildingId,
        floorElevation: seat.floorElevation,
        aboveGrade,
        foundation: construction,
        message: `${name} is already the ground floor, its floor ${aboveGrade} m (${inches} in) over grade (${foundation.construction.label} foundation; ${foundation.basis}).`,
      },
    }
  return {
    result: {
      ok: true,
      levelId: level.id,
      buildingId: built.buildingId,
      floorElevation,
      gradeElevation: seat.gradeElevation,
      aboveGrade,
      foundation: construction,
      movedBuildingBy: moveBy,
      renumbered: built.renumbered,
      message: `${name} is the ground floor: its floor, the top of the foundation where the wood framing starts, stands ${aboveGrade} m (${inches} in) over grade (${floorElevation.toFixed(2)} m over grade ${seat.gradeElevation.toFixed(2)} m), as a ${foundation.construction.label} foundation seats it: ${foundation.construction.seatBasis}; ${foundation.basis}. The levels with a lower index are below grade${moveBy === 0 ? '' : `; the building moved ${moveBy.toFixed(2)} m in height, its plan where it was`}.`,
    },
    changes: { update: built.update },
  }
}
