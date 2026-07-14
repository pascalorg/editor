import { beforeAll, describe, expect, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import { BoxGeometry, Group, Mesh } from 'three'
import type { MeasurementSegment } from '../store/use-measurement-tool'
import { EDITOR_LAYER } from './constants'
import {
  createNodeBoundsAttachment,
  refreshRenderedBoundsMeasurementSegments,
  resolveAttachedMeasurementSegments,
} from './measurement-attachments'
import {
  collectCommittedMeasurementSnapGeometry,
  collectPlanMeasurementSnapGeometry,
  type MeasurementSnapGeometry,
  mergeMeasurementSnapGeometry,
  resolvePlanMeasurementConstraint,
  resolvePlanMeasurementSnap,
} from './measurement-snapping'
import { registerMeasurementTestNodes } from './register-measurement-test-nodes'

beforeAll(() => {
  registerMeasurementTestNodes()
})

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
    expect(result.target?.targetLine).toEqual({
      start: [0, 0, 0],
      end: [4, 0, 0],
    })
  })

  test('keeps plan attachments on the same node feature as geometry changes', () => {
    const wall = {
      object: 'node',
      id: 'attached-wall',
      type: 'wall',
      name: 'Attached wall',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      start: [0, 0],
      end: [4, 0],
    } as any
    const geometry = collectPlanMeasurementSnapGeometry([wall])
    const snap = resolvePlanMeasurementSnap([1.7, 0, 0.04], geometry, {
      enabledSnapKinds: { grid: false },
      radiusMeters: 0.1,
      view: '2d',
    })

    expect(snap.target?.attachment).toMatchObject({
      feature: { kind: 'plan-segment' },
      nodeId: wall.id,
    })

    const measurement: MeasurementSegment = {
      id: 'attached-measurement',
      start: [0, 0, 1],
      end: snap.point,
      endAttachment: snap.target?.attachment,
      view: '2d',
    }
    const resizedWall = { ...wall, end: [8, 0] }
    const [resolved] = resolveAttachedMeasurementSegments([measurement], {
      [resizedWall.id]: resizedWall,
    })

    expect(resolved?.end).toEqual([3.4, 0, 0])
  })

  test('allows the two measurement endpoints to follow different nodes', () => {
    const firstWall = {
      object: 'node',
      id: 'first-attached-wall',
      type: 'wall',
      name: 'First wall',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      start: [0, 0],
      end: [2, 0],
    } as any
    const secondWall = { ...firstWall, id: 'second-attached-wall', start: [4, 0], end: [6, 0] }
    const firstGeometry = collectPlanMeasurementSnapGeometry([firstWall])
    const secondGeometry = collectPlanMeasurementSnapGeometry([secondWall])
    const startAttachment = firstGeometry.anchors.find(
      (anchor) => anchor.kind === 'endpoint' && anchor.point[0] === 0,
    )?.attachment
    const endAttachment = secondGeometry.anchors.find(
      (anchor) => anchor.kind === 'endpoint' && anchor.point[0] === 6,
    )?.attachment
    const measurement: MeasurementSegment = {
      id: 'two-owner-measurement',
      start: [0, 0, 0],
      end: [6, 0, 0],
      startAttachment,
      endAttachment,
      view: '2d',
    }
    const movedFirst = { ...firstWall, start: [1, 0], end: [3, 0] }
    const movedSecond = { ...secondWall, start: [7, 0], end: [9, 0] }

    const [resolved] = resolveAttachedMeasurementSegments([measurement], {
      [movedFirst.id]: movedFirst,
      [movedSecond.id]: movedSecond,
    })

    expect(resolved?.start).toEqual([1, 0, 0])
    expect(resolved?.end).toEqual([9, 0, 0])
  })

  test('resolves attached endpoints from live shape overrides and move transforms', () => {
    const wall = {
      object: 'node',
      id: 'live-attached-wall',
      type: 'wall',
      name: 'Live attached wall',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      start: [0, 0],
      end: [4, 0],
    } as any
    const wallEndAttachment = collectPlanMeasurementSnapGeometry([wall]).anchors.find(
      (anchor) => anchor.kind === 'endpoint' && anchor.point[0] === 4,
    )?.attachment
    const wallMeasurement: MeasurementSegment = {
      id: 'live-wall-measurement',
      start: [0, 0, 1],
      end: [4, 0, 0],
      endAttachment: wallEndAttachment,
      view: '2d',
    }
    const [liveWallMeasurement] = resolveAttachedMeasurementSegments(
      [wallMeasurement],
      { [wall.id]: wall },
      new Map(),
      new Map([[wall.id, { end: [7, 0] }]]),
    )
    expect(liveWallMeasurement?.end).toEqual([7, 0, 0])

    const zone = {
      object: 'node',
      id: 'live-attached-zone',
      type: 'zone',
      name: 'Live attached zone',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    } as any
    const zoneAttachment = collectPlanMeasurementSnapGeometry([zone]).anchors.find(
      (anchor) => anchor.kind === 'vertex' && anchor.point[0] === 0 && anchor.point[2] === 0,
    )?.attachment
    const [liveZoneMeasurement] = resolveAttachedMeasurementSegments(
      [
        {
          id: 'live-zone-measurement',
          start: [0, 0, 0],
          end: [1, 0, 1],
          startAttachment: zoneAttachment,
          view: '2d',
        },
      ],
      { [zone.id]: zone },
      new Map([[zone.id, { position: [3, 0, 4], rotation: 0 }]]),
    )
    expect(liveZoneMeasurement?.start).toEqual([3, 0, 4])
  })

  test('keeps 3D bounds attachments on the same corner through resize and movement', () => {
    const nodeId = 'rendered-bounds-node'
    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(2, 2, 2))
    root.add(mesh)
    root.updateWorldMatrix(true, true)
    sceneRegistry.nodes.set(nodeId as never, root)

    const attachment = createNodeBoundsAttachment(nodeId, [1, 1, 1])
    expect(attachment).toMatchObject({
      feature: { kind: 'node-bounds', normalized: [1, 1, 1] },
      nodeId,
    })

    mesh.scale.x = 2
    root.position.x = 3
    root.updateWorldMatrix(true, true)
    const [resolved] = resolveAttachedMeasurementSegments(
      [
        {
          id: 'rendered-bounds-measurement',
          start: [0, 0, 0],
          end: [1, 1, 1],
          endAttachment: attachment,
          measuredDistanceMeters: 2,
          view: '3d',
        },
      ],
      { [nodeId]: { id: nodeId } as never },
    )

    expect(resolved?.end).toEqual([5, 1, 1])
    expect(resolved?.measuredDistanceMeters).toBeUndefined()
    sceneRegistry.nodes.delete(nodeId as never)
    mesh.geometry.dispose()
  })

  test('refreshes a rendered bounds attachment after an imperative mesh resize', () => {
    const nodeId = 'rendered-bounds-refresh-node'
    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(2, 2, 2))
    root.add(mesh)
    root.updateWorldMatrix(true, true)
    sceneRegistry.nodes.set(nodeId as never, root)

    const segment: MeasurementSegment = {
      id: 'rendered-bounds-refresh-measurement',
      start: [0, 0, 0],
      end: [1, 1, 1],
      endAttachment: createNodeBoundsAttachment(nodeId, [1, 1, 1]),
      view: '3d',
    }
    const nodes = { [nodeId]: { id: nodeId } as never }
    const initial = resolveAttachedMeasurementSegments([segment], nodes)

    mesh.scale.x = 2
    root.updateWorldMatrix(true, true)
    const refreshed = refreshRenderedBoundsMeasurementSegments(initial, [segment], nodes)

    expect(refreshed).not.toBe(initial)
    expect(refreshed[0]?.end).toEqual([2, 1, 1])
    sceneRegistry.nodes.delete(nodeId as never)
    mesh.geometry.dispose()
  })

  test('ignores editor handles when resolving rendered bounds attachments', () => {
    const nodeId = 'rendered-bounds-editor-handle-node'
    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(2, 2, 2))
    root.add(mesh)
    root.updateWorldMatrix(true, true)
    sceneRegistry.nodes.set(nodeId as never, root)

    const attachment = createNodeBoundsAttachment(nodeId, [1, 1, 1])
    const overlayHandle = new Mesh(new BoxGeometry(20, 20, 20))
    overlayHandle.position.set(100, 0, 0)
    overlayHandle.renderOrder = 1010
    root.add(overlayHandle)
    const overlayLayerHandle = new Mesh(new BoxGeometry(20, 20, 20))
    overlayLayerHandle.position.set(-100, 0, 0)
    overlayLayerHandle.layers.set(EDITOR_LAYER)
    root.add(overlayLayerHandle)
    root.updateWorldMatrix(true, true)

    const [resolved] = resolveAttachedMeasurementSegments(
      [
        {
          id: 'rendered-bounds-editor-handle-measurement',
          start: [0, 0, 0],
          end: [1, 1, 1],
          endAttachment: attachment,
          view: '3d',
        },
      ],
      { [nodeId]: { id: nodeId } as never },
    )

    expect(resolved?.end).toEqual([1, 1, 1])
    sceneRegistry.nodes.delete(nodeId as never)
    mesh.geometry.dispose()
    overlayHandle.geometry.dispose()
    overlayLayerHandle.geometry.dispose()
  })

  test('keeps rendered bounds refresh identity when geometry did not move', () => {
    const nodeId = 'rendered-bounds-refresh-stable-node'
    const root = new Group()
    const mesh = new Mesh(new BoxGeometry(2, 2, 2))
    root.add(mesh)
    root.updateWorldMatrix(true, true)
    sceneRegistry.nodes.set(nodeId as never, root)

    const segment: MeasurementSegment = {
      id: 'rendered-bounds-refresh-stable-measurement',
      start: [0, 0, 0],
      end: [1, 1, 1],
      endAttachment: createNodeBoundsAttachment(nodeId, [1, 1, 1]),
      view: '3d',
    }
    const nodes = { [nodeId]: { id: nodeId } as never }
    const initial = resolveAttachedMeasurementSegments([segment], nodes)
    const refreshed = refreshRenderedBoundsMeasurementSegments(initial, [segment], nodes)

    expect(refreshed).toBe(initial)
    sceneRegistry.nodes.delete(nodeId as never)
    mesh.geometry.dispose()
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

  test('exposes committed measurements from every view for cross-view snapping', () => {
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

    const geometry = collectCommittedMeasurementSnapGeometry(segments)

    expect(geometry.anchors).toHaveLength(6)
    expect(geometry.segments).toHaveLength(2)
    expect(geometry.anchors.every((anchor) => anchor.kind === 'measurement')).toBe(true)
    expect(geometry.anchors.some((anchor) => anchor.point[1] === 1)).toBe(true)
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
      geometry.anchors.find(
        (anchor) =>
          anchor.kind === 'vertex' &&
          anchor.label === 'Surface opening vertex' &&
          anchor.point[0] === 1 &&
          anchor.point[2] === 1,
      )?.targetLine,
    ).toEqual({
      start: [1, 0, 1],
      end: [2, 0, 1],
    })
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

  test('constrains active measurements to common polar guide angles without nearby geometry', () => {
    const geometry: MeasurementSnapGeometry = {
      anchors: [],
      segments: [],
    }

    const diagonal = resolvePlanMeasurementConstraint([0, 0, 0], [1, 0, 1.08], geometry, {
      radiusMeters: 0.15,
      view: '2d',
    })
    const horizontal = resolvePlanMeasurementConstraint([0, 0, 0], [2, 0, 0.06], geometry, {
      radiusMeters: 0.15,
      view: '2d',
    })

    expect(diagonal.point[0]).toBeCloseTo(diagonal.point[2])
    expect(diagonal.target?.kind).toBe('guide')
    expect(diagonal.target?.label).toBe('Polar guide 45°')
    expect(horizontal.point[2]).toBeCloseTo(0)
    expect(horizontal.target?.kind).toBe('guide')
    expect(horizontal.target?.label).toBe('Polar guide 0°')
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
