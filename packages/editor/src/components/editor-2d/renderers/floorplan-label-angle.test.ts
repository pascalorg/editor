import { describe, expect, test } from 'bun:test'
import {
  resolveFloorplanAnnotationLabelTransform,
  resolveFloorplanLabelAngle,
  shouldUpdateFloorplanLabelRotation,
} from './floorplan-label-angle'

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

  test('ignores sub-degree rotation changes for annotation layout', () => {
    expect(shouldUpdateFloorplanLabelRotation(30, 30.9)).toBe(false)
    expect(shouldUpdateFloorplanLabelRotation(30, 31)).toBe(true)
    expect(shouldUpdateFloorplanLabelRotation(359.5, 0.25)).toBe(false)
  })

  test('updates only label orientation while preserving its layout shift', () => {
    expect(
      resolveFloorplanAnnotationLabelTransform({
        afterRotation: 'translate(0 -0.2)',
        angleRadians: 0,
        beforeRotation: 'translate(4 6)',
        layoutDx: 0.5,
        layoutDy: -0.25,
        sceneRotationDeg: 90,
        screenUpright: true,
      }),
    ).toEqual({
      defaultTransform: 'translate(4 6) rotate(-90) translate(0 -0.2)',
      transform: 'translate(4 6) rotate(-90) translate(0 -0.2) translate(0.5 -0.25)',
    })
  })
})
