import { area, intersection, type Polygon, union } from '../lib/polygon-boolean'
import { polygonInteriorPoint } from '../lib/polygon-label'
import { detectSpacesForLevel } from '../lib/space-detection'
import type { AnyNode } from '../schema'
import { nodesOnLevel } from './scene-queries'
import type { SceneNodes } from './types'

/**
 * A level's rooms against the spaces its walls and separators enclose (the editor's detected
 * spaces): a space no zone covers, a room the walls do not close, a room with no name.
 */
export type RoomFinding =
  | {
      type: 'space_no_room'
      message: string
      levelId: string
      /** The space's floor area, m². */
      area: number
      /** A point inside the space, in plan [x, z]. */
      at: [number, number]
      wallIds: string[]
    }
  | { type: 'room_not_enclosed'; message: string; levelId: string; zoneId: string }
  | { type: 'room_unnamed'; message: string; severity: 'info'; levelId: string; zoneId: string }

type Zone = AnyNode & { type: 'zone' }

/** No name, or the bare word an older scene or a blank name leaves: "Room", "Zone". */
const PLACEHOLDER_NAME = /^\s*(room|zone)?\s*$/i

/** A space is covered, and a room enclosed, past half its area. */
const COVERED = 0.5

const round = (value: number) => Math.round(value * 100) / 100
const footprint = (polygon: [number, number][], holes: [number, number][][] = []): Polygon => ({
  outer: polygon,
  holes,
})
const share = (part: Polygon, cover: Polygon[]) => {
  const whole = area([part])
  return whole > 0 && cover.length > 0 ? area(intersection(part, union(cover))) / whole : 0
}

/**
 * Every space the walls enclose wants a zone over it (any zone: a drawn one is adopted as the room
 * on load); every room (`spaceRole: 'room'`, not declared open) wants walls or separators closing
 * around it, and a name. A terrace closes with separators, so it counts as enclosed; a generic zone
 * (a site or analysis area) needs neither walls nor a name.
 */
export function roomFindings(
  nodes: SceneNodes,
  levelId: string,
  levelName: string,
): { spaces: number; issues: RoomFinding[] } {
  const onLevel = nodesOnLevel(nodes, levelId)
  const boundaries = onLevel.filter(
    (node): node is AnyNode & { type: 'wall' | 'separator' } =>
      node.type === 'wall' || node.type === 'separator',
  )
  const zones = onLevel.filter((node): node is Zone => node.type === 'zone')
  const { spaces } = detectSpacesForLevel(levelId, boundaries)
  const spaceFootprints = spaces.map((space) => footprint(space.polygon, space.holes))
  const zoneFootprints = zones
    .filter((zone) => zone.polygon.length >= 3)
    .map((zone) => footprint(zone.polygon, zone.holes))
  const issues: RoomFinding[] = []

  spaces.forEach((space, index) => {
    const outline = spaceFootprints[index]!
    if (share(outline, zoneFootprints) >= COVERED) return
    const spaceArea = round(area([outline]))
    const [x, z] = polygonInteriorPoint(space, true).map(round) as [number, number]
    issues.push({
      type: 'space_no_room',
      message: `On ${levelName}, walls ${space.wallIds.join(', ')} enclose a ${spaceArea.toFixed(1)} m² space at (${x.toFixed(2)}, ${z.toFixed(2)}) with no room over it.`,
      levelId,
      area: spaceArea,
      at: [x, z],
      wallIds: space.wallIds,
    })
  })

  for (const zone of zones) {
    if (zone.spaceRole !== 'room') continue
    const label = PLACEHOLDER_NAME.test(zone.name) ? zone.id : `"${zone.name}" (${zone.id})`
    if (
      zone.enclosureStatus !== 'open' &&
      zone.polygon.length >= 3 &&
      share(footprint(zone.polygon, zone.holes), spaceFootprints) < COVERED
    )
      issues.push({
        type: 'room_not_enclosed',
        message: `Room ${label} on ${levelName}: its walls do not close around it.`,
        levelId,
        zoneId: zone.id,
      })
    if (PLACEHOLDER_NAME.test(zone.name))
      issues.push({
        type: 'room_unnamed',
        message: `Room ${zone.id} on ${levelName} has no name${zone.name.trim() ? ` but "${zone.name.trim()}"` : ''}.`,
        severity: 'info',
        levelId,
        zoneId: zone.id,
      })
  }

  return { spaces: spaces.length, issues }
}
