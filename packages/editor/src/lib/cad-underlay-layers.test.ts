import { describe, expect, test } from 'bun:test'
import { CadUnderlayNode } from '@pascal-app/core'
import type { LoadedCadUnderlay } from './cad-underlay-cache'
import {
  CAD_UNDERLAY_DEFAULT_COLOR,
  cadUnderlayOpacity,
  resolveCadLayers,
} from './cad-underlay-layers'

function underlay(
  layers: { name: string; visible: boolean }[],
  counts: number[],
): LoadedCadUnderlay {
  return {
    underlay: {
      layers: layers.map((l) => ({ ...l, colorIndex: 7 })),
      segments: new Float32Array(),
      segmentLayers: new Uint16Array(),
      origin: [0, 0],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      contentBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      metersPerUnit: 0.001,
      stats: {
        entityCounts: {},
        segmentCount: 0,
        skippedTypes: {},
        droppedNestedInserts: 0,
      },
    },
    pathByLayer: layers.map(() => ''),
    positionsByLayer: layers.map(() => new Float32Array()),
    countByLayer: counts,
  }
}

function node(overrides: Partial<CadUnderlayNode> = {}) {
  return CadUnderlayNode.parse({
    id: 'cad-underlay_test',
    url: 'asset://drawing',
    ...overrides,
  })
}

describe('resolveCadLayers', () => {
  test("follows the drawing's own off state by default", () => {
    const resolved = resolveCadLayers(
      node(),
      underlay(
        [
          { name: 'DUVAR', visible: true },
          { name: 'DEFPOINTS', visible: false },
        ],
        [10, 4],
      ),
    )

    expect(resolved.map((l) => l.name)).toEqual(['DUVAR'])
  })

  test('lets the user turn a layer the file froze back on', () => {
    const resolved = resolveCadLayers(
      node({ layers: { DEFPOINTS: { visible: true } } }),
      underlay(
        [
          { name: 'DUVAR', visible: true },
          { name: 'DEFPOINTS', visible: false },
        ],
        [10, 4],
      ),
    )

    expect(resolved.map((l) => l.name)).toEqual(['DUVAR', 'DEFPOINTS'])
  })

  test('lets the user hide a layer the file had on', () => {
    const resolved = resolveCadLayers(
      node({ layers: { MOBILYA: { visible: false } } }),
      underlay(
        [
          { name: 'DUVAR', visible: true },
          { name: 'MOBILYA', visible: true },
        ],
        [10, 4],
      ),
    )

    expect(resolved.map((l) => l.name)).toEqual(['DUVAR'])
  })

  test('skips layers that carry no geometry', () => {
    const resolved = resolveCadLayers(
      node(),
      underlay(
        [
          { name: 'DUVAR', visible: true },
          { name: 'EMPTY', visible: true },
        ],
        [10, 0],
      ),
    )

    expect(resolved.map((l) => l.name)).toEqual(['DUVAR'])
  })

  test('falls back to the muted underlay colour, honouring an override', () => {
    const resolved = resolveCadLayers(
      node({ layers: { KAPI: { visible: true, color: '#ff0000' } } }),
      underlay(
        [
          { name: 'DUVAR', visible: true },
          { name: 'KAPI', visible: true },
        ],
        [10, 4],
      ),
    )

    expect(resolved[0]?.color).toBe(CAD_UNDERLAY_DEFAULT_COLOR)
    expect(resolved[1]?.color).toBe('#ff0000')
  })

  test('reports the layer index the geometry buffers are keyed by', () => {
    const resolved = resolveCadLayers(
      node(),
      underlay(
        [
          { name: 'HIDDEN', visible: false },
          { name: 'DUVAR', visible: true },
        ],
        [4, 10],
      ),
    )

    expect(resolved[0]).toMatchObject({ index: 1, name: 'DUVAR' })
  })
})

describe('cadUnderlayOpacity', () => {
  test('maps the 0-100 node field onto the 0-1 fraction both views want', () => {
    expect(cadUnderlayOpacity(node({ opacity: 60 }))).toBeCloseTo(0.6)
    expect(cadUnderlayOpacity(node({ opacity: 0 }))).toBe(0)
    expect(cadUnderlayOpacity(node({ opacity: 100 }))).toBe(1)
  })
})
