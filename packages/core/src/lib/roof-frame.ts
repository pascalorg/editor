import type { RoofNode } from '../schema/nodes/roof'
import type { RoofSegmentNode } from '../schema/nodes/roof-segment'

type Point = readonly [number, number, number]
type PlanPoint = readonly [number, number]

/** Segment coordinates are already bent; the destination is the roof's parent level, not world. */
export function roofSegmentFrame(
  roof: Pick<RoofNode, 'position' | 'rotation'>,
  segment: Pick<RoofSegmentNode, 'position' | 'rotation'>,
) {
  const rotate = (point: Point, angle: number): [number, number, number] => {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return [point[0] * cos + point[2] * sin, point[1], -point[0] * sin + point[2] * cos]
  }
  const translate = (point: Point, offset: Point, sign = 1): [number, number, number] => [
    point[0] + sign * offset[0],
    point[1] + sign * offset[1],
    point[2] + sign * offset[2],
  ]
  const localToLevel = (point: Point) =>
    translate(
      rotate(translate(rotate(point, segment.rotation), segment.position), roof.rotation),
      roof.position,
    )
  const levelToLocal = (point: Point) =>
    rotate(
      translate(rotate(translate(point, roof.position, -1), -roof.rotation), segment.position, -1),
      -segment.rotation,
    )
  return {
    toLocal(point: PlanPoint): [number, number] {
      const local = levelToLocal([point[0], 0, point[1]])
      return [local[0], local[2]]
    },
    toPlan(point: PlanPoint): [number, number] {
      const level = localToLevel([point[0], 0, point[1]])
      return [level[0], level[2]]
    },
    levelToLocal,
    localToLevel,
    normalToLevel: (normal: Point) => rotate(normal, roof.rotation + segment.rotation),
  }
}
