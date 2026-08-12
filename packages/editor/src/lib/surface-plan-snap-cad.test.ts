import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, CadUnderlayNode, LevelNode, useScene } from '@pascal-app/core'
import useEditor from '../store/use-editor'
import useWallSnapIndicator from '../store/use-wall-snap-indicator'
import { releaseCadSnapIndex } from './cad-snap-source'
import { primeCadUnderlay, releaseCadUnderlay } from './cad-underlay-cache'
import { resolveSurfacePlanPointSnap } from './surface-plan-snap'

/**
 * `resolveSurfacePlanPointSnap` is the shared choke point for every kind that
 * draws or reshapes a plan polygon — slab, ceiling, zone, roof — plus the
 * measurement, structural-grid and construction-dimension tools. One test file
 * covers the CAD behaviour they all inherit.
 */
const URL = 'asset://drawing'
const LEVEL_ID = 'level_test'
const NODE_ID = 'cad-underlay_test'

/** A 10 m × 5 m room outline, drawn in millimetres. */
function drawing() {
  return {
    layers: [{ name: 'DUVAR', colorIndex: 7, visible: true }],
    segments: new Float32Array([
      0, 0, 10_000, 0, 10_000, 0, 10_000, 5000, 10_000, 5000, 0, 5000, 0, 5000, 0, 0,
    ]),
    segmentLayers: new Uint16Array([0, 0, 0, 0]),
    origin: [0, 0] as const,
    bounds: { minX: 0, minY: 0, maxX: 10_000, maxY: 5000 },
    contentBounds: { minX: 0, minY: 0, maxX: 10_000, maxY: 5000 },
    metersPerUnit: 0.001,
    stats: { entityCounts: {}, segmentCount: 4, skippedTypes: {}, droppedNestedInserts: 0 },
  }
}

function seed() {
  useScene.setState({
    nodes: {
      [LEVEL_ID]: LevelNode.parse({ id: LEVEL_ID, name: 'L', children: [NODE_ID] }) as AnyNode,
      [NODE_ID]: CadUnderlayNode.parse({
        id: NODE_ID,
        url: URL,
        parentId: LEVEL_ID,
        scale: 0.001,
      }) as AnyNode,
    },
  } as never)
  releaseCadSnapIndex(NODE_ID)
}

beforeEach(() => {
  releaseCadUnderlay(URL)
  releaseCadSnapIndex(NODE_ID)
  primeCadUnderlay(URL, drawing())
  seed()
  useWallSnapIndicator.getState().clear()
  useEditor.getState().setSnappingMode('polygon', 'lines')
})

describe('polygon drafting over an underlay', () => {
  test('pulls a vertex onto a room corner in the drawing', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [10.04, 5.04],
      levelId: LEVEL_ID,
      magnetic: true,
    })

    expect(result.point[0]).toBeCloseTo(10, 6)
    expect(result.point[1]).toBeCloseTo(5, 6)
  })

  test('pulls a vertex onto a wall line between corners', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [4, 0.04],
      levelId: LEVEL_ID,
      magnetic: true,
    })

    expect(result.point[1]).toBeCloseTo(0, 6)
  })

  test('tints the beacon so the user knows it caught the drawing', () => {
    resolveSurfacePlanPointSnap({ rawPoint: [10.04, 5.04], levelId: LEVEL_ID, magnetic: true })

    const beacon = useWallSnapIndicator.getState().point
    expect(beacon?.source).toBe('cad')
    // Nothing in the model produced this point, so no wall may be highlighted.
    expect(beacon?.wallIds).toBeUndefined()
  })

  test('reports no wall ids for a CAD snap', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [10.04, 5.04],
      levelId: LEVEL_ID,
      magnetic: true,
    })

    expect(result.wallIds).toEqual([])
  })

  test('leaves points clear of the drawing to the grid', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [30, 30],
      fallbackPoint: [30, 30],
      levelId: LEVEL_ID,
      magnetic: true,
    })

    expect(result.point).toEqual([30, 30])
    expect(useWallSnapIndicator.getState().point).toBeNull()
  })

  test('ignores the drawing on a level that does not carry it', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [10.04, 5.04],
      fallbackPoint: [10.04, 5.04],
      levelId: 'level_other',
      magnetic: true,
    })

    expect(result.point).toEqual([10.04, 5.04])
  })

  test('respects hidden layers', () => {
    useScene.setState({
      nodes: {
        [LEVEL_ID]: LevelNode.parse({ id: LEVEL_ID, name: 'L', children: [NODE_ID] }) as AnyNode,
        [NODE_ID]: CadUnderlayNode.parse({
          id: NODE_ID,
          url: URL,
          parentId: LEVEL_ID,
          scale: 0.001,
          layers: { DUVAR: { visible: false } },
        }) as AnyNode,
      },
    } as never)

    const result = resolveSurfacePlanPointSnap({
      rawPoint: [10.04, 5.04],
      fallbackPoint: [10.04, 5.04],
      levelId: LEVEL_ID,
      magnetic: true,
    })

    expect(result.point).toEqual([10.04, 5.04])
  })
})
