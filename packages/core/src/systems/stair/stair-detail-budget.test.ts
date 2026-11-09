import { expect, it } from 'bun:test'
import {
  measureStair,
  measureStairDetail,
  resolveArcStairConstruction,
  resolveStairArcLayout,
  StairNode,
  StairSegmentNode,
} from '../../index'

it('preserves authored counts while refusing unbounded stair detail before allocation', () => {
  const stair = StairNode.parse({
    stairType: 'spiral',
    stepCount: 4294967296,
    totalRise: 3,
    construction: { mode: 'side-stringers' },
  })
  const before = JSON.stringify(stair)
  expect(() => resolveStairArcLayout(stair, 3)).toThrow('computation budget')
  expect(() => resolveArcStairConstruction(stair, 3)).toThrow('computation budget')
  expect(measureStair(stair, { [stair.id]: stair }).detail.status).toBe('unresolved')
  expect(JSON.stringify(stair)).toBe(before)
  const segment = StairSegmentNode.parse({ length: 1e9 })
  const guarded = StairNode.parse({ children: [segment.id], railingMode: 'both' })
  expect(measureStairDetail(guarded, [segment]).error).toContain('computation budget')
  expect(segment.length).toBe(1e9)
})
