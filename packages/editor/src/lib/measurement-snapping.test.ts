import { describe, expect, test } from 'bun:test'
import type { MeasurementSegment } from '../store/use-measurement-tool'
import {
  collectCommittedMeasurementSnapGeometry,
  collectPlanMeasurementSnapGeometry,
  type MeasurementSnapGeometry,
  mergeMeasurementSnapGeometry,
  resolvePlanMeasurementConstraint,
  resolvePlanMeasurementSnap,
} from './measurement-snapping'

describe('measurement snapping', () => {
  test('prefers semantic snap priority over a closer grid point', () => {
    const geometry: MeasurementSnapGeometry = {
      anchors: [{ kind: 'endpoint', label: 'Endpoint', point: [0.49, 0, 0.49], priority: 0 }],
      segments: [],
    }

    const result = resolvePlanMeasurementSnap([0.51, 0, 0.51], geometry, {
      radiusMeters: 0.1,
      view: '2d',
      gridStep: 0.5,
    })

    expect(result.point).toEqual([0.49, 0, 0.49])
    expect(result.target?.kind).toBe('endpoint')
  })

  test('projects cursor points onto snap segments', () => {
    const geometry: MeasurementSnapGeometry = {
      anchors: [],
      segments: [
        {
          kind: 'edge',
          label: 'Wall edge',
          start: [0, 0, 0],
          end: [4, 0, 0],
          priority: 3,
        },
      ],
    }

    const result = resolvePlanMeasurementSnap([2, 0, 0.04], geometry, {
      radiusMeters: 0.1,
      view: '2d',
    })

    expect(result.point).toEqual([2, 0, 0])
    expect(result.target?.kind).toBe('edge')
  })

  test('uses grid as fallback when no geometry is close enough', () => {
    const result = resolvePlanMeasurementSnap(
      [1.98, 0, 2.03],
      { anchors: [], segments: [] },
      {
        radiusMeters: 0.1,
        view: '3d',
        gridStep: 0.5,
      },
    )

    expect(result.point).toEqual([2, 0, 2])
    expect(result.target?.kind).toBe('grid')
  })

  test('does not use disabled snap families', () => {
    const geometry: MeasurementSnapGeometry = {
      anchors: [{ kind: 'endpoint', label: 'Endpoint', point: [0, 0, 0], priority: 0 }],
      segments: [
        {
          kind: 'edge',
          label: 'Wall edge',
          start: [0, 0, 0],
          end: [4, 0, 0],
          priority: 3,
        },
      ],
    }

    const result = resolvePlanMeasurementSnap([0.02, 0, 0.02], geometry, {
      enabledSnapKinds: {
        edge: false,
        endpoint: false,
        grid: false,
      },
      radiusMeters: 0.1,
      view: '2d',
    })

    expect(result.point).toEqual([0.02, 0, 0.02])
    expect(result.target).toBeNull()
  })

  test('skips grid fallback when grid snapping is disabled', () => {
    const result = resolvePlanMeasurementSnap(
      [1.98, 0, 2.03],
      { anchors: [], segments: [] },
      {
        enabledSnapKinds: { grid: false },
        radiusMeters: 0.1,
        view: '3d',
        gridStep: 0.5,
      },
    )

    expect(result.point).toEqual([1.98, 0, 2.03])
    expect(result.target).toBeNull()
  })

  test('exposes committed measurements only for the active view', () => {
    const segments: MeasurementSegment[] = [
      {
        id: '2d-measurement',
        start: [0, 0, 0],
        end: [2, 0, 0],
        view: '2d',
      },
      {
        id: '3d-measurement',
        start: [0, 1, 0],
        end: [0, 1, 2],
        view: '3d',
      },
    ]

    const geometry = collectCommittedMeasurementSnapGeometry(segments, '2d')

    expect(geometry.anchors).toHaveLength(3)
    expect(geometry.segments).toHaveLength(1)
    expect(geometry.anchors.every((anchor) => anchor.kind === 'measurement')).toBe(true)
    expect(geometry.anchors.some((anchor) => anchor.point[1] === 1)).toBe(false)
  })

  test('collects surface opening hole snap geometry', () => {
    const geometry = collectPlanMeasurementSnapGeometry([
      {
        object: 'node',
        id: 'slab-with-hole',
        type: 'slab',
        name: 'Slab with hole',
        parentId: null,
        visible: true,
        metadata: {},
        children: [],
        elevation: 0,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        holes: [
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
          ],
        ],
      },
    ] as any[])

    expect(
      geometry.anchors.some(
        (anchor) =>
          anchor.kind === 'vertex' &&
          anchor.label === 'Surface opening vertex' &&
          anchor.point[0] === 1 &&
          anchor.point[2] === 1,
      ),
    ).toBe(true)
    expect(
      geometry.segments.some(
        (segment) =>
          segment.kind === 'edge' &&
          segment.label === 'Surface opening edge' &&
          segment.start[0] === 1 &&
          segment.end[0] === 2,
      ),
    ).toBe(true)
  })

  test('collects site property line polygon snap geometry', () => {
    const geometry = collectPlanMeasurementSnapGeometry([
      {
        object: 'node',
        id: 'site-property-line',
        type: 'site',
        name: 'Site',
        parentId: null,
        visible: true,
        metadata: {},
        children: [],
        polygon: {
          type: 'polygon',
          points: [
            [-2, -1],
            [2, -1],
            [2, 1],
            [-2, 1],
          ],
        },
      },
    ] as any[])

    expect(
      geometry.anchors.some(
        (anchor) =>
          anchor.kind === 'vertex' &&
          anchor.label === 'Property line vertex' &&
          anchor.point[0] === -2 &&
          anchor.point[2] === -1,
      ),
    ).toBe(true)
    expect(
      geometry.segments.some(
        (segment) =>
          segment.kind === 'edge' &&
          segment.label === 'Property line edge' &&
          segment.start[0] === -2 &&
          segment.end[0] === 2,
      ),
    ).toBe(true)
  })

  test('collects roof-hosted accessory snap geometry in world plan space', () => {
    const geometry = collectPlanMeasurementSnapGeometry([
      {
        object: 'node',
        id: 'roof-a',
        type: 'roof',
        name: 'Roof',
        parentId: null,
        visible: true,
        metadata: {},
        children: ['segment-a'],
        position: [10, 0, 20],
        rotation: Math.PI / 2,
      },
      {
        object: 'node',
        id: 'segment-a',
        type: 'roof-segment',
        name: 'Roof Segment',
        parentId: 'roof-a',
        visible: true,
        metadata: {},
        children: ['skylight-a'],
        position: [2, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 4,
        depth: 2,
        pitch: 40,
        wallHeight: 0.5,
        wallThickness: 0.1,
        deckThickness: 0.1,
        overhang: 0.3,
        shingleThickness: 0.05,
        gambrelLowerWidthRatio: 0.5,
        mansardSteepWidthRatio: 0.15,
        dutchHipWidthRatio: 0.25,
        dutchWaistLengthRatio: 0.98,
      },
      {
        object: 'node',
        id: 'skylight-a',
        type: 'skylight',
        name: 'Skylight',
        parentId: 'segment-a',
        visible: true,
        metadata: {},
        children: [],
        roofSegmentId: 'segment-a',
        position: [0, 0, 0],
        rotation: 0,
        width: 2,
        height: 1,
      },
    ] as any[])

    expect(
      geometry.anchors.some(
        (anchor) =>
          anchor.kind === 'center' &&
          anchor.label === 'Skylight center' &&
          Math.abs(anchor.point[0] - 10) < 1e-6 &&
          Math.abs(anchor.point[2] - 18) < 1e-6,
      ),
    ).toBe(true)
    expect(
      geometry.segments.some(
        (segment) =>
          segment.kind === 'edge' &&
          segment.label === 'Skylight edge' &&
          Math.abs(segment.start[0] - 10.5) < 1e-6 &&
          Math.abs(segment.end[0] - 10.5) < 1e-6,
      ),
    ).toBe(true)
  })

  test('collects intersections without treating shared sampled source endpoints as crossings', () => {
    const nodes = [
      {
        object: 'node',
        id: 'wall-a',
        type: 'wall',
        name: 'Wall A',
        parentId: null,
        visible: true,
        metadata: {},
        children: [],
        start: [0, 0],
        end: [4, 0],
      },
      {
        object: 'node',
        id: 'wall-b',
        type: 'wall',
        name: 'Wall B',
        parentId: null,
        visible: true,
        metadata: {},
        children: [],
        start: [2, -1],
        end: [2, 1],
      },
    ] as any[]

    const geometry = collectPlanMeasurementSnapGeometry(nodes)

    expect(
      geometry.anchors.some(
        (anchor) =>
          anchor.kind === 'intersection' &&
          Math.abs(anchor.point[0] - 2) < 1e-6 &&
          Math.abs(anchor.point[2]) < 1e-6,
      ),
    ).toBe(true)
    expect(
      geometry.anchors.filter(
        (anchor) =>
          anchor.kind === 'intersection' &&
          Math.abs(anchor.point[0]) < 1e-6 &&
          Math.abs(anchor.point[2]) < 1e-6,
      ),
    ).toHaveLength(0)
  })

  test('constrains active measurements parallel and perpendicular to nearby geometry', () => {
    const geometry: MeasurementSnapGeometry = {
      anchors: [],
      segments: [
        {
          kind: 'edge',
          label: 'Wall edge',
          start: [0, 0, 0],
          end: [4, 0, 0],
          priority: 3,
        },
      ],
    }

    const parallel = resolvePlanMeasurementConstraint([1, 0, 0.02], [2, 0, 0.08], geometry, {
      radiusMeters: 0.15,
      view: '2d',
    })
    const perpendicular = resolvePlanMeasurementConstraint([1, 0, 0.02], [1.08, 0, 1], geometry, {
      radiusMeters: 0.15,
      view: '2d',
    })

    expect(parallel.point[2]).toBeCloseTo(0.02)
    expect(parallel.target?.kind).toBe('guide')
    expect(parallel.target?.guideLine).toBeDefined()
    expect(perpendicular.point[0]).toBeCloseTo(1)
    expect(perpendicular.target?.kind).toBe('guide')
  })

  test('does not constrain active measurements when guide snapping is disabled', () => {
    const geometry: MeasurementSnapGeometry = {
      anchors: [],
      segments: [
        {
          kind: 'edge',
          label: 'Wall edge',
          start: [0, 0, 0],
          end: [4, 0, 0],
          priority: 3,
        },
      ],
    }

    const result = resolvePlanMeasurementConstraint([1, 0, 0.02], [2, 0, 0.08], geometry, {
      enabledSnapKinds: { guide: false },
      radiusMeters: 0.15,
      view: '2d',
    })

    expect(result.point).toEqual([2, 0, 0.08])
    expect(result.target).toBeNull()
  })

  test('merges plan and committed measurement snap geometry', () => {
    const planGeometry: MeasurementSnapGeometry = {
      anchors: [{ kind: 'endpoint', label: 'Endpoint', point: [0, 0, 0] }],
      segments: [],
    }
    const savedGeometry: MeasurementSnapGeometry = {
      anchors: [{ kind: 'measurement', label: 'Measurement endpoint', point: [1, 0, 0] }],
      segments: [],
    }

    const merged = mergeMeasurementSnapGeometry(planGeometry, savedGeometry)

    expect(merged.anchors.map((anchor) => anchor.kind)).toEqual(['endpoint', 'measurement'])
  })
})
