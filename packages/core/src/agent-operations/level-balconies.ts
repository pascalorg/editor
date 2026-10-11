import { imagePointToLevel } from '../building/reference-transform'
import { requirePlanGuide } from './plan-calibration'
import { buildingMapBalconies, isBuildingMap } from './plan-survey'
import type { SceneNodes } from './types'

type Pt = [number, number]

const mapsOn = (nodes: SceneNodes, levelId: string) =>
  Object.values(nodes).filter(
    (node) =>
      node.type === 'guide' &&
      node.parentId === levelId &&
      !!node.scaleReference &&
      isBuildingMap(node),
  )

/**
 * The level whose building map draws this one: itself, else the floor it was copied from, up the
 * chain of copies. Victor run 12 rebuilt floors 05–07 as copies of 04, plans deleted.
 */
function mapLevel(nodes: SceneNodes, levelId: string) {
  const seen = new Set<string>()
  let id: string | undefined = levelId
  while (id && !seen.has(id)) {
    seen.add(id)
    if (mapsOn(nodes, id).length) return id
    const level: SceneNodes[string] | undefined = nodes[id]
    const source: unknown = level?.type === 'level' ? level.metadata?.copiedFrom : undefined
    id = typeof source === 'string' && nodes[source]?.type === 'level' ? source : undefined
  }
  return levelId
}

/**
 * The balconies the building maps on a level draw, in level coordinates: corners a b c d as the
 * survey reads them, a and d on the facade line. A projecting one steps out of the outline, open
 * on its other three sides; a loggia (added by correct_plan_reading) is set into it. A copied
 * floor reads the map of the floor it was copied from: a copy keeps its plan position.
 */
export function levelBalconies(
  nodes: SceneNodes,
  levelId: string,
): { mapped: boolean; balconies: { corners: Pt[]; projecting: boolean }[] } {
  let mapped = false
  const source = mapLevel(nodes, levelId)
  const balconies = mapsOn(nodes, source).flatMap((node) => {
    if (node.type !== 'guide') return []
    mapped = true
    const map = buildingMapBalconies(node)
    if (!map) return []
    const { view } = requirePlanGuide(nodes, node.id)
    const projecting = new Set(map.projecting.map((corners) => JSON.stringify(corners)))
    return map.balconies.map((corners) => ({
      corners: corners.map((point) => imagePointToLevel(point, view.image, view.transform) as Pt),
      projecting: projecting.has(JSON.stringify(corners)),
    }))
  })
  return { mapped, balconies }
}
