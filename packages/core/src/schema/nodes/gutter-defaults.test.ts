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

    expect(frontRuns).toHaveLength(2)
    expect(frontRuns[0]?.position[0]).toBeCloseTo(-3.26)
    expect(frontRuns[1]?.position[0]).toBeCloseTo(3.26)
    expect(frontRuns[0]?.length).toBeCloseTo(2)
    expect(frontRuns[1]?.length).toBeCloseTo(2)
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
