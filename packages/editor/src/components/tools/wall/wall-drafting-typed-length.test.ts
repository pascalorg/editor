import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, type WallNode, WallNode as WallSchema } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useMeasurementInput from '../../../store/use-measurement-input'
import { snapWallDraftPointDetailed } from './wall-drafting'
import type { WallPlanPoint } from './wall-snap-geometry'

// A typed dimension has to beat every magnetic target, in both drafting views.
// These pin the "cursor owns direction, typed value owns distance" contract at
// the shared choke point both the 2D and 3D paths call.

const LEVEL_ID = 'level_test' as AnyNodeId

function makeWall(start: WallPlanPoint, end: WallPlanPoint, id: string): WallNode {
  return {
    ...WallSchema.parse({ start, end, name: id }),
    id: id as WallNode['id'],
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

describe('typed length in wall drafting', () => {
  test('places the point at exactly the typed distance', () => {
    type('4.2')
    const result = snapWallDraftPointDetailed({
      point: [10, 0],
      walls: [],
      start: [0, 0],
    })
    expect(result.point[0]).toBeCloseTo(4.2, 6)
    expect(result.point[1]).toBeCloseTo(0, 6)
  })

  test('keeps the cursor direction, replacing only the distance', () => {
    type('10')
    const result = snapWallDraftPointDetailed({
      point: [3, 4], // 5 units out on a 3-4-5 triangle
      walls: [],
      start: [0, 0],
    })
    expect(result.point[0]).toBeCloseTo(6, 6)
    expect(result.point[1]).toBeCloseTo(8, 6)
  })

  test('outranks a magnetic corner that would otherwise capture the point', () => {
    // A wall endpoint sits at 4.19 m — well inside the magnetic radius of the
    // 4.2 m the user typed. Being pulled onto it is exactly what typing prevents.
    const wall = makeWall([4.19, 0], [4.19, 3], 'wall_near')
    type('4.2')
    const result = snapWallDraftPointDetailed({
      point: [4.18, 0],
      walls: [wall],
      start: [0, 0],
      magnetic: true,
    })
    expect(result.point[0]).toBeCloseTo(4.2, 6)
    expect(result.snap).toBeNull()
  })

  test('reads a bare number in the viewer display unit', () => {
    useViewer.setState({ unit: 'metric', metricNotation: 'millimeters' })
    type('4200')
    const result = snapWallDraftPointDetailed({
      point: [10, 0],
      walls: [],
      start: [0, 0],
    })
    expect(result.point[0]).toBeCloseTo(4.2, 6)
  })

  test('an explicit unit wins over the display unit', () => {
    type('180cm')
    const result = snapWallDraftPointDetailed({
      point: [10, 0],
      walls: [],
      start: [0, 0],
    })
    expect(result.point[0]).toBeCloseTo(1.8, 6)
  })

  test('an empty buffer leaves the point to ordinary snapping', () => {
    const result = snapWallDraftPointDetailed({
      point: [4.13, 0],
      walls: [],
      start: [0, 0],
      magnetic: false,
    })
    // Nothing typed, so the distance is never rewritten — the point is whatever
    // the snapping mode made of the cursor, not a forced length.
    expect(Math.hypot(result.point[0], result.point[1])).toBeCloseTo(4.13, 6)
  })

  test('a half-typed number tracks live rather than waiting for Enter', () => {
    // The parser is forgiving on purpose: the draft follows the value as it is
    // typed, so `4.` previews 4 m and the next keystroke refines it.
    type('4.')
    const atFour = snapWallDraftPointDetailed({
      point: [10, 0],
      walls: [],
      start: [0, 0],
      magnetic: false,
    })
    expect(atFour.point[0]).toBeCloseTo(4, 6)

    type('4.2')
    const atFourTwo = snapWallDraftPointDetailed({
      point: [10, 0],
      walls: [],
      start: [0, 0],
      magnetic: false,
    })
    expect(atFourTwo.point[0]).toBeCloseTo(4.2, 6)
  })

  test('text carrying no quantity keeps the cursor driving', () => {
    type('4q?')
    const result = snapWallDraftPointDetailed({
      point: [10, 0],
      walls: [],
      start: [0, 0],
      magnetic: false,
    })
    expect(result.point[0]).toBeCloseTo(10, 6)
  })

  test('does nothing on the first point, where there is no length yet', () => {
    type('4.2')
    const result = snapWallDraftPointDetailed({
      point: [10, 0],
      walls: [],
      magnetic: false,
    })
    expect(result.point[0]).toBeCloseTo(10, 6)
  })

  test('bypassSnap still wins, so force-place stays raw', () => {
    type('4.2')
    const result = snapWallDraftPointDetailed({
      point: [9.37, 1.13],
      walls: [],
      start: [0, 0],
      bypassSnap: true,
    })
    expect(result.point[0]).toBeCloseTo(9.37, 6)
    expect(result.point[1]).toBeCloseTo(1.13, 6)
  })
})
