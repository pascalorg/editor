import { describe, expect, test } from 'bun:test'
import {
  projectFloorplanCursorPoint,
  resolveFloorplanCursorIndicatorPosition,
} from './floorplan-cursor-indicator-position'

describe('projectFloorplanCursorPoint', () => {
  test('projects a snapped plan point into overlay-local screen coordinates', () => {
    expect(
      projectFloorplanCursorPoint(
        [3, 4],
        {
          a: 0,
          b: 10,
          c: -10,
          d: 0,
          e: 128,
          f: 40,
        },
        { x: 30, y: 20 },
      ),
    ).toEqual({ x: 58, y: 50 })
  })

  test('anchors the placement pin to the projected snap point instead of the raw pointer', () => {
    expect(resolveFloorplanCursorIndicatorPosition({ x: 88, y: 97 }, { x: 58, y: 70 })).toEqual({
      x: 58,
      y: 70,
    })
  })
})
