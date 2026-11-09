import { describe, expect, test } from 'bun:test'
import {
  computeGutterEaveY,
  createDefaultGuttersForSegment,
  getDefaultGutterSide,
  getGutterRunsForSegment,
  isAutoGutterEnabled,
  isDefaultGutterNode,
} from './gutter'
import { RoofSegmentNode, type RoofType } from './roof-segment'

describe('createDefaultGuttersForSegment', () => {
  test.each([
    ['shed', ['+Z']],
    ['gable', ['+Z', '-Z']],
    ['gambrel', ['+Z', '-Z']],
    ['hip', ['+Z', '-Z', '+X', '-X']],
    ['dutch', ['+Z', '-Z', '+X', '-X']],
    ['mansard', ['+Z', '-Z', '+X', '-X']],
    ['flat', ['+Z', '-Z', '+X', '-X']],
  ] satisfies [RoofType, string[]][])('creates the expected %s roof eaves', (roofType, sides) => {
    const segment = RoofSegmentNode.parse({ roofType, width: 8, depth: 6 })
    const gutters = createDefaultGuttersForSegment(segment)

    expect(gutters.map((gutter) => getDefaultGutterSide(gutter, segment.id))).toEqual(sides)
    expect(gutters.every((gutter) => isDefaultGutterNode(gutter, segment.id))).toBe(true)
  })

  test("a barrel's eave gutters hang where its arch springs; its overhang only lengthens them", () => {
    const front = (overhang: number) =>
      getGutterRunsForSegment(
        RoofSegmentNode.parse({
          roofType: 'barrel',
          width: 8,
          depth: 6,
          overhang,
          wallHeight: 0.5,
        }),
      ).find((run) => run.side === '+Z')!
    expect(front(0.3).position[2]).toBe(3)
    expect(front(1).position).toEqual(front(0.3).position)
    expect(front(1).length - front(0.3).length).toBeCloseTo(1.4)
  })

  test('spans the full tucked perimeter so four-sided gutters meet at corners', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'flat',
      width: 8,
      depth: 6,
      overhang: 0.3,
      wallHeight: 0.5,
    })
    const runs = getGutterRunsForSegment(segment)
    const front = runs.find((run) => run.side === '+Z')
    const right = runs.find((run) => run.side === '+X')

    expect(front?.position).toEqual([0, 0.5, 3.26])
    expect(front?.length).toBeCloseTo(8.52)
    expect(right?.position).toEqual([4.26, 0.5, 0])
    expect(right?.length).toBeCloseTo(6.52)
  })

  test("a gable's eave gutters run out to its rakes: the deck's edge, its own gable overhang", () => {
    const segment = (gableOverhang?: number) =>
      RoofSegmentNode.parse({
        roofType: 'gable',
        width: 8,
        depth: 6,
        overhang: 0.3,
        wallThickness: 0.2,
        gableOverhang,
      })
    const front = (gableOverhang?: number) =>
      getGutterRunsForSegment(segment(gableOverhang)).find((run) => run.side === '+Z')
    // without one, as far as the eaves in plan: half the wall, then the overhang along the 40° slope
    expect(front()?.length).toBeCloseTo(2 * (4 + 0.1 + 0.3 * Math.cos((40 * Math.PI) / 180) - 0.04))
    // with one, the walls' half thickness and the gable overhang past their faces
    expect(front(0.9)?.length).toBeCloseTo(2 * (4 + 0.1 + 0.9 - 0.04))
    expect(front(0)?.length).toBeCloseTo(2 * (4 + 0.1 - 0.04))
  })

  test('omits fully trimmed sides and shortens their adjacent eaves', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'flat',
      width: 8,
      depth: 6,
      overhang: 0.3,
      trim: { left: 1, front: 1 },
    })
    const runs = getGutterRunsForSegment(segment)

    expect(runs.map((run) => run.side)).toEqual(['-Z', '+X'])
    expect(runs.find((run) => run.side === '-Z')?.length).toBeCloseTo(7.26)
    expect(runs.find((run) => run.side === '+X')?.length).toBeCloseTo(5.26)
  })

  test('splits an eave around an intersecting sibling roof segment', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_main' as never,
      roofType: 'gable',
      width: 8,
      depth: 6,
      overhang: 0.3,
    })
    const sibling = RoofSegmentNode.parse({
      id: 'rseg_cross' as never,
      roofType: 'gable',
      width: 6,
      depth: 4,
      overhang: 0.3,
      position: [0, 0, 3.26],
      rotation: Math.PI / 2,
    })

    const frontRuns = getGutterRunsForSegment(segment, [segment, sibling]).filter(
      (run) => run.side === '+Z',
    )

    // from the rake, the deck's edge past half the 0.1 m wall, to the cross gable's tucked eave
    const rake = 4 + 0.05 + 0.3 * Math.cos((40 * Math.PI) / 180) - 0.04
    expect(frontRuns).toHaveLength(2)
    expect(frontRuns[0]?.position[0]).toBeCloseTo(-(rake + 2.26) / 2)
    expect(frontRuns[1]?.position[0]).toBeCloseTo((rake + 2.26) / 2)
    expect(frontRuns[0]?.length).toBeCloseTo(rake - 2.26)
    expect(frontRuns[1]?.length).toBeCloseTo(rake - 2.26)
  })

  test('splits an eave around an attached roof-extension range', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'shed',
      width: 8,
      depth: 6,
      overhang: 0.3,
    })
    const fullRun = getGutterRunsForSegment(segment)[0]!
    const runs = getGutterRunsForSegment(segment, [], [{ side: '+Z', from: 0.25, to: 0.75 }])

    expect(runs).toHaveLength(2)
    expect(runs[0]?.length).toBeCloseTo(fullRun.length * 0.25)
    expect(runs[1]?.length).toBeCloseTo(fullRun.length * 0.25)
    expect(runs[0]?.position[0]).toBeLessThan(0)
    expect(runs[1]?.position[0]).toBeGreaterThan(0)
  })

  test('omits an eave fully occupied by an attached roof extension', () => {
    const segment = RoofSegmentNode.parse({ roofType: 'shed', width: 8, depth: 6 })

    expect(getGutterRunsForSegment(segment, [], [{ side: '+Z', from: 0, to: 1 }])).toHaveLength(0)
  })

  test('keeps flat gutters on the deck and sloped gutters at the live eave height', () => {
    expect(
      computeGutterEaveY({ roofType: 'flat', wallHeight: 0.6, overhang: 0.3, pitch: 40 }),
    ).toBeCloseTo(0.6)
    expect(
      computeGutterEaveY({ roofType: 'gable', wallHeight: 0.6, overhang: 0.3, pitch: 45 }),
    ).toBeCloseTo(0.34)
  })

  test('infers auto mode from generated children when explicit metadata is absent', () => {
    const segment = RoofSegmentNode.parse({ roofType: 'gable' })
    const gutters = createDefaultGuttersForSegment(segment)
    const nodes = Object.fromEntries(gutters.map((gutter) => [gutter.id, gutter]))

    expect(
      isAutoGutterEnabled(
        { id: segment.id, children: gutters.map((gutter) => gutter.id), metadata: {} },
        nodes,
      ),
    ).toBe(true)
  })
})
