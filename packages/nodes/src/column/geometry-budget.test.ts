import { expect, test } from 'bun:test'
import { ColumnNode } from '@pascal-app/core'
import { createColumnShaftGeometry, createColumnSpiralGeometry } from './geometry'

test('curved fluted shafts and dense spiral decorations stay within triangle budgets', () => {
  const node = ColumnNode.parse({
    shaftProfile: 'bulged',
    shaftBulge: 0.12,
    shaftSegmentCount: 32,
    shaftDetail: 'fluted',
    fluteCount: 16,
  })
  const shaft = createColumnShaftGeometry(node, 2)
  expect(shaft.index!.count / 3).toBeLessThan(10000)
  const spiral = createColumnSpiralGeometry(
    { ...node, shaftDetail: 'spiral', fluteCount: 0, spiralRibCount: 24, spiralTwist: 1 },
    2,
  )!
  expect((spiral.index?.count ?? spiral.getAttribute('position').count) / 3).toBeLessThan(19000)
  shaft.dispose()
  spiral.dispose()
})
