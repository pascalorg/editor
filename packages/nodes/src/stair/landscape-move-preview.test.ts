import { afterEach, expect, test } from 'bun:test'
import { getEffectiveNode, StairNode, StairSegmentNode, useLiveNodeOverrides } from '@pascal-app/core'
import { clearStairMovePreview, publishStairMovePreview } from './landscape-move-preview'

const flight = StairSegmentNode.parse({ id: 'sseg_preview', height: 0.35,
  length: 0.84, stepCount: 2 })
const stair = StairNode.parse({ id: 'stair_preview', children: [flight.id],
  position: [0, 0, -2.34], totalRise: 0.35, stepCount: 2, railingMode: 'both' })

afterEach(() => useLiveNodeOverrides.getState().clearAll())

test('the visible stair model receives live pose and flight geometry during a snap', () => {
  const position: [number, number, number] = [1, 0, -3]
  publishStairMovePreview(stair.id, flight.id, position, Math.PI / 2, {
    position, rotation: Math.PI / 2, totalRise: 1.2, stepCount: 8,
    length: 2.24, surfaceId: 'deck_1',
  })

  const visibleStair = getEffectiveNode(stair)
  const visibleFlight = getEffectiveNode(flight)
  expect(visibleStair.position).toEqual(position)
  expect(visibleStair.rotation).toBeCloseTo(Math.PI / 2)
  expect(visibleStair.totalRise).toBe(1.2)
  expect(visibleStair.railingMode).toBe('none')
  expect(visibleStair.landscapeSurfaceId).toBe('deck_1')
  expect(visibleFlight.height).toBe(1.2)
  expect(visibleFlight.length).toBe(2.24)
  expect(visibleFlight.stepCount).toBe(8)

  publishStairMovePreview(stair.id, flight.id, [4, 0, -3], 0, null)
  expect(getEffectiveNode(stair).position).toEqual([4, 0, -3])
  expect(getEffectiveNode(stair).railingMode).toBe('both')
  expect(getEffectiveNode(stair).landscapeSurfaceId).toBeUndefined()
  expect(getEffectiveNode(flight).height).toBe(0.35)
  clearStairMovePreview(stair.id, flight.id)
  expect(getEffectiveNode(stair).position).toEqual(stair.position)
})
