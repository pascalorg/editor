import { expect, it } from 'bun:test'
import {
  planStairPreset,
  resolveStairArcDimensions,
  resolveStairWalkingPaths,
  StairNode,
} from '../../index'

it('walking lines follow turning landings and preserve signed arc ascent and arrival', () => {
  const original = StairNode.parse({ totalRise: 3 })
  for (const layout of ['l', 'u'] as const) {
    const plan = planStairPreset(original, { [original.id]: original }, { layout })
    const paths = resolveStairWalkingPaths(plan.stair, plan.segments, 3)
    expect(paths).toHaveLength(1)
    expect(paths[0]![0]![1]).toBe(0)
    expect(paths[0]!.at(-1)![1]).toBeCloseTo(3)
    expect(
      paths[0]!.filter((point) => point[1] === plan.segments[0]!.height).length,
    ).toBeGreaterThan(2)
    const hidden = plan.segments.map((segment, index) =>
      index === 0 ? { ...segment, visible: false } : segment,
    )
    expect(resolveStairWalkingPaths(plan.stair, hidden, 3)[0]![0]![1]).toBeCloseTo(
      plan.segments[0]!.height,
    )
  }
  for (const sweepAngle of [4 * Math.PI, -4 * Math.PI]) {
    const stair = StairNode.parse({
      stairType: 'spiral',
      sweepAngle,
      totalRise: 3,
      topLandingMode: 'integrated',
    })
    const layout = resolveStairArcDimensions(stair, 3)
    const path = resolveStairWalkingPaths(stair, [], 3)[0]!
    expect(path[0]![1]).toBe(0)
    expect(path.at(-1)![1]).toBe(3)
    const angle = sweepAngle / 2 + layout.landingSweep
    expect(path.at(-1)![0]).toBeCloseTo(Math.cos(angle) * layout.walkingRadius)
    expect(path.at(-1)![2]).toBeCloseTo(Math.sin(angle) * layout.walkingRadius)
    for (const point of path)
      expect(Math.hypot(point[0], point[2])).toBeCloseTo(layout.walkingRadius)
  }
})
