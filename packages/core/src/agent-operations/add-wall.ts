import { refuse } from '../agent-tools/refusal'
import { levelFootprintLoops } from '../lib/building-footprint'
import { lotOverhang } from '../lib/site-placement'
import { type LevelNode, WallNode } from '../schema'
import { isRoofLevel } from '../services/roof-level'
import { normalizeWallCurveOffset } from '../systems/wall/wall-curve'
import { WALL_MIN_LENGTH } from '../systems/wall/wall-topology'
import { applySceneChanges } from './apply-changes'
import { type LevelTargetInput, targetLevel } from './level-target'
import type { AgentOperation, SceneNodes } from './types'

type Pt = [number, number]
type AddWallInput = LevelTargetInput & {
  start: number[]
  end: number[]
  thickness?: number
  height?: number
  curveOffset?: number
}

/** A level declared as the roof holds the roof, not rooms: walls and stairs stay off it. */
export function refuseRoofLevel(nodes: SceneNodes, levelId: string, what: string) {
  if (isRoofLevel(nodes[levelId]))
    refuse(
      'roof_level',
      `${levelId} is a roof level, not a storey: ${what} belongs on an occupied storey. Add one with add_level if the building needs it.`,
      { levelId },
    )
}

/** `add_wall`: one wall between two points, named as the editor names walls. */
export const addWall: AgentOperation<AddWallInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, level.id, 'a wall')
  const start = input.start as Pt
  const end = input.end as Pt
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (length < WALL_MIN_LENGTH)
    refuse(
      'wall_too_short',
      `A wall from [${start}] to [${end}] is ${length.toFixed(3)} m long; the editor draws none shorter than ${WALL_MIN_LENGTH} m.`,
      { length },
    )
  const curveOffset = input.curveOffset
    ? normalizeWallCurveOffset({ start, end }, input.curveOffset)
    : 0
  const walls = Object.values(nodes).filter((node) => node.type === 'wall').length
  const wall = WallNode.parse({
    name: `Wall ${walls + 1}`,
    parentId: level.id,
    start,
    end,
    ...(input.thickness === undefined ? {} : { thickness: input.thickness }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(curveOffset ? { curveOffset } : {}),
  })
  // the wall's mitred band, curve and all: what crosses the lot line, not only its centreline
  const after = applySceneChanges(nodes, { create: [{ node: wall, parentId: level.id }] })
  const site = lotOverhang(
    after,
    level.id,
    levelFootprintLoops(after, after[level.id] as LevelNode, null, new Set([wall.id])),
  )
  return {
    result: {
      ok: true,
      wallId: wall.id,
      name: wall.name,
      levelId: level.id,
      length: Math.round(length * 1000) / 1000,
      ...(curveOffset ? { curveOffset } : {}),
      ...(site ? { site } : {}),
      message: `Added wall "${wall.name}" on ${level.name ?? level.id}${
        site
          ? `; it reaches ${site.overhangM} m past the lot line (${site.sides.join(', ')}): the house belongs inside the buildable area (get_site, place_building)`
          : ''
      }`,
    },
    changes: { create: [{ node: wall, parentId: level.id }] },
  }
}
