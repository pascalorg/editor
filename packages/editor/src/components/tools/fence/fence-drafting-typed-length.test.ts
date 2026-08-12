import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, type FenceNode, FenceNode as FenceSchema } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useMeasurementInput from '../../../store/use-measurement-input'
import type { FencePlanPoint } from './fence-drafting'
import { snapFenceDraftPoint } from './fence-drafting'

// Fence drafting shares the wall tool's typed-dimension contract through
// `resolveTypedLengthPoint`. These pin the shared behaviour on this side so the
// two kinds cannot drift apart.

const LEVEL_ID = 'level_test' as AnyNodeId

function makeFence(start: FencePlanPoint, end: FencePlanPoint, id: string): FenceNode {
  return {
    ...FenceSchema.parse({ start, end, name: id }),
    id: id as FenceNode['id'],
    parentId: LEVEL_ID,
  }
}

function type(text: string) {
  useMeasurementInput.setState({ buffer: text, field: 'length' })
}

afterEach(() => {
  useMeasurementInput.setState({ buffer: '', field: 'length' })
  useViewer.setState({ unit: 'metric', metricNotation: 'meters' })
})

describe('typed length in fence drafting', () => {
  test('places the point at exactly the typed distance', () => {
    type('4.2')
    const point = snapFenceDraftPoint({
      point: [10, 0],
      walls: [],
      fences: [],
      start: [0, 0],
    })
    expect(point[0]).toBeCloseTo(4.2, 6)
    expect(point[1]).toBeCloseTo(0, 6)
  })

  test('keeps the cursor direction, replacing only the distance', () => {
    type('10')
    const point = snapFenceDraftPoint({
      point: [3, 4],
      walls: [],
      fences: [],
      start: [0, 0],
    })
    expect(point[0]).toBeCloseTo(6, 6)
    expect(point[1]).toBeCloseTo(8, 6)
  })

  test('outranks a magnetic fence endpoint that would otherwise capture it', () => {
    const fence = makeFence([4.19, 0], [4.19, 3], 'fence_near')
    type('4.2')
    const point = snapFenceDraftPoint({
      point: [4.18, 0],
      walls: [],
      fences: [fence],
      start: [0, 0],
      magnetic: true,
    })
    expect(point[0]).toBeCloseTo(4.2, 6)
  })

  test('reads a bare number in the viewer display unit', () => {
    useViewer.setState({ unit: 'metric', metricNotation: 'millimeters' })
    type('4200')
    const point = snapFenceDraftPoint({
      point: [10, 0],
      walls: [],
      fences: [],
      start: [0, 0],
    })
    expect(point[0]).toBeCloseTo(4.2, 6)
  })

  test('does nothing on the first point, where there is no length yet', () => {
    type('4.2')
    const point = snapFenceDraftPoint({
      point: [10, 0],
      walls: [],
      fences: [],
      magnetic: false,
    })
    expect(point[0]).toBeCloseTo(10, 6)
  })

  test('bypassSnap still wins, so force-place stays raw', () => {
    type('4.2')
    const point = snapFenceDraftPoint({
      point: [9.37, 1.13],
      walls: [],
      fences: [],
      start: [0, 0],
      bypassSnap: true,
    })
    expect(point[0]).toBeCloseTo(9.37, 6)
    expect(point[1]).toBeCloseTo(1.13, 6)
  })
})
