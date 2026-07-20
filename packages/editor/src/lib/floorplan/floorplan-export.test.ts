import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { filterFloorplanExportOverlay, fitPlanToBox } from './floorplan-export'

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
