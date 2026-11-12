import { describe, expect, test } from 'bun:test'
import {
  resolveFloorplanAnnotationLabelTransform,
  resolveFloorplanAnnotationUpdate,
  resolveFloorplanLabelAngle,
  shouldUpdateFloorplanLabelRotation,
  updateSvgFloorplanLabelOrientations,
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

  test('keeps a rotation-only update out of the full collision layout path', () => {
    expect(
      resolveFloorplanAnnotationUpdate({
        layoutInputsChanged: false,
        nextRotationDeg: 45,
        previousRotationDeg: 30,
      }),
    ).toEqual({
      resolveCollisions: false,
      updateLabelPresentation: true,
    })
  })

  test('runs collision layout when floor-plan scene inputs change', () => {
    expect(
      resolveFloorplanAnnotationUpdate({
        layoutInputsChanged: true,
        nextRotationDeg: 30,
        previousRotationDeg: 30,
      }),
    ).toEqual({
      resolveCollisions: true,
      updateLabelPresentation: true,
    })
  })

  test('updates captured label references without rediscovering the DOM', () => {
    const attributes = new Map<string, string>([['transform', 'translate(4 6) rotate(0)']])
    const label = {
      dataset: {
        floorplanAnnotationAngleRadians: '0',
        floorplanAnnotationLayoutDx: '0.5',
        floorplanAnnotationLayoutDy: '-0.25',
        floorplanAnnotationScreenUpright: 'true',
        floorplanAnnotationTransformAfterRotation: '',
        floorplanAnnotationTransformBeforeRotation: 'translate(4 6)',
      },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    } as unknown as SVGGElement

    expect(updateSvgFloorplanLabelOrientations([label], 90)).toBe(1)
    expect(attributes.get('transform')).toBe('translate(4 6) rotate(-90) translate(0.5 -0.25)')
  })
})
