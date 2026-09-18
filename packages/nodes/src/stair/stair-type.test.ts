import { describe, expect, it } from 'bun:test'
import { type AnyNode, LevelNode, StairNode, StairSegmentNode } from '@pascal-app/core'
import { getStairTypeChange } from './stair-type'

const LEVEL_ID = 'level_5o2tes0jyuiupp2f'
const STAIR_ID = 'stair_7yfdirs1t2iqslvi'

function buildScene(overrides: Record<string, unknown> = {}, segmentHeights: number[] = []) {
  const segments = segmentHeights.map((height, index) =>
    StairSegmentNode.parse({
      id: `sseg_${index}`,
      type: 'stair-segment',
      segmentType: 'stair',
      height,
      parentId: STAIR_ID,
    }),
  )
  const stair = StairNode.parse({
    id: STAIR_ID,
    type: 'stair',
    parentId: LEVEL_ID,
    position: [9.5, 0, -3.5],
    stairType: 'curved',
    width: 0.9,
    stepCount: 16,
    thickness: 0.16,
    fillToFloor: false,
    totalRise: 3.81,
    children: segments.map((segment) => segment.id),
    ...overrides,
  })
  const level = LevelNode.parse({
    id: LEVEL_ID,
    type: 'level',
    level: 0,
    height: 3.5,
    children: [STAIR_ID],
  })
  const nodes: Record<string, AnyNode> = { [level.id]: level, [stair.id]: stair }
  for (const segment of segments) nodes[segment.id] = segment
  return { nodes, stair }
}

describe('getStairTypeChange', () => {
  it('materializes a flight when a segment-less stair becomes straight', () => {
    const { nodes, stair } = buildScene()
    const change = getStairTypeChange(stair, 'straight', nodes)

    expect(change.updates.stairType).toBe('straight')
    expect(change.segment?.type).toBe('stair-segment')
    expect(change.segment?.segmentType).toBe('stair')
    expect(change.segment?.width).toBe(0.9)
    expect(change.segment?.stepCount).toBe(16)
    expect(change.segment?.thickness).toBe(0.16)
    expect(change.segment?.fillToFloor).toBe(false)
    // Rise from the stair, run from the `StairSegmentNode` schema default.
    expect(change.segment?.height).toBe(3.81)
    expect(change.segment?.length).toBe(3)
  })

  it('follows the storey height when the stair has no explicit rise', () => {
    const { nodes, stair } = buildScene({ totalRise: undefined })
    const change = getStairTypeChange(stair, 'straight', nodes)

    expect(change.segment?.height).toBe(3.5)
  })

  it('leaves an existing flight alone', () => {
    const { nodes, stair } = buildScene({ stairType: 'curved' }, [2.5])
    const change = getStairTypeChange(stair, 'straight', nodes)

    expect(change.updates.stairType).toBe('straight')
    expect(change.segment).toBeNull()
  })

  it('keeps the segments when a straight stair becomes curved', () => {
    const { nodes, stair } = buildScene({ stairType: 'straight' }, [2.5])
    const change = getStairTypeChange(stair, 'curved', nodes)

    expect(change.updates).toEqual({ stairType: 'curved' })
    expect(change.segment).toBeNull()
    expect(nodes[STAIR_ID]).toBe(stair)
  })

  it('seeds the sweep and drops the Y offset when switching to spiral', () => {
    const { nodes, stair } = buildScene()
    const change = getStairTypeChange(stair, 'spiral', nodes)

    expect(change.updates.stairType).toBe('spiral')
    expect(change.updates.sweepAngle).toBeCloseTo((400 * Math.PI) / 180, 10)
    expect(change.updates.position).toEqual([9.5, 0, -3.5])
    expect(change.segment).toBeNull()
  })
})
