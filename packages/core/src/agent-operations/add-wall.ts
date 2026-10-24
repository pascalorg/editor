import { refuse } from '../agent-tools/refusal'
import { levelFootprintLoops } from '../lib/building-footprint'
import { foundationReadingOfLevel } from '../lib/foundation-construction'
import {
  foundationWallRule,
  levelHoldsFoundationWalls,
  withFoundationConstruction,
} from '../lib/foundation-wall'
import { lotOverhang } from '../lib/site-placement'
import { type LevelNode, WallNode } from '../schema'
import { normalizeWallCurveOffset } from '../systems/wall/wall-curve'
import { WALL_MIN_LENGTH } from '../systems/wall/wall-topology'
import { applySceneChanges } from './apply-changes'
import { type LevelTargetInput, targetLevel } from './level-target'
import { refuseRoofLevel } from './roof-writes'
import { queryNodes } from './scene-queries'
import type { AgentOperation } from './types'

type Pt = [number, number]
type AddWallInput = LevelTargetInput & {
  start: number[]
  end: number[]
  thickness?: number
  height?: number
  curveOffset?: number
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
  const walls = queryNodes(nodes, { type: 'wall' }).length
  const drawn = WallNode.parse({
    name: `Wall ${walls + 1}`,
    parentId: level.id,
    start,
    end,
    ...(input.thickness === undefined ? {} : { thickness: input.thickness }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(curveOffset ? { curveOffset } : {}),
  })
  const [wall] = withFoundationConstruction(
    nodes,
    level.id,
    [...queryNodes<WallNode>(nodes, { type: 'wall', parentId: level.id }), drawn],
    [drawn],
    { thickness: input.thickness },
  ) as [WallNode]
  const reading = foundationReadingOfLevel(nodes, level.id)
  const foundation = wall.assembly !== undefined
  const partition =
    !foundation && input.thickness === undefined && levelHoldsFoundationWalls(nodes, level.id)
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
      ...(foundation
        ? {
            construction: {
              assembly: reading.construction.description,
              thickness: wall.thickness,
              region: reading.region,
              basis: reading.basis,
            },
          }
        : {}),
      message: `Added wall "${wall.name}" on ${level.name ?? level.id}${
        foundation
          ? `, a foundation wall against the ground (${reading.construction.description}), ${(wall.thickness ?? 0).toFixed(3)} m thick; ${reading.basis}; a wall given a thickness keeps it`
          : partition
            ? `, an ordinary wall: a partition inside the outline of this level's walls; ${foundationWallRule(reading)}`
            : ''
      }${
        site
          ? `; it reaches ${site.overhangM} m past the lot line (${site.sides.join(', ')}): the house belongs inside the buildable area (get_site, place_building)`
          : ''
      }`,
    },
    changes: { create: [{ node: wall, parentId: level.id }] },
  }
}
