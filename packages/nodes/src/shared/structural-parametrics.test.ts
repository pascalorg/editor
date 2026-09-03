import { describe, expect, test } from 'bun:test'
import {
  ElevatorNode,
  RoofNode,
  RoofSegmentNode,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'
import { elevatorParametrics } from '../elevator/parametrics'
import { roofParametrics } from '../roof/parametrics'
import { roofSegmentParametrics } from '../roof-segment/parametrics'
import { stairParametrics } from '../stair/parametrics'
import { stairSegmentParametrics } from '../stair-segment/parametrics'

function visibleKeys<N>(
  node: N,
  groups: Array<{
    fields: Array<{ key: keyof N | string; visibleIf?: (value: N) => boolean }>
  }>,
) {
  return groups.flatMap((group) =>
    group.fields
      .filter((field) => field.visibleIf?.(node) ?? true)
      .map((field) => String(field.key)),
  )
}

describe('structural spatial settings', () => {
  test('exposes elevator controls and preserves door fit invariants', () => {
    const elevator = ElevatorNode.parse({ type: 'elevator' })

    expect(visibleKeys(elevator, elevatorParametrics.groups)).toContain('doorStyle')
    const derived = elevatorParametrics.derive?.({ ...elevator, width: 0.8 }, { width: 0.8 })
    expect(derived?.doorWidth).toBeCloseTo(0.7)
  })

  test('exposes the settings appropriate to each stair shape', () => {
    const straight = StairNode.parse({ type: 'stair' })
    const spiral = StairNode.parse({ type: 'stair', stairType: 'spiral' })

    expect(visibleKeys(straight, stairParametrics.groups)).not.toContain('innerRadius')
    expect(visibleKeys(spiral, stairParametrics.groups)).toEqual(
      expect.arrayContaining(['innerRadius', 'showCenterColumn', 'topLandingMode']),
    )
  })

  test('keeps stair-segment type changes internally consistent', () => {
    const flight = StairSegmentNode.parse({ type: 'stair-segment' })
    const landing = { ...flight, segmentType: 'landing' as const }

    expect(stairSegmentParametrics.derive?.(landing, { segmentType: 'landing' }, flight)).toEqual({
      height: 0,
      length: 1,
      stepCount: 0,
    })
  })

  test('exposes roof transforms and shape-specific segment controls', () => {
    const roof = RoofNode.parse({ type: 'roof' })
    const gable = RoofSegmentNode.parse({ type: 'roof-segment' })
    const dutch = RoofSegmentNode.parse({ type: 'roof-segment', roofType: 'dutch' })

    expect(visibleKeys(roof, roofParametrics.groups)).toEqual(['position', 'rotation'])
    expect(visibleKeys(gable, roofSegmentParametrics.groups)).not.toContain('dutchGabletRake')
    expect(visibleKeys(dutch, roofSegmentParametrics.groups)).toContain('dutchGabletRake')
  })
})
