import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import {
  clientToFloorplanPoint,
  getFloorplanBounds,
  padFloorplanBounds,
  panFloorplanViewBox,
  scaleFloorplanViewBox,
  scaleFloorplanViewBoxBetweenClients,
} from './floorplan-preview-geometry'

describe('floorplan preview bounds', () => {
  test('composes nested translation and rotation', () => {
    const geometry: FloorplanGeometry = {
      kind: 'group',
      transform: { translate: [10, 5], rotate: Math.PI / 2 },
      children: [
        {
          kind: 'rect',
          x: 0,
          y: 0,
          width: 4,
          height: 2,
        },
      ],
    }

    expect(getFloorplanBounds([geometry])).toEqual({
      minX: 8,
      minY: 5,
      maxX: 10,
      maxY: 9,
    })
  })

  test('includes image rotation and dimension baselines', () => {
    const geometries: FloorplanGeometry[] = [
      {
        kind: 'image',
        url: '/symbol.png',
        center: [2, 3],
        width: 4,
        height: 2,
        rotation: Math.PI / 2,
      },
      {
        kind: 'dimension',
        start: [-3, -2],
        end: [3, -2],
        dimensionStart: [-4, -1],
        dimensionEnd: [4, -1],
        offsetNormal: [0, -1],
        offsetDistance: 1,
        extensionOvershoot: 0.2,
        text: '8 m',
      },
    ]

    expect(getFloorplanBounds(geometries)).toEqual({
      minX: -4,
      minY: -2,
      maxX: 4,
      maxY: 5,
    })
  })

  test('pads narrow plans by a usable minimum', () => {
    expect(padFloorplanBounds({ minX: 0, minY: 0, maxX: 0, maxY: 0 })).toEqual({
      minX: -0.75,
      minY: -0.75,
      maxX: 0.75,
      maxY: 0.75,
    })
  })

  test('maps clients through letterboxed SVG content', () => {
    const viewBox = { x: 0, y: 0, width: 10, height: 10 }
    const viewport = { left: 0, top: 0, width: 1000, height: 500 }

    expect(clientToFloorplanPoint(viewBox, viewport, 250, 0)).toEqual([0, 0])
    expect(clientToFloorplanPoint(viewBox, viewport, 750, 500)).toEqual([10, 10])
    expect(panFloorplanViewBox(viewBox, viewport, [500, 250], [550, 250])).toEqual({
      x: -1,
      y: 0,
      width: 10,
      height: 10,
    })
  })

  test('keeps the plan point beneath a moving pinch midpoint', () => {
    const viewBox = { x: 0, y: 0, width: 10, height: 10 }
    const viewport = { left: 0, top: 0, width: 1000, height: 500 }
    const next = scaleFloorplanViewBoxBetweenClients(viewBox, 0.5, viewport, [500, 250], [600, 250])

    expect(next).toEqual({ x: 1.5, y: 2.5, width: 5, height: 5 })
    expect(clientToFloorplanPoint(next, viewport, 600, 250)).toEqual([5, 5])
  })

  test('clamps zoom without changing the view box aspect ratio', () => {
    expect(scaleFloorplanViewBox({ x: 0, y: 0, width: 100, height: 1 }, 0.01)).toEqual({
      x: 37.5,
      y: 0.375,
      width: 25,
      height: 0.25,
    })
  })
})
