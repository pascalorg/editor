import { labelPhrases } from '../building/plan-labels'
import { referenceContours } from '../building/reference-construction'
import { imagePointToLevel } from '../building/reference-transform'
import { extractRooms } from '../lib/space-detection'
import { type AnyNode, type GuideNode, WallNode, ZoneNode } from '../schema'
import { requirePlanGuide } from './plan-calibration'
import { pointInPolygon } from './plan-geometry'
import type { SceneNodes } from './types'

/**
 * The rooms a unit plan names, as zones in each apartment it was built into. Victor run 11 built
 * B2 into 31 apartments: its SVG names every room (BEDROOM, BATH, KITCHEN, WALK-IN CLOSET…), yet
 * the rooms had no zones. A plan draws a door as a gap in a wall, so the rooms are found with each
 * gap closed for the count only; nothing is added to the walls.
 */

type Pt = [number, number]

export type UnitFit = {
  unit: GuideNode
  floorGuideId: string
  apartmentId: string
  /** A point of the unit plan, in its pixels, to where it lands on the floor's map. */
  toMap: (point: Pt) => Pt
}

/**
 * A gap closed from a wall's free end to the next wall: a door, or a few centimetres where a unit
 * plan's wall stops short of a floor wall that stands slightly off (Victor run 11's baths).
 */
const GAP = { min: 0.02, max: 1.6 }

const area = (polygon: readonly Pt[]) =>
  Math.abs(
    polygon.reduce((sum, [x, z], i) => {
      const [nx, nz] = polygon[(i + 1) % polygon.length]!
      return sum + x * nz - nx * z
    }, 0),
  ) / 2

const centroid = (polygon: readonly Pt[]): Pt =>
  polygon.reduce<Pt>(
    ([x, z], [px, pz]) => [x + px / polygon.length, z + pz / polygon.length],
    [0, 0],
  )

const distanceToSegment = ([x, z]: Pt, [ax, az]: Pt, [bx, bz]: Pt) => {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

const nearOutline = (point: Pt, outline: readonly Pt[], tolerance: number) =>
  pointInPolygon(point, outline as Pt[]) ||
  outline.some(
    (a, i) => distanceToSegment(point, a, outline[(i + 1) % outline.length]!) <= tolerance,
  )

/** Where a ray from `from` along `direction` first meets segment a–b, in metres, or null. */
function hit(from: Pt, direction: Pt, a: Pt, b: Pt): number | null {
  const [ex, ez] = [b[0] - a[0], b[1] - a[1]]
  const denominator = direction[0] * ez - direction[1] * ex
  if (Math.abs(denominator) < 1e-9) return null
  const [wx, wz] = [a[0] - from[0], a[1] - from[1]]
  const t = (wx * ez - wz * ex) / denominator
  const u = (wx * direction[1] - wz * direction[0]) / denominator
  return t > 0 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null
}

/** The door gaps of these walls, closed: from each free wall end straight on to the next wall. */
function doorBridges(walls: readonly WallNode[], levelId: string): WallNode[] {
  const bridges: WallNode[] = []
  for (const wall of walls) {
    for (const [end, other] of [
      [wall.end, wall.start],
      [wall.start, wall.end],
    ] as [Pt, Pt][]) {
      const touches = walls.some(
        (next) => next !== wall && distanceToSegment(end, next.start as Pt, next.end as Pt) < 0.05,
      )
      if (touches) continue
      const length = Math.hypot(end[0] - other[0], end[1] - other[1]) || 1
      const direction: Pt = [(end[0] - other[0]) / length, (end[1] - other[1]) / length]
      let nearest: number | null = null
      const consider = (t: number | null) => {
        if (t !== null && t >= GAP.min && t <= GAP.max && (nearest === null || t < nearest))
          nearest = t
      }
      for (const next of walls) {
        if (next === wall) continue
        consider(hit(end, direction, next.start as Pt, next.end as Pt))
        // A wall in line with this one, past the gap: the ray runs along it and never crosses it.
        for (const point of [next.start, next.end] as Pt[]) {
          const [px, pz] = [point[0] - end[0], point[1] - end[1]]
          if (Math.abs(px * direction[1] - pz * direction[0]) < 0.05)
            consider(px * direction[0] + pz * direction[1])
        }
      }
      if (nearest === null) continue
      const to: Pt = [end[0] + direction[0] * nearest, end[1] + direction[1] * nearest]
      const same = bridges.some(
        (b) =>
          Math.hypot(b.start[0] - to[0], b.start[1] - to[1]) < 0.05 &&
          Math.hypot(b.end[0] - end[0], b.end[1] - end[1]) < 0.05,
      )
      if (!same)
        bridges.push(
          WallNode.parse({ parentId: levelId, start: end, end: to, thickness: 0.05, height: 0 }),
        )
    }
  }
  return bridges
}

/**
 * A room's labels as the plan reads them: lines stacked under each other are one name ("WALK-IN"
 * over "CLOSET"), the names of an open space are listed. In the unit plan's own frame, so a
 * mirrored apartment reads the same.
 */
function phrases(labels: readonly { text: string; at: Pt }[], unit: GuideNode) {
  const plan = unit.metadata?.planReference as { width?: number; height?: number } | undefined
  return labelPhrases(labels, [plan?.width ?? 100, plan?.height ?? 100])
    .map((phrase) => phrase.text)
    .join(', ')
}

/** "WALK-IN CLOSET" → "Walk-in closet". */
const roomName = (words: string) => words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()

export function namedUnitRooms(nodes: SceneNodes, fits: readonly UnitFit[]): ZoneNode[] {
  const zones: ZoneNode[] = []
  for (const fit of fits) {
    const labels = (fit.unit.metadata?.referenceLabels ?? []) as { text: string; at: Pt }[]
    if (!labels.length) continue
    const { guide: floor, view } = requirePlanGuide(nodes, fit.floorGuideId)
    const levelId = floor.parentId
    const apartment = referenceContours(floor).find((contour) => contour.id === fit.apartmentId)
    if (!(levelId && apartment)) continue
    const toLevel = (point: Pt) => imagePointToLevel(point, view.image, view.transform) as Pt
    const outline = apartment.points.map((point) => toLevel(point as Pt))
    const whole = area(outline)
    const walls = (Object.values(nodes) as AnyNode[]).filter(
      (node): node is WallNode =>
        node.type === 'wall' &&
        node.parentId === levelId &&
        !node.curveOffset &&
        nearOutline(node.start as Pt, outline, 0.3) &&
        nearOutline(node.end as Pt, outline, 0.3),
    )
    const rooms = extractRooms([...walls, ...doorBridges(walls, levelId)])
      .map((room) => room.referencePolygon as Pt[])
      .filter((polygon) => {
        const size = area(polygon)
        return (
          size > 0.5 && size < whole * 0.95 && pointInPolygon(centroid(polygon), outline as Pt[])
        )
      })
    const named = rooms.flatMap((polygon) => {
      const inside = labels.filter((label) => pointInPolygon(toLevel(fit.toMap(label.at)), polygon))
      return inside.length ? [{ polygon, name: roomName(phrases(inside, fit.unit)) }] : []
    })
    const apartmentName =
      (Object.values(nodes) as AnyNode[]).find(
        (node) =>
          node.type === 'unit' &&
          node.members.some((member) => {
            const zone = nodes[member] as AnyNode | undefined
            const outlineId = (zone?.metadata as { referenceOutline?: { outlineId?: string } })
              ?.referenceOutline?.outlineId
            return zone?.parentId === levelId && outlineId === fit.apartmentId
          }),
      )?.name ?? fit.apartmentId
    const counts = new Map<string, number>()
    for (const { name } of named) counts.set(name, (counts.get(name) ?? 0) + 1)
    const seen = new Map<string, number>()
    for (const { polygon, name } of named) {
      const n = (seen.get(name) ?? 0) + 1
      seen.set(name, n)
      zones.push(
        ZoneNode.parse({
          parentId: levelId,
          name: `${apartmentName} · ${name}${(counts.get(name) ?? 0) > 1 ? ` ${n}` : ''}`,
          polygon,
          spaceRole: 'room',
          autoFromWalls: false,
          metadata: { unitPlanRoom: { guideId: fit.unit.id, apartmentId: fit.apartmentId } },
        }),
      )
    }
  }
  return zones
}
