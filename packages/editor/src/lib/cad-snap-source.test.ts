import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, CadUnderlayNode, LevelNode, useScene } from '@pascal-app/core'
import { findCadSnapOnLevel, hasCadUnderlay, releaseCadSnapIndex } from './cad-snap-source'
import { primeCadUnderlay, releaseCadUnderlay } from './cad-underlay-cache'

const URL = 'asset://drawing'
const LEVEL_ID = 'level_test'
const NODE_ID = 'cad-underlay_test'

/**
 * A 10 m × 5 m rectangle drawn in millimetres, plus a diagonal on a second
 * layer so layer visibility has something to hide.
 */
function drawing() {
  return {
    layers: [
      { name: 'DUVAR', colorIndex: 7, visible: true },
      { name: 'MOBILYA', colorIndex: 3, visible: true },
    ],
    segments: new Float32Array([
      0, 0, 10_000, 0, 10_000, 0, 10_000, 5000, 10_000, 5000, 0, 5000, 0, 5000, 0, 0, 2000, 1000,
      8000, 4000,
    ]),
    segmentLayers: new Uint16Array([0, 0, 0, 0, 1]),
    origin: [0, 0] as const,
    bounds: { minX: 0, minY: 0, maxX: 10_000, maxY: 5000 },
    contentBounds: { minX: 0, minY: 0, maxX: 10_000, maxY: 5000 },
    metersPerUnit: 0.001,
    stats: {
      entityCounts: { LINE: 5 },
      segmentCount: 5,
      skippedTypes: {},
      droppedNestedInserts: 0,
    },
  }
}

function seedScene(overrides: Record<string, unknown> = {}) {
  const level = LevelNode.parse({ id: LEVEL_ID, name: 'Level', children: [NODE_ID] })
  const underlay = CadUnderlayNode.parse({
    id: NODE_ID,
    url: URL,
    parentId: LEVEL_ID,
    // The import writes metres-per-unit here, so a millimetre drawing lands at
    // real-world size without touching the asset.
    scale: 0.001,
    ...overrides,
  })

  useScene.setState({
    nodes: { [LEVEL_ID]: level as AnyNode, [NODE_ID]: underlay as AnyNode },
  } as never)
  releaseCadSnapIndex(NODE_ID)
  return underlay
}

beforeEach(() => {
  releaseCadUnderlay(URL)
  releaseCadSnapIndex(NODE_ID)
  primeCadUnderlay(URL, drawing())
  seedScene()
})

describe('findCadSnapOnLevel', () => {
  test('snaps to a drawing corner in level-local metres', () => {
    // The rectangle's far corner is at 10,000 mm → 10 m.
    const snap = findCadSnapOnLevel(LEVEL_ID, [10.05, 0.05])

    expect(snap?.kind).toBe('endpoint')
    expect(snap?.point[0]).toBeCloseTo(10, 6)
    expect(snap?.point[1]).toBeCloseTo(0, 6)
  })

  test('snaps onto a line body between corners', () => {
    const snap = findCadSnapOnLevel(LEVEL_ID, [3, 0.05])

    expect(snap?.kind).toBe('segment')
    expect(snap?.point[1]).toBeCloseTo(0, 6)
  })

  test('returns nothing when the cursor is clear of the drawing', () => {
    expect(findCadSnapOnLevel(LEVEL_ID, [50, 50])).toBeNull()
  })

  test('returns nothing for a level with no underlay', () => {
    expect(findCadSnapOnLevel('level_other', [0, 0])).toBeNull()
    expect(findCadSnapOnLevel(null, [0, 0])).toBeNull()
  })

  test('follows the underlay when it is moved', () => {
    seedScene({ position: [100, 0, 0] })
    expect(findCadSnapOnLevel(LEVEL_ID, [0.05, 0.05])).toBeNull()

    const moved = findCadSnapOnLevel(LEVEL_ID, [100.05, 0.05])
    expect(moved?.kind).toBe('endpoint')
    expect(moved?.point[0]).toBeCloseTo(100, 6)
  })

  test('follows a rescaled underlay', () => {
    expect(findCadSnapOnLevel(LEVEL_ID, [10.05, 0.05])?.kind).toBe('endpoint')

    // Recalibrated to centimetres: the drawing is ten times bigger, so that
    // corner is now at 100 m and the old spot is merely a point on the edge.
    seedScene({ scale: 0.01 })
    expect(findCadSnapOnLevel(LEVEL_ID, [10.05, 0.05])?.kind).toBe('segment')

    const corner = findCadSnapOnLevel(LEVEL_ID, [100.05, 0.05])
    expect(corner?.kind).toBe('endpoint')
    expect(corner?.point[0]).toBeCloseTo(100, 6)
  })

  test('will not snap to a layer the user hid', () => {
    // The diagonal's end sits at (8, 4); it is the only geometry there.
    expect(findCadSnapOnLevel(LEVEL_ID, [8.05, 4.05])?.kind).toBe('endpoint')

    seedScene({ layers: { MOBILYA: { visible: false } } })
    expect(findCadSnapOnLevel(LEVEL_ID, [8.05, 4.05])).toBeNull()
  })

  test('will not snap to a hidden underlay', () => {
    seedScene({ visible: false })
    expect(findCadSnapOnLevel(LEVEL_ID, [10.05, 0.05])).toBeNull()
  })

  test('rebuilds when the placement changes rather than serving a stale index', () => {
    // Deliberately does not call releaseCadSnapIndex — the signature must
    // notice on its own, or every recalibration would leave snapping behind.
    expect(findCadSnapOnLevel(LEVEL_ID, [10.05, 0.05])?.point[0]).toBeCloseTo(10, 6)

    const moved = CadUnderlayNode.parse({
      id: NODE_ID,
      url: URL,
      parentId: LEVEL_ID,
      scale: 0.001,
      position: [50, 0, 0],
    })
    useScene.setState({
      nodes: {
        [LEVEL_ID]: LevelNode.parse({
          id: LEVEL_ID,
          name: 'Level',
          children: [NODE_ID],
        }) as AnyNode,
        [NODE_ID]: moved as AnyNode,
      },
    } as never)

    expect(findCadSnapOnLevel(LEVEL_ID, [10.05, 0.05])).toBeNull()
    expect(findCadSnapOnLevel(LEVEL_ID, [60.05, 0.05])?.point[0]).toBeCloseTo(60, 6)
  })
})

describe('hasCadUnderlay', () => {
  test('reports whether a level carries a visible drawing', () => {
    expect(hasCadUnderlay(LEVEL_ID)).toBe(true)
    expect(hasCadUnderlay('level_other')).toBe(false)
    expect(hasCadUnderlay(null)).toBe(false)

    seedScene({ visible: false })
    expect(hasCadUnderlay(LEVEL_ID)).toBe(false)
  })
})
