import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode } from '@pascal-app/core'
import { createLeanToAssembly } from './assembly'
import { resolveLeanToFreestandingRunPlacement } from './placement'

type Point = readonly [number, number]

function polygonArea(points: readonly Point[]): number {
  let area = 0
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area / 2)
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function hasSelfIntersection(polygon: readonly Point[]): boolean {
  for (let first = 0; first < polygon.length; first++) {
    for (let second = first + 1; second < polygon.length; second++) {
      const adjacent = second === first + 1 || (first === 0 && second === polygon.length - 1)
      if (adjacent) continue
      const a = polygon[first]!
      const b = polygon[second]!
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-8) return true
    }
  }
  for (let first = 0; first < polygon.length; first++) {
    const firstNext = (first + 1) % polygon.length
    for (let second = first + 1; second < polygon.length; second++) {
      const secondNext = (second + 1) % polygon.length
      if (
        first === second ||
        firstNext === second ||
        secondNext === first ||
        (first === 0 && secondNext === 0)
      ) {
        continue
      }
      const a = polygon[first]!
      const b = polygon[firstNext]!
      const c = polygon[second]!
      const d = polygon[secondNext]!
      const firstSide = orientation(a, b, c)
      const secondSide = orientation(a, b, d)
      const thirdSide = orientation(c, d, a)
      const fourthSide = orientation(c, d, b)
      if (firstSide * secondSide < -1e-10 && thirdSide * fourthSide < -1e-10) return true
    }
  }
  return false
}

describe('multi-joint mono canopy', () => {
  test('keeps both branches simple and preserves their area at the failing concave turn', () => {
    const level = LevelNode.parse({ id: 'level_mono_z_chain', level: 0 })
    const runs = [
      resolveLeanToFreestandingRunPlacement(level.id, [2, 12], [7, 7], false, 'mono')!,
      resolveLeanToFreestandingRunPlacement(level.id, [7, 7], [15.5, 7.5], false, 'mono')!,
    ]
    const nodes = Object.fromEntries([level, ...runs].map((node) => [node.id, node])) as Record<
      string,
      AnyNode
    >
    const footprintsByRun = runs.map(
      (run) => createLeanToAssembly(run, undefined, nodes).segment.shedFootprintPieces ?? [],
    )

    expect(footprintsByRun.every((footprints) => footprints.length > 0)).toBe(true)
    expect(footprintsByRun.flat().some(hasSelfIntersection)).toBe(false)
    expect(
      footprintsByRun[0]!.reduce((sum, footprint) => sum + polygonArea(footprint), 0),
    ).toBeCloseTo(18.303629451612156)
    expect(
      footprintsByRun[1]!.reduce((sum, footprint) => sum + polygonArea(footprint), 0),
    ).toBeCloseTo(22.29958447881066)
  })

  // A J-shape (chain of 3+ freestanding straight mono runs) is not mitered: each
  // run renders as a plain rectangle with no shaped footprint pieces.
  test('leaves every run un-mitered across both joints in the reported layout', () => {
    const level = LevelNode.parse({ id: 'level_mono_reported_layout', level: 0 })
    const runs = [
      resolveLeanToFreestandingRunPlacement(level.id, [-7, 11.5], [2, 12], false, 'mono')!,
      resolveLeanToFreestandingRunPlacement(level.id, [2, 12], [7, 7], false, 'mono')!,
      resolveLeanToFreestandingRunPlacement(level.id, [7, 7], [15.5, 7.5], false, 'mono')!,
    ]
    const nodes = Object.fromEntries([level, ...runs].map((node) => [node.id, node])) as Record<
      string,
      AnyNode
    >
    const footprintsByRun = runs.map(
      (run) => createLeanToAssembly(run, undefined, nodes).segment.shedFootprintPieces ?? [],
    )

    expect(footprintsByRun.every((footprints) => footprints.length === 0)).toBe(true)
  })

  test('leaves every run un-mitered when the first run forms the top of a J', () => {
    const level = LevelNode.parse({ id: 'level_mono_browser_top_first_j', level: 0 })
    const points: Point[] = [
      [-6, 2.5],
      [0, -3.5],
      [4.5, 1.5],
      [2, 4],
    ]
    const runs = points
      .slice(0, -1)
      .map((start, index) =>
        resolveLeanToFreestandingRunPlacement(level.id, start, points[index + 1]!, false, 'mono'),
      )
    const nodes = Object.fromEntries([level, ...runs].map((node) => [node!.id, node])) as Record<
      string,
      AnyNode
    >
    const footprintsByRun = runs.map(
      (run) => createLeanToAssembly(run!, undefined, nodes).segment.shedFootprintPieces ?? [],
    )

    expect(footprintsByRun.every((footprints) => footprints.length === 0)).toBe(true)
  })
})
