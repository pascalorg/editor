import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, CadUnderlayNode, LevelNode, useScene, WallNode } from '@pascal-app/core'
import { releaseCadSnapIndex } from '../../../lib/cad-snap-source'
import { primeCadUnderlay, releaseCadUnderlay } from '../../../lib/cad-underlay-cache'
import useEditor from '../../../store/use-editor'
import { snapWallDraftPointDetailed } from './wall-drafting'

const URL = 'asset://drawing'
const LEVEL_ID = 'level_test'
const NODE_ID = 'cad-underlay_test'

/** A single horizontal line from (0,0) to (10,0) metres, drawn in millimetres. */
function drawing() {
  return {
    layers: [{ name: 'DUVAR', colorIndex: 7, visible: true }],
    segments: new Float32Array([0, 0, 10_000, 0]),
    segmentLayers: new Uint16Array([0]),
    origin: [0, 0] as const,
    bounds: { minX: 0, minY: 0, maxX: 10_000, maxY: 0 },
    contentBounds: { minX: 0, minY: 0, maxX: 10_000, maxY: 0 },
    metersPerUnit: 0.001,
    stats: { entityCounts: {}, segmentCount: 1, skippedTypes: {}, droppedNestedInserts: 0 },
  }
}

function wall(id: string, start: [number, number], end: [number, number]): WallNode {
  return WallNode.parse({ id, parentId: LEVEL_ID, start, end })
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
  useEditor.getState().setSnappingMode('wall', 'lines')
})

describe('magnetic mode', () => {
  test('snaps a draft point onto the underlay', () => {
    const result = snapWallDraftPointDetailed({
      point: [3, 0.06],
      walls: [],
      cadLevelId: LEVEL_ID,
    })

    expect(result.source).toBe('cad')
    expect(result.point[1]).toBeCloseTo(0, 6)
  })

  test('reports the underlay as the source, and carries no wall ids', () => {
    // Provenance matters downstream: `targetWallIds` drives corner joins,
    // wall splitting and construction-plane transfer. A traced line is none of
    // those things, so it must never look like a wall the draft can act on.
    const result = snapWallDraftPointDetailed({
      point: [0.05, 0.05],
      walls: [],
      cadLevelId: LEVEL_ID,
    })

    expect(result.source).toBe('cad')
    expect(result.snap).toBe('endpoint')
    expect(result.targetWallIds).toEqual([])
  })

  test('an existing wall corner outranks the drawing', () => {
    // The user is building a model; joining what they have built keeps it
    // watertight, and the traced line is at the same place anyway.
    const result = snapWallDraftPointDetailed({
      point: [5, 0.06],
      walls: [wall('wall_a', [5, 0], [5, 4])],
      cadLevelId: LEVEL_ID,
    })

    expect(result.source).toBeUndefined()
    expect(result.snap).toBe('endpoint')
    expect(result.targetWallIds).toEqual(['wall_a'])
  })

  test('a nearer wall body outranks a further underlay line', () => {
    const result = snapWallDraftPointDetailed({
      point: [3, 0.2],
      walls: [wall('wall_a', [0, 0.22], [10, 0.22])],
      cadLevelId: LEVEL_ID,
    })

    expect(result.source).toBeUndefined()
    expect(result.snap).toBe('wall')
  })

  test('the underlay wins when it is the nearer of the two', () => {
    const result = snapWallDraftPointDetailed({
      point: [3, 0.05],
      walls: [wall('wall_a', [0, 0.3], [10, 0.3])],
      cadLevelId: LEVEL_ID,
    })

    expect(result.source).toBe('cad')
    expect(result.point[1]).toBeCloseTo(0, 6)
  })

  test('the drawing is ignored when no level is given', () => {
    const result = snapWallDraftPointDetailed({ point: [3, 0.06], walls: [] })
    expect(result.source).toBeUndefined()
  })
})

describe('grid mode', () => {
  beforeEach(() => {
    useEditor.getState().setSnappingMode('wall', 'grid')
  })

  test('the grid still governs placement away from the drawing', () => {
    const result = snapWallDraftPointDetailed({
      point: [3.1, 2.1],
      walls: [],
      magnetic: false,
      cadLevelId: LEVEL_ID,
    })

    expect(result.source).toBeUndefined()
    expect(result.snap).toBeNull()
  })

  test('but the drawing still sticks within a few centimetres', () => {
    // Without this, someone who imported a drawing and left the default mode
    // on would find it purely decorative.
    const result = snapWallDraftPointDetailed({
      point: [3, 0.02],
      walls: [],
      magnetic: false,
      step: 0.5,
      cadLevelId: LEVEL_ID,
    })

    expect(result.source).toBe('cad')
    expect(result.point[1]).toBeCloseTo(0, 6)
  })
})

describe('snap bypass', () => {
  test('off mode leaves the raw cursor alone', () => {
    const result = snapWallDraftPointDetailed({
      point: [3, 0.02],
      walls: [],
      bypassSnap: true,
      cadLevelId: LEVEL_ID,
    })

    expect(result.point).toEqual([3, 0.02])
    expect(result.source).toBeUndefined()
  })
})
