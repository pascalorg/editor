import type { AnyNode, RoofNode, RoofSegmentNode } from '../schema'
import { getRoofSegmentSurfaceY, getSegmentSlopeFrame } from '../schema'
import type { LevelElevation } from '../services/storey'

type Vec2 = [number, number]

/** One roof segment, placed in the plan: its footprint and how to bring a plan point into it. */
type Placed = {
  segment: RoofSegmentNode
  /** The segment's own height above the roof's seat (m). */
  lift: number
  /** Half the thickness of the shell the segment stands on its edge (m). */
  shellHalf: number
  /** Vertical thickness of deck and covering, straight up from the underside (m). */
  coveringThickness: number
  toLocal: (point: Vec2) => Vec2
}

/** A roof as a body in the plan: its seat and the segments that make it. */
export type RoofBody = {
  roof: RoofNode
  levelId: string
  /** Where the body starts, in world metres: the roof level's base plus the roof's own height. */
  seat: number
  /** The segments whose shape is measured; conical, curved-shed and piecewise-shed ones are not. */
  segments: Placed[]
  center: Vec2
}

export type RoofSample = {
  /** The roof's underside at the point, in world metres. */
  underside: number
  /**
   * Where the roof's own wall ends at the point, in world metres: the top of its knee wall or of
   * its gable end along an edge, from the seat. Where the deck begins. Inside the edge it is the
   * underside. A building wall ending between the seat and here is the roof's wall twice.
   */
  solid: number
  /** The top of its covering at the point, in world metres. */
  covering: number
  /** How far the point is inside the roof's nearest edge (m); negative within the edge band. */
  insetFromEdge: number
}

const SKIN = 0.02

const rotateInto = ([x, z]: Vec2, angle: number): Vec2 => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos - z * sin, x * sin + z * cos]
}

function isMeasured(segment: RoofSegmentNode): boolean {
  return segment.roofType !== 'conical' && !segment.arc && !segment.shedFootprintPieces
}

/**
 * A roof as the viewer builds it, from the stored node alone: the seat is the stored height of the
 * roof on its level (a roof that follows its walls has it written by the editor's own system).
 */
export function resolveRoofBody(
  roof: RoofNode,
  levelId: string,
  nodes: Readonly<Record<string, AnyNode>>,
  elevations: ReadonlyMap<string, LevelElevation>,
): RoofBody {
  const seat = (elevations.get(levelId)?.baseY ?? 0) + roof.position[1]
  const toRoofLocal = (point: Vec2): Vec2 =>
    rotateInto([point[0] - roof.position[0], point[1] - roof.position[2]], roof.rotation)
  const segments: Placed[] = []
  // A roof saved before it carried children has none; it is a roof of no segments.
  for (const id of roof.children ?? []) {
    const segment = nodes[id]
    if (segment?.type !== 'roof-segment') continue
    if (!isMeasured(segment)) continue
    const { cosTheta } = getSegmentSlopeFrame(segment)
    segments.push({
      segment,
      lift: segment.position[1],
      shellHalf: Math.max(segment.wallThickness, 0) / 2,
      coveringThickness: (segment.deckThickness + segment.shingleThickness) / cosTheta,
      toLocal: (point) => {
        const inRoof = toRoofLocal(point)
        return rotateInto(
          [inRoof[0] - segment.position[0], inRoof[1] - segment.position[2]],
          segment.rotation,
        )
      },
    })
  }
  return { roof, levelId, seat, segments, center: [roof.position[0], roof.position[2]] }
}

/**
 * The roof body at a plan point, or null where there is none. `reach` is half the thickness of
 * what stands there: a wall whose face lies on the roof's edge has its centre that far inside it.
 * Along the edge of a segment the body stands on the seat itself: its own shell, or a gable end,
 * closes the edge from there up. Inside it, only the deck is there, as high as the slope puts it.
 * Where segments join, an edge lying inside another segment is not an edge.
 */
export function sampleRoofBody(body: RoofBody, point: Vec2, reach = 0): RoofSample | null {
  const inside: { placed: Placed; local: Vec2; inset: number; band: number }[] = []
  for (const placed of body.segments) {
    const local = placed.toLocal(point)
    const inset = Math.min(
      placed.segment.width / 2 - Math.abs(local[0]),
      placed.segment.depth / 2 - Math.abs(local[1]),
    )
    const band = placed.shellHalf + reach + SKIN
    if (inset >= -band) inside.push({ placed, local, inset, band })
  }
  if (!inside.length) return null

  const surface = ({ placed, local }: (typeof inside)[number]) => {
    const { segment } = placed
    const x = Math.max(-segment.width / 2, Math.min(segment.width / 2, local[0]))
    const z = Math.max(-segment.depth / 2, Math.min(segment.depth / 2, local[1]))
    return body.seat + placed.lift + getRoofSegmentSurfaceY(segment, x, z)
  }

  const interior = inside.filter(({ inset, band }) => inset > band)
  const onEdge = interior.length === 0
  const used = onEdge ? inside : interior
  const underside = onEdge
    ? Math.min(...used.map(({ placed }) => body.seat + placed.lift))
    : Math.min(...used.map((entry) => Math.max(surface(entry), body.seat + entry.placed.lift)))
  const covering = Math.max(...used.map((entry) => surface(entry) + entry.placed.coveringThickness))
  const solid = onEdge ? Math.max(underside, ...used.map((entry) => surface(entry))) : underside
  return {
    underside,
    solid,
    covering,
    insetFromEdge: Math.max(...inside.map(({ inset }) => inset)),
  }
}
