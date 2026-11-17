import { type AnyNodeId, runAsSingleSceneHistoryStep, useScene } from '@pascal-app/core'
import { gradeAroundHouse } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'

/** What the grading panel asks for: the agent tool's own inputs, the rest left to its defaults. */
export type GradeAroundHouseParams = {
  /** Batter run: horizontal metres per metre of height (2 is 1:2). */
  run: number
  /** How far the pad reaches beyond the house outline. */
  marginM: number
  /** Terrace riser; omit for a plain batter. */
  terraceRiserM?: number
  /** A declared retaining wall at the pad edge; omit for none. */
  wallM?: number
  /** The wall is a terrain-break, a real wall, instead of a lattice step. */
  exactWall?: boolean
  /** A flat lawn after the bank, at this height; omit for ground that meets the natural slope. */
  upperLevelM?: number
  /** Grade across the lot along the edge facing this side of the lot, instead of around the outline. */
  edgeFacing?: 'front' | 'rear' | 'left' | 'right'
  /** One pad per level that has a slab, each at its own floor. */
  padPerLevel?: boolean
}

export type GradeAroundHouseOutcome =
  | {
      ok: true
      padHeightM: number
      cutVolumeM3: number
      fillVolumeM3: number
      daylightReached: boolean
    }
  | { ok: false; code: string; message: string }

/**
 * Grade the ground around the house with the operation `grade_around_house` runs for the agents,
 * as one undo step: the panel and the agent write the same ground from the same rule.
 */
export function gradeSiteAroundHouse(params: GradeAroundHouseParams): GradeAroundHouseOutcome {
  const { nodes } = useScene.getState()
  try {
    const { edgeFacing, padPerLevel, ...rest } = params
    const levels = padPerLevel
      ? Object.values(nodes).filter(
          (node) =>
            node.type === 'level' &&
            node.children.some((childId) => nodes[childId as AnyNodeId]?.type === 'slab'),
        )
      : []
    const { result, changes } = gradeAroundHouse(
      nodes as never,
      {
        ...rest,
        ...(edgeFacing ? { edge: { facing: edgeFacing } } : {}),
        ...(levels.length > 1 ? { pads: levels.map((level) => ({ levelId: level.id })) } : {}),
      },
      { activeLevelId: null },
    )
    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().applyNodeChanges({
        create: changes?.create?.map(({ node, parentId }) => ({
          node,
          parentId: parentId as AnyNodeId | undefined,
        })),
        update: changes?.update?.map(({ id, data }) => ({ id: id as AnyNodeId, data })),
        delete: changes?.delete?.map((id) => id as AnyNodeId),
      })
    })
    const daylight = result.daylight as { reached: boolean }
    const pads = result.pads as { padHeightM: number }[] | undefined
    return {
      ok: true,
      padHeightM: (result.padHeightM ?? pads?.[0]?.padHeightM) as number,
      cutVolumeM3: result.cutVolumeM3 as number,
      fillVolumeM3: result.fillVolumeM3 as number,
      daylightReached: daylight.reached,
    }
  } catch (error) {
    if (isAgentRefusal(error)) return { ok: false, code: error.code, message: error.message }
    throw error
  }
}
