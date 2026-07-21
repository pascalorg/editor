import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import {
  filterFloorplanExportOverlay,
  fitPlanToBox,
  placePlanAtDrawingScale,
  pointsPerMeterForDrawingScale,
} from './floorplan-export'

describe('filterFloorplanExportOverlay', () => {
  test('preserves value labels and removes editing handles', () => {
    const label = {
      kind: 'dimension-label',
      appearance: 'outlined',
      cx: 1,
      cy: 0,
      text: '2.00m',
      angle: 0,
    } satisfies FloorplanGeometry
    const overlay = {
      kind: 'group',
      children: [
        label,
        {
          kind: 'endpoint-handle',
          point: [0, 0],
          state: 'idle',
          affordance: 'move-measurement-vertex',
          payload: { vertexIndex: 0 },
        },
      ],
    } satisfies FloorplanGeometry

    expect(filterFloorplanExportOverlay(overlay)).toEqual({
      kind: 'group',
      children: [label],
    })
  })
})

describe('fitPlanToBox', () => {
  test('preserves aspect ratio and centers the plan', () => {
    expect(fitPlanToBox(20, 10, 10, 20, 400, 300)).toEqual({
      x: 10,
      y: 70,
      width: 400,
      height: 200,
    })
  })
})

describe('pointsPerMeterForDrawingScale', () => {
  test('converts metric ratios to plotted points per metre', () => {
    expect(pointsPerMeterForDrawingScale('1:50')).toBeCloseTo(56.6929, 4)
  })

  test('converts imperial architectural scales to plotted points per metre', () => {
    expect(pointsPerMeterForDrawingScale('1/4"=1\'-0"')).toBeCloseTo(59.0551, 4)
  })
})

describe('placePlanAtDrawingScale', () => {
  test('centers the plan at the selected fixed scale', () => {
    expect(placePlanAtDrawingScale(10, 5, 10, 20, 800, 600, '1:100')).toEqual({
      x: 268.26771653543307,
      y: 249.13385826771653,
      width: 283.46456692913387,
      height: 141.73228346456693,
      clipped: false,
    })
  })

  test('keeps fixed scale when content is larger than the page box', () => {
    const placed = placePlanAtDrawingScale(30, 20, 10, 20, 400, 300, '1/4"=1\'-0"')

    expect(placed.width).toBeCloseTo(1771.65, 2)
    expect(placed.height).toBeCloseTo(1181.1, 2)
    expect(placed.clipped).toBe(true)
  })
})
