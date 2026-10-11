import { expect, it } from 'bun:test'
import {
  computeSegmentTransforms,
  measureStair,
  measureStairDetail,
  planStairPreset,
  resolveStairHandrailPaths,
  resolveStairRailPaths,
  resolveStairWinder,
  rotateXZ,
  StairNode,
  StairSegmentNode,
} from '../../index'

it('keeps continuous guards around turning landing edges and handrails independent of guards', () => {
  for (const layout of ['straight', 'l', 'u'] as const)
    for (const turn of ['left', 'right'] as const) {
      const stair = StairNode.parse({
        totalRise: 3,
        railingMode: 'both',
        railingPath: 'continuous',
        handrail: { mode: 'left' },
      })
      const plan = planStairPreset(stair, { [stair.id]: stair }, { layout, turn })
      const nodes = Object.fromEntries(
        [plan.stair, ...plan.segments].map((node) => [node.id, node]),
      )
      const paths = resolveStairRailPaths(plan.stair, nodes)
      expect(paths).toHaveLength(2)
      expect(new Set(paths.map((path) => path.side))).toEqual(new Set(['left', 'right']))
      expect(
        paths.every((path) => path.points.every((point) => point.every(Number.isFinite))),
      ).toBe(true)
      const landingIds = plan.segments
        .filter((segment) => segment.segmentType === 'landing')
        .map((segment) => segment.id)
      for (const id of landingIds)
        expect(paths.some((path) => path.nodeIds.includes(id))).toBe(true)
      const handrails = resolveStairHandrailPaths({ ...plan.stair, railingMode: 'none' }, nodes)
      expect(handrails).toHaveLength(1)
      expect(handrails[0]!.side).toBe('left')
      const transforms = computeSegmentTransforms(plan.segments)
      const hidden = plan.segments[0]!
      const downstream = plan.segments.at(-1)!
      const hiddenNodes = { ...nodes, [hidden.id]: { ...hidden, visible: false } }
      const remaining = resolveStairRailPaths(plan.stair, hiddenNodes)
      if (layout !== 'straight')
        expect(
          remaining.some((path) =>
            path.points.some(
              (point) =>
                Math.abs(point[1] - transforms.at(-1)!.position[1] - downstream.height) < 0.0002,
            ),
          ),
        ).toBe(true)
    }
  for (const sign of [-1, 1]) {
    const stair = StairNode.parse({
      stairType: 'spiral',
      sweepAngle: sign * 4 * Math.PI,
      stepCount: 28,
      totalRise: 4.2,
      topLandingMode: 'integrated',
      railingMode: 'both',
      railingPath: 'continuous',
      handrail: { mode: 'both' },
    })
    const paths = resolveStairRailPaths(stair, { [stair.id]: stair })
    expect(paths).toHaveLength(2)
    expect(paths.every((path) => path.points.at(-1)![1] === 4.2)).toBe(true)
    expect(
      paths.every((path) =>
        path.points.some((point) => point[1] > 0 && point[1] < stair.totalRise!),
      ),
    ).toBe(true)
    const handrails = resolveStairHandrailPaths(stair, { [stair.id]: stair })
    expect(Math.hypot(...[handrails[0]!.points[0]![0], handrails[0]!.points[0]![2]])).toBeCloseTo(
      sign > 0
        ? stair.innerRadius + stair.handrail!.offset
        : stair.innerRadius + stair.width - stair.handrail!.offset,
    )
  }
  const tooLarge = StairNode.parse({
    stairType: 'spiral',
    stepCount: 9999,
    sweepAngle: 1e9,
    railingMode: 'both',
    railingPath: 'continuous',
  })
  expect(measureStairDetail(tooLarge, []).status).toBe('unresolved')
  expect(() => resolveStairRailPaths(tooLarge, { [tooLarge.id]: tooLarge })).toThrow(
    'computation budget',
  )
})

it('accepted glass guard budgets stay accepted in path construction and inset landing loops remain closed', () => {
  const flight = StairSegmentNode.parse({ length: 400, width: 1, stepCount: 10 })
  const stair = StairNode.parse({
    railingMode: 'both',
    railingPath: 'continuous',
    railingStyle: 'glass',
    children: [flight.id],
  })
  const nodes = { [stair.id]: stair, [flight.id]: flight }
  expect(measureStairDetail(stair, [flight]).status).toBe('evaluated')
  expect(resolveStairRailPaths(stair, nodes)).toHaveLength(2)
  expect(measureStair(stair, nodes).railings.paths).toHaveLength(2)
  const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0, width: 1, length: 1 })
  const loop = StairNode.parse({
    railingMode: 'both',
    railingPath: 'continuous',
    children: [landing.id],
    handrail: { mode: 'both' },
  })
  const paths = resolveStairHandrailPaths(loop, { [loop.id]: loop, [landing.id]: landing })
  expect(paths).toHaveLength(1)
  expect(paths[0]!.points[0]).toEqual(paths[0]!.points.at(-1)!)
  expect(
    paths[0]!.points.every(
      ([x, , z]) => Math.abs(x) < landing.width / 2 && z > 0 && z < landing.length,
    ),
  ).toBe(true)
  const handrailOnly = StairNode.parse({
    handrail: { mode: 'both' },
    railingMode: 'none',
    railingStyle: 'cable',
    railingHeight: 1e9,
  })
  expect(measureStairDetail(handrailOnly, []).status).toBe('evaluated')
  expect(resolveStairHandrailPaths(handrailOnly, { [handrailOnly.id]: handrailOnly })).toHaveLength(
    2,
  )
})

it('extends independent handrails at ascent portals and returns to source and arrival floors', () => {
  expect(StairNode.parse({ handrail: {} }).handrail?.bottom).toBeUndefined()
  for (const layout of ['straight', 'l', 'u'] as const) {
    const stair = StairNode.parse({
      totalRise: 3,
      handrail: {
        mode: 'both',
        offset: 0,
        bottom: { extension: 0.3, return: 'floor' },
        top: { extension: 0.4, return: 'floor' },
      },
    })
    const plan = planStairPreset(stair, { [stair.id]: stair }, { layout, turn: 'left' })
    const nodes = Object.fromEntries([plan.stair, ...plan.segments].map((node) => [node.id, node]))
    const paths = resolveStairHandrailPaths(plan.stair, nodes)
    for (const path of paths) {
      const ends = [path.points[0]!, path.points.at(-1)!].sort((a, b) => a[1] - b[1])
      expect(ends[0]![1] + stair.handrail!.height).toBeCloseTo(0)
      expect(ends[1]![1] + stair.handrail!.height).toBeCloseTo(3)
      expect(path.points.every((point) => point.every(Number.isFinite))).toBe(true)
    }
  }
  for (const sweepAngle of [2, -2]) {
    const stair = StairNode.parse({
      stairType: 'curved',
      totalRise: 3,
      sweepAngle,
      handrail: {
        mode: 'left',
        offset: 0,
        bottom: { extension: 0.3 },
        top: { extension: 0.4, return: 'wall', returnLength: 0.2 },
      },
    })
    const path = resolveStairHandrailPaths(stair, { [stair.id]: stair })[0]!
    expect(path.points[0]![1]).toBeLessThan(path.points[1]![1])
    expect(path.points.at(-2)![1]).toBeCloseTo(3)
    expect(path.points.at(-1)![1]).toBeCloseTo(3)
    expect(
      Math.hypot(
        path.points.at(-1)![0] - path.points.at(-2)![0],
        path.points.at(-1)![2] - path.points.at(-2)![2],
      ),
    ).toBeCloseTo(0.2)
  }
})

it('keeps handrail ends off closed and hidden portals and refuses a floor-crossing extension', () => {
  const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0 })
  const stair = StairNode.parse({
    children: [landing.id],
    handrail: { mode: 'both', bottom: { extension: 0.3 }, top: { extension: 0.3 } },
  })
  const nodes = { [stair.id]: stair, [landing.id]: landing }
  expect(resolveStairHandrailPaths(stair, nodes)).toEqual(
    resolveStairHandrailPaths(
      { ...stair, handrail: { ...stair.handrail!, bottom: undefined, top: undefined } },
      nodes,
    ),
  )
  const flight = StairSegmentNode.parse({ stepCount: 1, height: 1, length: 1 })
  const single = StairNode.parse({
    children: [flight.id],
    handrail: { mode: 'left', offset: 0, bottom: { extension: 0.2 }, top: { extension: 0.2 } },
  })
  const path = resolveStairHandrailPaths(single, { [single.id]: single, [flight.id]: flight })[0]!
  expect(Math.min(path.points[0]![1], path.points.at(-1)![1])).toBeCloseTo(0.8)
  expect(
    resolveStairHandrailPaths(single, {
      [single.id]: single,
      [flight.id]: { ...flight, visible: false },
    }),
  ).toEqual([])
  expect(() =>
    resolveStairHandrailPaths(
      {
        ...single,
        handrail: {
          ...single.handrail!,
          bottom: { extension: 10, return: 'none', returnLength: 0 },
        },
      },
      { [flight.id]: flight },
    ),
  ).toThrow('source floor')
})

it('keeps zero-gap L/U guards and inset handrails continuous and restores replacement winder visibility', () => {
  for (const layout of ['l', 'u'] as const)
    for (const turn of ['left', 'right'] as const)
      for (const offset of [0, 0.06]) {
        const stair = StairNode.parse({
          totalRise: 3,
          width: 1.2,
          railingMode: 'both',
          handrail: { mode: 'both', offset },
        })
        const plan = planStairPreset(
          stair,
          { [stair.id]: stair },
          { layout, turn, turningStrategy: 'winder' },
        )
        const nodes = Object.fromEntries(
          [plan.stair, ...plan.segments].map((node) => [node.id, node]),
        )
        for (const paths of [
          resolveStairRailPaths(plan.stair, nodes),
          resolveStairHandrailPaths(plan.stair, nodes),
        ]) {
          expect(paths.length).toBe(2)
          for (const path of paths) {
            expect(path.nodeIds.length).toBe(plan.segments.length)
            expect(path.points[0]![1]).toBeCloseTo(3 / plan.stair.stepCount, 10)
            expect(path.points.at(-1)![1]).toBeCloseTo(3, 10)
            for (let i = 1; i < path.points.length; i++)
              expect(path.points[i]![1]).toBeGreaterThanOrEqual(path.points[i - 1]![1] - 1e-9)
          }
        }
        const old = plan.segments.find((segment) => segment.winder)!
        const hidden = { ...old, visible: false }
        const replacement = planStairPreset(
          plan.stair,
          { ...nodes, [old.id]: hidden },
          { layout, turn, turningStrategy: 'winder' },
        )
        expect(replacement.segments.find((segment) => segment.id === old.id)!.visible).toBe(true)
      }
})

it('joins inset handrails across a winder arrival landing without closing its portal', () => {
  for (const turn of ['left', 'right'] as const) {
    const stair = StairNode.parse({
      totalRise: 3,
      width: 1.2,
      railingMode: 'both',
      handrail: { mode: 'both', offset: 0.06 },
    })
    const plan = planStairPreset(
      stair,
      { [stair.id]: stair },
      { layout: 'l', turn, turningStrategy: 'winder' },
    )
    const landing = StairSegmentNode.parse({
      segmentType: 'landing',
      height: 0,
      width: 1.2,
      length: 1.2,
    })
    plan.segments.splice(2, 0, landing)
    plan.stair.children = plan.segments.map((segment) => segment.id)
    const nodes = Object.fromEntries([plan.stair, ...plan.segments].map((node) => [node.id, node]))
    const paths = resolveStairHandrailPaths(plan.stair, nodes)
    expect(paths.length).toBe(2)
    for (const path of paths) {
      expect(path.nodeIds.length).toBe(4)
      expect(path.points[0]![1]).toBeCloseTo(3 / plan.stair.stepCount, 10)
      expect(path.points.at(-1)![1]).toBeCloseTo(3, 10)
    }
  }
})

it('extends terminal zero-gap winder handrails from their entry and exit portals', () => {
  for (const turn of ['left', 'right'] as const)
    for (const offset of [0, 0.06])
      for (const returnType of ['floor', 'wall'] as const) {
        const flight = StairSegmentNode.parse({
          width: 1.2,
          height: 0.9,
          stepCount: 4,
          winder: { turn, innerGap: 0, walkingLineOffset: 0.6 },
        })
        const extension = offset ? 0.05 : 0.2
        const stair = StairNode.parse({
          totalRise: 0.9,
          children: [flight.id],
          railingMode: 'both',
          handrail: {
            mode: 'both',
            offset,
            bottom: { extension, return: returnType, returnLength: 0.1 },
            top: { extension, return: returnType, returnLength: 0.1 },
          },
        })
        const paths = resolveStairHandrailPaths(stair, { [stair.id]: stair, [flight.id]: flight })
        const exit = resolveStairWinder(flight)!.exit
        expect(paths.length).toBe(2)
        for (const path of paths) {
          expect(path.points.length).toBeGreaterThanOrEqual(6)
          const bottomReturn = path.points[0]!,
            bottomExtended = path.points[1]!,
            topExtended = path.points.at(-2)!,
            topReturn = path.points.at(-1)!
          expect(bottomExtended[2]).toBeCloseTo(-extension, 10)
          const [dx, dz] = rotateXZ(
            topExtended[0] - exit.position[0],
            topExtended[2] - exit.position[2],
            -exit.rotation,
          )
          expect(dz).toBeCloseTo(extension, 10)
          expect(Number.isFinite(dx)).toBe(true)
          if (returnType === 'floor') {
            expect(bottomReturn[1] + stair.handrail!.height).toBeCloseTo(0, 10)
            expect(topReturn[1] + stair.handrail!.height).toBeCloseTo(0.9, 10)
          } else {
            expect(
              Math.hypot(bottomReturn[0] - bottomExtended[0], bottomReturn[2] - bottomExtended[2]),
            ).toBeCloseTo(0.1, 10)
            expect(
              Math.hypot(topReturn[0] - topExtended[0], topReturn[2] - topExtended[2]),
            ).toBeCloseTo(0.1, 10)
          }
        }
      }
})
