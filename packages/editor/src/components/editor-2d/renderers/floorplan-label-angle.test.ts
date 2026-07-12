import { describe, expect, test } from 'bun:test'
import { resolveFloorplanLabelAngle } from './floorplan-label-angle'

describe('resolveFloorplanLabelAngle', () => {
  test('keeps segment labels readable while preserving their screen direction', () => {
    expect(resolveFloorplanLabelAngle(0, 0)).toBe(0)
    expect(resolveFloorplanLabelAngle(Math.PI, 0)).toBe(0)
    expect(resolveFloorplanLabelAngle(Math.PI / 2, 90)).toBe(-90)
  })

  test('counter-rotates aggregate labels to remain horizontal', () => {
    expect(resolveFloorplanLabelAngle(0, 90, true)).toBe(-90)
    expect(resolveFloorplanLabelAngle(Math.PI / 3, -35, true)).toBe(35)
  })
})
