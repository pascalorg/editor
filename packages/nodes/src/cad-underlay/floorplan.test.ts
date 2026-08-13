import { beforeEach, describe, expect, test } from 'bun:test'
import { CadUnderlayNode, type GeometryContext } from '@pascal-app/core'
import {
  CAD_UNDERLAY_DEFAULT_COLOR,
  primeCadUnderlay,
  releaseCadUnderlay,
} from '@pascal-app/editor'
import { buildCadUnderlayFloorplan } from './floorplan'

const URL = 'asset://drawing'

const context = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: null,
} satisfies GeometryContext

/**
 * A two-layer drawing: one horizontal segment on DUVAR, one vertical on
 * MOBILYA. Coordinates are drawing units (millimetres), matching what the
 * underlay buffer holds.
 */
function drawing() {
  return {
    layers: [
      { name: 'DUVAR', colorIndex: 7, visible: true },
      { name: 'MOBILYA', colorIndex: 3, visible: true },
    ],
    segments: new Float32Array([0, 0, 1000, 0, 0, 0, 0, 500]),
    segmentLayers: new Uint16Array([0, 1]),
    origin: [0, 0] as const,
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 500 },
    contentBounds: { minX: 0, minY: 0, maxX: 1000, maxY: 500 },
    metersPerUnit: 0.001,
    stats: {
      entityCounts: { LINE: 2 },
      segmentCount: 2,
      skippedTypes: {},
      droppedNestedInserts: 0,
    },
  }
}

function node(overrides: Record<string, unknown> = {}) {
  return CadUnderlayNode.parse({ id: 'cad-underlay_test', url: URL, ...overrides })
}

beforeEach(() => {
  releaseCadUnderlay(URL)
})

describe('buildCadUnderlayFloorplan', () => {
  test('emits nothing until the asset has loaded', () => {
    // This also kicks off a cache warm, which fails under bun (no indexedDB)
    // and logs "Failed to load asset". That console noise is the assertion
    // working, not a broken test.
    expect(buildCadUnderlayFloorplan(node(), context)).toBeNull()
  })

  test('emits one path per visible layer, not one per segment', () => {
    primeCadUnderlay(URL, drawing())
    const geometry = buildCadUnderlayFloorplan(node(), context)

    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return

    expect(geometry.children).toHaveLength(2)
    expect(geometry.children[0]).toMatchObject({
      kind: 'path',
      d: 'M0 0L1000 0',
      stroke: CAD_UNDERLAY_DEFAULT_COLOR,
      fill: 'none',
    })
  })

  test('never catches the pointer, so tracing selects what is underneath', () => {
    primeCadUnderlay(URL, drawing())
    const geometry = buildCadUnderlayFloorplan(node(), context)

    if (geometry?.kind !== 'group') throw new Error('expected a group')
    for (const child of geometry.children) {
      expect(child).toMatchObject({ pointerEvents: 'none' })
    }
  })

  test('converts drawing units to plan metres through the group transform', () => {
    primeCadUnderlay(URL, drawing())
    const geometry = buildCadUnderlayFloorplan(
      node({ scale: 0.001, position: [4, 0, -2], rotation: [0, Math.PI / 2, 0] }),
      context,
    )

    if (geometry?.kind !== 'group') throw new Error('expected a group')
    expect(geometry.transform).toEqual({
      translate: [4, -2],
      // Negated: a Three.js Y-rotation and an SVG `rotate()` turn opposite
      // ways, so the same stored value has to be flipped to look the same in
      // both views. Every other rotatable kind's plan builder does this.
      rotate: -Math.PI / 2,
      scale: 0.001,
    })
  })

  test('turns the same way as the 3D renderer', () => {
    primeCadUnderlay(URL, drawing())
    // The 3D renderer applies `rotation[1]` about +Y, which reads as
    // anticlockwise from above; SVG's rotate() is clockwise on screen. The
    // plan transform must therefore carry the opposite sign, or a rotated
    // drawing lands mirrored between the two viewports.
    const quarterTurn = buildCadUnderlayFloorplan(node({ rotation: [0, Math.PI / 2, 0] }), context)
    if (quarterTurn?.kind !== 'group') throw new Error('expected a group')
    expect(quarterTurn.transform?.rotate).toBeCloseTo(-Math.PI / 2, 9)

    const unrotated = buildCadUnderlayFloorplan(node({ rotation: [0, 0, 0] }), context)
    if (unrotated?.kind !== 'group') throw new Error('expected a group')
    expect(unrotated.transform?.rotate).toBe(0)
  })

  test('keeps a constant hairline instead of scaling the stroke with the drawing', () => {
    primeCadUnderlay(URL, drawing())
    const geometry = buildCadUnderlayFloorplan(node({ scale: 0.001 }), context)

    if (geometry?.kind !== 'group') throw new Error('expected a group')
    // Without this the group's 0.001 scale would render the stroke 1000×
    // thinner than intended — i.e. invisible.
    expect(geometry.children[0]).toMatchObject({ vectorEffect: 'non-scaling-stroke' })
  })

  test('drops a layer the user hid', () => {
    primeCadUnderlay(URL, drawing())
    const geometry = buildCadUnderlayFloorplan(
      node({ layers: { MOBILYA: { visible: false } } }),
      context,
    )

    if (geometry?.kind !== 'group') throw new Error('expected a group')
    expect(geometry.children).toHaveLength(1)
  })

  test('emits nothing when every layer is hidden', () => {
    primeCadUnderlay(URL, drawing())
    expect(
      buildCadUnderlayFloorplan(
        node({ layers: { DUVAR: { visible: false }, MOBILYA: { visible: false } } }),
        context,
      ),
    ).toBeNull()
  })

  test('respects the node visibility flag', () => {
    primeCadUnderlay(URL, drawing())
    expect(buildCadUnderlayFloorplan(node({ visible: false }), context)).toBeNull()
  })

  test('carries opacity onto the stroke', () => {
    primeCadUnderlay(URL, drawing())
    const geometry = buildCadUnderlayFloorplan(node({ opacity: 40 }), context)

    if (geometry?.kind !== 'group') throw new Error('expected a group')
    expect(geometry.children[0]).toMatchObject({ strokeOpacity: 0.4 })
  })
})
