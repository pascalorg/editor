import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { AnyNode, ItemNode, useScene } from '@pascal-app/core'
import { syncLinearMeasurementSceneNodes } from '../lib/measurement-scene-nodes'
import { registerMeasurementTestNodes } from '../lib/register-measurement-test-nodes'
import {
  axisLockedMeasurementPoint,
  DEFAULT_MEASUREMENT_SNAP_SETTINGS,
  distanceBetweenMeasurements,
  hydrateMeasurements,
  isDraggingMeasurementEndpoint,
  normalizePersistedMeasurements,
  serializeMeasurements,
  useMeasurementTool,
} from './use-measurement-tool'

beforeAll(() => {
  registerMeasurementTestNodes()
})

afterEach(() => {
  useScene.getState().clearScene()
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setContinuousMeasurement(false)
  useMeasurementTool.getState().setDisplayPrecision('standard')
  for (const [kind, enabled] of Object.entries(DEFAULT_MEASUREMENT_SNAP_SETTINGS)) {
    useMeasurementTool
      .getState()
      .setSnapKindEnabled(kind as keyof typeof DEFAULT_MEASUREMENT_SNAP_SETTINGS, enabled)
  }
})

function zoneNode(): AnyNode {
  return {
    id: 'measurement_store_zone',
    type: 'surface-perimeter-without-boundary',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  } as never
}

function syncMeasurementSceneNodesForTest() {
  syncLinearMeasurementSceneNodes(useMeasurementTool.getState().segments)
}

describe('useMeasurementTool', () => {
  test('isDraggingMeasurementEndpoint identifies only the active handle', () => {
    expect(
      isDraggingMeasurementEndpoint(
        { endpoint: 'start', id: 'measurement-1' },
        'measurement-1',
        'start',
      ),
    ).toBe(true)
    expect(
      isDraggingMeasurementEndpoint(
        { endpoint: 'start', id: 'measurement-1' },
        'measurement-1',
        'end',
      ),
    ).toBe(false)
    expect(isDraggingMeasurementEndpoint(null, 'measurement-1', 'start')).toBe(false)
  })

  test('axisLockedMeasurementPoint constrains to the strongest drawing axis', () => {
    expect(axisLockedMeasurementPoint([0, 0, 0], [1, 2, 4], '2d')).toEqual([0, 0, 4])
    expect(axisLockedMeasurementPoint([0, 0, 0], [1, 2, 4], '3d')).toEqual([0, 0, 4])
    expect(axisLockedMeasurementPoint([0, 0, 0], [1, 5, 4], '3d')).toEqual([0, 5, 0])
  })

  test('commits point-to-point measurements and selects the new segment', () => {
    const measurement = useMeasurementTool.getState()
    measurement.begin('2d', [0, 0, 0])
    measurement.update([3, 0, 4])
    measurement.commit()

    const state = useMeasurementTool.getState()
    expect(state.draft).toBeNull()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]?.view).toBe('2d')
    expect(state.segments[0]?.start).toEqual([0, 0, 0])
    expect(state.segments[0]?.end).toEqual([3, 0, 4])
    expect(state.selectedId).toBe(state.segments[0]?.id ?? null)
  })

  test('parents attached linear measurements to the snapped mesh', () => {
    useScene.setState({
      nodes: {
        level_measurement: {
          id: 'level_measurement',
          type: 'level',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['item_measurement'],
          level: 0,
        } as never,
        item_measurement: ItemNode.parse({
          id: 'item_measurement',
          parentId: 'level_measurement',
          asset: {
            id: 'asset_measurement',
            category: 'furniture',
            name: 'Measured item',
            thumbnail: '/item.webp',
            src: '/item.glb',
          },
        }),
      },
      rootNodeIds: ['level_measurement' as never],
    })

    useMeasurementTool
      .getState()
      .addSegment(
        '3d',
        [0, 0, 0],
        [1, 0, 0],
        undefined,
        { feature: { kind: 'node-bounds', normalized: [0, 0, 0] }, nodeId: 'item_measurement' },
        { feature: { kind: 'node-bounds', normalized: [1, 0, 0] }, nodeId: 'item_measurement' },
      )

    syncMeasurementSceneNodesForTest()
    const segment = useMeasurementTool.getState().segments[0]!
    const sceneNode = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'measurement',
    )
    expect(sceneNode).toMatchObject({
      measurementId: segment.id,
      parentId: 'item_measurement',
      startAttachment: { nodeId: 'item_measurement' },
      endAttachment: { nodeId: 'item_measurement' },
    })
    expect(sceneNode).toBeDefined()
    expect(
      (useScene.getState().nodes.item_measurement as { children: string[] }).children,
    ).toContain(sceneNode!.id)
    expect(AnyNode.safeParse(useScene.getState().nodes.item_measurement).success).toBe(true)
  })

  test('creates the item child list when an attached measurement is parented to an unparsed item', () => {
    useScene.setState({
      nodes: {
        item_measurement: {
          id: 'item_measurement',
          type: 'item',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          asset: {
            id: 'asset_measurement',
            category: 'furniture',
            name: 'Measured item',
            thumbnail: '/item.webp',
            src: '/item.glb',
          },
        } as never,
      },
      rootNodeIds: ['item_measurement' as never],
    })

    useMeasurementTool
      .getState()
      .addSegment(
        '3d',
        [0, 0, 0],
        [1, 0, 0],
        undefined,
        { feature: { kind: 'node-bounds', normalized: [0, 0, 0] }, nodeId: 'item_measurement' },
        { feature: { kind: 'node-bounds', normalized: [1, 0, 0] }, nodeId: 'item_measurement' },
      )

    syncMeasurementSceneNodesForTest()
    const sceneNode = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'measurement',
    )
    expect(sceneNode?.parentId).toBe('item_measurement')
    expect(
      (useScene.getState().nodes.item_measurement as { children?: string[] }).children,
    ).toContain(sceneNode!.id)
    expect(AnyNode.safeParse(useScene.getState().nodes.item_measurement).success).toBe(true)
  })

  test('adds unattached linear measurements at the scene root', () => {
    useMeasurementTool.getState().addSegment('3d', [0, 0, 0], [1, 0, 0])
    syncMeasurementSceneNodesForTest()

    const sceneNode = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'measurement',
    )
    expect(sceneNode).toMatchObject({ parentId: null })
    expect(sceneNode).toBeDefined()
    expect(useScene.getState().rootNodeIds).toContain(sceneNode!.id)
  })

  test('uses the start attachment as owner when endpoints attach to different meshes', () => {
    useScene.setState({
      nodes: {
        item_start: {
          id: 'item_start',
          type: 'item',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: [],
        } as never,
        item_end: {
          id: 'item_end',
          type: 'item',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: [],
        } as never,
      },
      rootNodeIds: ['item_start' as never, 'item_end' as never],
    })

    useMeasurementTool
      .getState()
      .addSegment(
        '3d',
        [0, 0, 0],
        [1, 0, 0],
        undefined,
        { feature: { kind: 'node-bounds', normalized: [0, 0, 0] }, nodeId: 'item_start' },
        { feature: { kind: 'node-bounds', normalized: [1, 0, 0] }, nodeId: 'item_end' },
      )

    syncMeasurementSceneNodesForTest()
    const sceneNode = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'measurement',
    )
    expect(sceneNode?.parentId).toBe('item_start')
  })

  test('parents attached measurements under non-item scene nodes automatically', () => {
    useScene.setState({
      nodes: {
        sseg_measured_segment: {
          attachmentSide: 'front',
          children: [],
          fillToFloor: true,
          height: 2.5,
          id: 'sseg_measured_segment',
          length: 3,
          metadata: {},
          object: 'node',
          parentId: null,
          position: [0, 0, 0],
          rotation: 0,
          segmentType: 'stair',
          stepCount: 10,
          thickness: 0.25,
          type: 'stair-segment',
          visible: true,
          width: 1,
        } as never,
      },
      rootNodeIds: ['sseg_measured_segment' as never],
    })

    useMeasurementTool.getState().addSegment(
      '3d',
      [0, 0, 0],
      [1, 0, 0],
      undefined,
      {
        feature: { kind: 'node-bounds', normalized: [0, 0, 0] },
        nodeId: 'sseg_measured_segment',
      },
      {
        feature: { kind: 'node-bounds', normalized: [1, 0, 0] },
        nodeId: 'sseg_measured_segment',
      },
    )

    syncMeasurementSceneNodesForTest()
    const sceneNode = Object.values(useScene.getState().nodes).find(
      (node) => node.type === 'measurement',
    )
    const parent = useScene.getState().nodes.sseg_measured_segment as { children?: string[] }
    expect(sceneNode?.parentId).toBe('sseg_measured_segment')
    expect(parent.children).toContain(sceneNode!.id)
    expect(AnyNode.safeParse(useScene.getState().nodes.sseg_measured_segment).success).toBe(true)
  })

  test('continuous distance mode starts the next segment from the committed endpoint', () => {
    const measurement = useMeasurementTool.getState()
    measurement.setContinuousMeasurement(true)
    measurement.begin('2d', [0, 0, 0])
    measurement.update([3, 0, 0])
    measurement.commit()

    const state = useMeasurementTool.getState()
    expect(state.segments).toHaveLength(1)
    expect(state.draft).toEqual({ start: [3, 0, 0], end: null, view: '2d' })
    expect(state.selectedId).toBe(state.segments[0]?.id ?? null)
  })

  test('updates a persistent segment length along its existing direction', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [0, 0, 0], [3, 0, 4])
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.updateSegmentLength(segmentId, 10)

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [6, 0, 8],
      measuredDistanceMeters: 10,
      view: '3d',
    })
  })

  test('updates a persistent segment endpoint and clears measured override', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [0, 0, 0], [3, 0, 4], 5)
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.startSegmentEndpointDrag(segmentId, 'end')
    measurement.updateSegmentEndpoint(segmentId, 'end', [6, 0, 8])
    measurement.endSegmentEndpointDrag()

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [6, 0, 8],
      measuredDistanceMeters: undefined,
      view: '3d',
    })
    expect(useMeasurementTool.getState().draggingSegmentEndpoint).toBeNull()
    expect(useMeasurementTool.getState().selectedId).toBe(segmentId)
  })

  test('moves every measurement endpoint sharing the dragged coordinate', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [0, 0, 0], [2, 0, 0], 2)
    const firstId = useMeasurementTool.getState().segments[0]!.id
    measurement.addSegment('3d', [2, 0, 0], [2, 0, 3], 3)
    const secondId = useMeasurementTool.getState().segments[1]!.id

    measurement.startSegmentEndpointDrag(firstId, 'end')
    measurement.updateSegmentEndpoint(firstId, 'end', [3, 0, 0])
    measurement.updateSegmentEndpoint(firstId, 'end', [4, 0, 0])
    measurement.endSegmentEndpointDrag()

    const segments = useMeasurementTool.getState().segments
    const first = segments.find((segment) => segment.id === firstId)
    const second = segments.find((segment) => segment.id === secondId)
    expect(first).toMatchObject({
      end: [4, 0, 0],
      measuredDistanceMeters: undefined,
    })
    expect(second).toMatchObject({
      start: [4, 0, 0],
      measuredDistanceMeters: undefined,
    })
    expect(distanceBetweenMeasurements(first!.start, first!.end)).toBe(4)
    expect(distanceBetweenMeasurements(second!.start, second!.end)).toBeCloseTo(Math.sqrt(13))
  })

  test('does not publish a segment endpoint update when the drag state is unchanged', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [0, 0, 0], [2, 0, 0], 2)
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.startSegmentEndpointDrag(segmentId, 'end')
    measurement.updateSegmentEndpoint(segmentId, 'end', [3, 0, 0])

    let publishCount = 0
    const unsubscribe = useMeasurementTool.subscribe(() => {
      publishCount += 1
    })

    measurement.updateSegmentEndpoint(segmentId, 'end', [3, 0, 0])

    unsubscribe()
    expect(publishCount).toBe(0)
  })

  test('Alt detaches a linked endpoint and release-time Alt state decides the final link', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [0, 0, 0], [2, 0, 0], 2)
    const firstId = useMeasurementTool.getState().segments[0]!.id
    measurement.addSegment('2d', [2, 0, 0], [2, 0, 3], 3)
    const secondId = useMeasurementTool.getState().segments[1]!.id

    measurement.startSegmentEndpointDrag(firstId, 'end')
    measurement.updateSegmentEndpoint(firstId, 'end', [3, 0, 0])
    expect(useMeasurementTool.getState().segments[1]).toMatchObject({
      measuredDistanceMeters: undefined,
      start: [3, 0, 0],
    })

    measurement.updateSegmentEndpoint(firstId, 'end', [4, 0, 0], true)
    expect(useMeasurementTool.getState().segments[1]).toMatchObject({
      measuredDistanceMeters: 3,
      start: [2, 0, 0],
    })

    measurement.updateSegmentEndpoint(firstId, 'end', [5, 0, 0], false)
    expect(useMeasurementTool.getState().segments[1]).toMatchObject({
      measuredDistanceMeters: undefined,
      start: [5, 0, 0],
    })

    measurement.endSegmentEndpointDrag({ detachLinkedEndpoints: true })

    const segments = useMeasurementTool.getState().segments
    expect(segments.find((segment) => segment.id === firstId)).toMatchObject({
      end: [5, 0, 0],
      measuredDistanceMeters: undefined,
    })
    expect(segments.find((segment) => segment.id === secondId)).toMatchObject({
      measuredDistanceMeters: 3,
      start: [2, 0, 0],
    })
  })

  test('moves linked endpoint attachments together and restores them when Alt detaches', () => {
    const measurement = useMeasurementTool.getState()
    const originalAttachment = {
      feature: { index: 0, kind: 'plan-anchor' as const },
      nodeId: 'original-node',
    }
    const nextAttachment = {
      feature: { index: 2, kind: 'plan-anchor' as const },
      nodeId: 'next-node',
    }
    measurement.addSegment('2d', [0, 0, 0], [2, 0, 0], 2, undefined, originalAttachment)
    const firstId = useMeasurementTool.getState().segments[0]!.id
    measurement.addSegment('2d', [2, 0, 0], [2, 0, 3], 3, originalAttachment, undefined)

    measurement.startSegmentEndpointDrag(firstId, 'end')
    measurement.updateSegmentEndpoint(firstId, 'end', [4, 0, 0], false, nextAttachment)
    expect(useMeasurementTool.getState().segments).toMatchObject([
      { endAttachment: nextAttachment },
      { startAttachment: nextAttachment },
    ])

    measurement.updateSegmentEndpoint(firstId, 'end', [5, 0, 0], true, null)
    expect(useMeasurementTool.getState().segments).toMatchObject([
      { endAttachment: undefined },
      { startAttachment: originalAttachment },
    ])
  })

  test('does not link measurement endpoints separated by elevation', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [0, 0, 0], [2, 0, 0])
    const firstId = useMeasurementTool.getState().segments[0]!.id
    measurement.addSegment('3d', [2, 1, 0], [2, 1, 3])
    const secondId = useMeasurementTool.getState().segments[1]!.id

    measurement.startSegmentEndpointDrag(firstId, 'end')
    measurement.updateSegmentEndpoint(firstId, 'end', [4, 0, 0])
    measurement.endSegmentEndpointDrag()

    expect(
      useMeasurementTool.getState().segments.find((segment) => segment.id === secondId)?.start,
    ).toEqual([2, 1, 0])
  })

  test('cancelDraft clears an active segment endpoint drag', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [0, 0, 0], [3, 0, 4])
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.startSegmentEndpointDrag(segmentId, 'start')
    measurement.cancelDraft()

    expect(useMeasurementTool.getState().draggingSegmentEndpoint).toBeNull()
    expect(useMeasurementTool.getState().segments).toHaveLength(1)
  })

  test('cancelDraft preserves committed measurements while clearing transient state', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [0, 0, 0], [1, 0, 0])
    measurement.begin('2d', [2, 0, 0])
    measurement.update([3, 0, 0])
    measurement.setCursor('2d', [3, 0, 0])
    measurement.setSnapTarget({ label: 'Grid', point: [3, 0, 0], view: '2d' })
    measurement.setPreviewSegment({
      id: 'measurement-preview',
      start: [4, 0, 0],
      end: [5, 0, 0],
      view: '2d',
    })
    measurement.setPreviewArea({
      id: 'measurement-area-preview',
      areaSquareMeters: 4,
      labelPoint: [0, 0, 0],
      view: '2d',
    })
    measurement.setPreviewPerimeter({
      id: 'measurement-perimeter-preview',
      labelPoint: [0, 0, 0],
      lengthMeters: 8,
      view: '2d',
    })

    measurement.cancelDraft()

    expect(useMeasurementTool.getState()).toMatchObject({
      cursor: null,
      draft: null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      snapTarget: null,
    })
    expect(useMeasurementTool.getState().segments).toHaveLength(1)
  })

  test('updates an active draft length along its current direction', () => {
    const measurement = useMeasurementTool.getState()
    measurement.begin('3d', [0, 0, 0])
    measurement.update([3, 0, 4])

    measurement.updateDraftLength(10)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      end: [6, 0, 8],
      view: '3d',
    })
  })

  test('updates a 2D active draft length and commits the exact endpoint', () => {
    const measurement = useMeasurementTool.getState()
    measurement.begin('2d', [1, 0, 1])
    measurement.update([1, 0, 3])

    measurement.updateDraftLength(5)
    measurement.commit()

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [1, 0, 1],
      end: [1, 0, 6],
      view: '2d',
    })
  })

  test('updates an active angle draft to an exact angle', () => {
    const measurement = useMeasurementTool.getState()
    measurement.beginAngle('2d', [0, 0, 0])
    measurement.updateAngle([0, 0, 1])

    measurement.updateAngleDegrees(45)
    measurement.commitAngle()

    const angle = useMeasurementTool.getState().angles[0]
    expect(angle?.first).toEqual([1, 0, 0])
    expect(angle?.vertex).toEqual([0, 0, 0])
    expect(angle?.second[0]).toBeCloseTo(Math.SQRT1_2)
    expect(angle?.second[1]).toBeCloseTo(0)
    expect(angle?.second[2]).toBeCloseTo(Math.SQRT1_2)
  })

  test('updates a persistent angle measurement to an exact angle', () => {
    const measurement = useMeasurementTool.getState()
    measurement.beginAngle('3d', [0, 0, 0])
    measurement.commitAngle([0, 0, 1])
    const angleId = useMeasurementTool.getState().angles[0]!.id

    measurement.updateAngleMeasurementDegrees(angleId, 45)

    const angle = useMeasurementTool.getState().angles[0]
    expect(angle?.first).toEqual([1, 0, 0])
    expect(angle?.vertex).toEqual([0, 0, 0])
    expect(angle?.second[0]).toBeCloseTo(Math.SQRT1_2)
    expect(angle?.second[1]).toBeCloseTo(0)
    expect(angle?.second[2]).toBeCloseTo(Math.SQRT1_2)
  })

  test('clear does not reset display preferences', () => {
    const measurement = useMeasurementTool.getState()
    measurement.setContinuousMeasurement(true)
    measurement.setDisplayPrecision('fine')
    measurement.setSnapKindEnabled('grid', false)
    measurement.addSegment('2d', [0, 0, 0], [1, 0, 0])

    measurement.clear()

    expect(useMeasurementTool.getState().continuousMeasurement).toBe(true)
    expect(useMeasurementTool.getState().displayPrecision).toBe('fine')
    expect(useMeasurementTool.getState().enabledSnapKinds.grid).toBe(false)
  })

  test('toggles individual snap families and clears a disabled active target', () => {
    const measurement = useMeasurementTool.getState()
    measurement.setSnapTarget({ kind: 'grid', label: 'Grid', point: [1, 0, 1], view: '2d' })

    measurement.setSnapKindEnabled('grid', false)

    expect(useMeasurementTool.getState().enabledSnapKinds.grid).toBe(false)
    expect(useMeasurementTool.getState().snapTarget).toBeNull()

    measurement.setSnapKindEnabled('grid', true)

    expect(useMeasurementTool.getState().enabledSnapKinds.grid).toBe(true)
  })

  test('sets all snap families and resets defaults', () => {
    const measurement = useMeasurementTool.getState()
    measurement.setSnapTarget({ kind: 'edge', label: 'Edge', point: [1, 0, 1], view: '2d' })

    measurement.setAllSnapKindsEnabled(false)

    expect(Object.values(useMeasurementTool.getState().enabledSnapKinds).every(Boolean)).toBe(false)
    expect(useMeasurementTool.getState().snapTarget).toBeNull()

    measurement.setAllSnapKindsEnabled(true)

    expect(Object.values(useMeasurementTool.getState().enabledSnapKinds).every(Boolean)).toBe(true)

    measurement.setSnapKindEnabled('grid', false)
    measurement.resetSnapKinds()

    expect(useMeasurementTool.getState().enabledSnapKinds).toEqual(
      DEFAULT_MEASUREMENT_SNAP_SETTINGS,
    )
  })

  test('adds every direct measurement kind and deletes the selected row', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [0, 0, 0], [2, 0, 0], 2)
    measurement.addArea('3d', [1, 0, 1], 12)
    measurement.addPerimeter('3d', [1, 0, 1], 14)
    measurement.beginAngle('3d', [0, 0, 0])
    measurement.commitAngle([0, 0, 1])

    const beforeDelete = useMeasurementTool.getState()
    expect(beforeDelete.segments).toHaveLength(1)
    expect(beforeDelete.areas).toHaveLength(1)
    expect(beforeDelete.perimeters).toHaveLength(1)
    expect(beforeDelete.angles).toHaveLength(1)
    expect(beforeDelete.selectedId).toBe(beforeDelete.angles[0]?.id ?? null)

    useMeasurementTool.getState().deleteSelected()
    const afterDelete = useMeasurementTool.getState()
    expect(afterDelete.angles).toHaveLength(0)
    expect(afterDelete.segments).toHaveLength(1)
    expect(afterDelete.areas).toHaveLength(1)
    expect(afterDelete.perimeters).toHaveLength(1)
    expect(afterDelete.selectedId).toBeNull()
  })

  test('commits freeform polygon drafts as area or perimeter measurements', () => {
    const measurement = useMeasurementTool.getState()

    measurement.setMode('area')
    measurement.beginPolygon('2d', [0, 0, 0])
    measurement.addPolygonPoint([4, 0, 0])
    measurement.addPolygonPoint([4, 0, 3])
    measurement.commitPolygon()

    expect(useMeasurementTool.getState().areas[0]).toMatchObject({
      areaSquareMeters: 6,
      boundaryPoints: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 3],
      ],
      labelPoint: [2.6666666666666665, 0, 1],
      view: '2d',
    })

    measurement.setMode('perimeter')
    measurement.beginPolygon('3d', [0, 0, 0])
    measurement.addPolygonPoint([4, 0, 0])
    measurement.addPolygonPoint([4, 0, 3])
    measurement.commitPolygon()

    expect(useMeasurementTool.getState().perimeters[0]).toMatchObject({
      lengthMeters: 12,
      labelPoint: [2.6666666666666665, 0, 1],
      view: '3d',
    })
  })

  test('clear removes drafts, cursor, selection, and all measurement collections', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [0, 0, 0], [1, 0, 0])
    measurement.addArea('2d', [0, 0, 0], 8)
    measurement.addPerimeter('2d', [0, 0, 0], 12)
    measurement.beginAngle('2d', [0, 0, 0])
    measurement.updateAngle([0, 0, 1])
    measurement.begin('2d', [0, 0, 0])
    measurement.update([0, 0, 2])
    measurement.setCursor('2d', [0, 0, 2])
    measurement.setSnapTarget({ label: 'Endpoint', point: [0, 0, 2], view: '2d' })

    measurement.clear()

    expect(useMeasurementTool.getState()).toMatchObject({
      angleDraft: null,
      angles: [],
      areas: [],
      cursor: null,
      draft: null,
      perimeters: [],
      selectedId: null,
      segments: [],
      snapTarget: null,
    })
  })

  test('mode changes cancel in-flight drafts and preserve measurement collections', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [0, 0, 0], [1, 0, 0])
    measurement.begin('2d', [0, 0, 0])
    measurement.update([0, 0, 2])
    measurement.setMode('angle')

    expect(useMeasurementTool.getState().mode).toBe('angle')
    expect(useMeasurementTool.getState().draft).toBeNull()
    expect(useMeasurementTool.getState().angleDraft).toBeNull()
    expect(useMeasurementTool.getState().snapTarget).toBeNull()
    expect(useMeasurementTool.getState().segments).toHaveLength(1)
    expect(useMeasurementTool.getState().selectedId).toBeNull()
  })

  test('serializes and hydrates committed measurements without transient draft state', () => {
    const measurement = useMeasurementTool.getState()
    const startAttachment = {
      feature: { index: 1, kind: 'plan-anchor' as const },
      nodeId: 'persisted-node',
    }
    measurement.addSegment('2d', [0, 0, 0], [1, 0, 0], undefined, startAttachment)
    measurement.addArea('3d', [0.5, 0, 0.5], 6, [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ])
    measurement.addPerimeter('3d', [0.5, 0, 0.5], 10)
    measurement.beginAngle('2d', [0, 0, 0])
    measurement.commitAngle([0, 0, 1])
    measurement.begin('2d', [0, 0, 0])
    measurement.update([0, 0, 2])
    measurement.setCursor('2d', [0, 0, 2])

    const persisted = serializeMeasurements()
    useMeasurementTool.getState().clear()
    hydrateMeasurements(persisted)

    expect(useMeasurementTool.getState()).toMatchObject({
      angleDraft: null,
      areas: persisted.areas,
      cursor: null,
      draft: null,
      perimeters: persisted.perimeters,
      selectedId: null,
      segments: persisted.segments,
    })
    expect(useMeasurementTool.getState().angles).toEqual(persisted.angles)
    expect(useMeasurementTool.getState().segments[0]?.startAttachment).toEqual(startAttachment)
  })

  test('hydrates legacy surface perimeters with display boundary points', () => {
    const zone = zoneNode()
    useScene.getState().setScene({ [zone.id]: zone } as never, [zone.id] as never)

    hydrateMeasurements({
      version: 1,
      segments: [],
      areas: [],
      perimeters: [
        {
          id: 'measurement-perimeter-legacy-2d',
          labelPoint: [2, 0, 1.5],
          lengthMeters: 14,
          view: '2d',
        },
        {
          id: 'measurement-perimeter-legacy-3d',
          labelPoint: [2, 0.05, 1.5],
          lengthMeters: 14,
          view: '3d',
        },
      ],
      angles: [],
    })

    expect(useMeasurementTool.getState().perimeters).toMatchObject([
      {
        boundaryPoints: [
          [0, 0, 0],
          [4, 0, 0],
          [4, 0, 3],
          [0, 0, 3],
        ],
        id: 'measurement-perimeter-legacy-2d',
      },
      {
        boundaryPoints: [
          [0, 0.02, 0],
          [4, 0.02, 0],
          [4, 0.02, 3],
          [0, 0.02, 3],
        ],
        id: 'measurement-perimeter-legacy-3d',
      },
    ])
  })

  test('normalizes invalid persisted measurement entries', () => {
    const persisted = normalizePersistedMeasurements({
      segments: [
        { id: 'measurement-1', start: [0, 0, 0], end: [1, 0, 0], view: '2d' },
        { id: 'bad-segment', start: [0, 0], end: [1, 0, 0], view: '2d' },
      ],
      areas: [
        {
          id: 'measurement-area-2',
          areaSquareMeters: 8,
          boundaryPoints: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 0, 1],
          ],
          labelPoint: [0, 0, 0],
          view: '3d',
        },
        { id: 'bad-area', areaSquareMeters: Number.NaN, labelPoint: [0, 0, 0], view: '3d' },
      ],
      perimeters: [
        {
          id: 'measurement-perimeter-3',
          labelPoint: [0, 0, 0],
          lengthMeters: 12,
          view: '2d',
        },
        { id: 'bad-perimeter', labelPoint: [0, 0, 0], lengthMeters: 12, view: 'side' },
      ],
      angles: [
        {
          id: 'measurement-angle-4',
          first: [1, 0, 0],
          vertex: [0, 0, 0],
          second: [0, 0, 1],
          view: '3d',
        },
        {
          id: 'bad-angle',
          first: [1, 0, 0],
          vertex: [0, 0, 0],
          second: ['x', 0, 1],
          view: '3d',
        },
      ],
    })

    expect(persisted.segments).toHaveLength(1)
    expect(persisted.areas).toHaveLength(1)
    expect(persisted.areas[0]?.boundaryPoints).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ])
    expect(persisted.perimeters).toHaveLength(1)
    expect(persisted.angles).toHaveLength(1)
  })
})
