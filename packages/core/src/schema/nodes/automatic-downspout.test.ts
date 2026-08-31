import { describe, expect, test } from 'bun:test'
import { planAutomaticDownspouts } from './automatic-downspout'
import { DownspoutNode } from './downspout'
import { GutterNode } from './gutter'
import { RoofSegmentNode } from './roof-segment'

const segment = RoofSegmentNode.parse({ id: 'rseg_test' as never })

function gutter(id: string, position: [number, number, number], rotation: number, length: number) {
  return GutterNode.parse({
    id: id as never,
    roofSegmentId: segment.id,
    position,
    rotation,
    length,
    metadata: { generatedBy: 'default-gutter', autoGutterSide: '+Z' },
  })
}

describe('planAutomaticDownspouts', () => {
  test('places one outlet near a free end of a short isolated gutter', () => {
    const run = gutter('gutter_short', [0, 0, 3], 0, 6)

    const placements = planAutomaticDownspouts({
      segments: [segment],
      gutters: [run],
      downspouts: [],
    })

    expect(placements).toHaveLength(1)
    expect(placements[0]?.gutterId).toBe(run.id)
    expect(Math.abs(placements[0]?.offset ?? 0)).toBeCloseTo(2.84)
  })

  test('places downspouts at both free ends when an isolated gutter is too long', () => {
    const run = gutter('gutter_long', [0, 0, 3], 0, 14)

    const placements = planAutomaticDownspouts({
      segments: [segment],
      gutters: [run],
      downspouts: [],
    })

    expect(placements).toHaveLength(2)
    expect(placements.map((placement) => placement.offset).sort((a, b) => a - b)).toEqual([
      -6.84, 6.84,
    ])
  })

  test('does not place a downspout on a gutter connected at both ends', () => {
    const left = gutter('gutter_left', [-4, 0, 3], 0, 4)
    const middle = gutter('gutter_middle', [0, 0, 3], 0, 4)
    const right = gutter('gutter_right', [4, 0, 3], 0, 4)

    const placements = planAutomaticDownspouts({
      segments: [segment],
      gutters: [left, middle, right],
      downspouts: [],
      maxRunPerDownspout: 20,
    })

    expect(placements).toHaveLength(1)
    expect(placements[0]?.gutterId).not.toBe(middle.id)
  })

  test('adds outlets to a closed loop even though it has no free ends', () => {
    const gutters = [
      gutter('gutter_front', [0, 0, 3], 0, 6),
      gutter('gutter_right', [3, 0, 0], Math.PI / 2, 6),
      gutter('gutter_back', [0, 0, -3], Math.PI, 6),
      gutter('gutter_left', [-3, 0, 0], -Math.PI / 2, 6),
    ]

    const placements = planAutomaticDownspouts({
      segments: [segment],
      gutters,
      downspouts: [],
    })

    expect(placements).toHaveLength(3)
    expect(new Set(placements.map((placement) => placement.gutterId)).size).toBe(3)
  })

  test('does not add an automatic downspout when a manual one already drains the component', () => {
    const run = GutterNode.parse({
      ...gutter('gutter_manual_drop', [0, 0, 3], 0, 6),
      outlets: [{ id: 'outlet_manual', offset: 2.5, diameter: 0.07 }],
    })
    const downspout = DownspoutNode.parse({
      id: 'downspout_manual' as never,
      gutterId: run.id,
      outletId: 'outlet_manual',
    })

    expect(
      planAutomaticDownspouts({
        segments: [segment],
        gutters: [run],
        downspouts: [downspout],
      }),
    ).toEqual([])
  })
})
