import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeId,
  FloorplanAffordanceSession,
  FloorplanGeometry,
  LiveNodeOverrides,
} from '@pascal-app/core'
import { type AnyNodeDefinition, emitter, nodeRegistry, registerNode } from '@pascal-app/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { z } from 'zod'
import {
  FLOORPLAN_NODE_EXTENSION_KEY,
  floorplanGeometryMetadata,
} from '../../../lib/floorplan/floorplan-extension'
import {
  cancelFloorplanAffordanceDrag,
  collectFloorplanDependencyNodes,
  collectFloorplanLinkedLevelNodes,
  computeAffectedSiblingIds,
  floorplanHandleDoubleClickAffordance,
  InteractiveGeometry,
  splitFloorplanOverlay,
  subscribeFloorplanAffordanceToolCancel,
} from './floorplan-registry-layer'

function cabinetRun(id: string, children: string[] = [], parentId: string | null = 'level_test') {
  return {
    id,
    type: 'cabinet',
    object: 'node',
    parentId,
    visible: true,
    metadata: {},
    children,
    position: [0, 0, 0],
    rotation: 0,
    width: 1.2,
    depth: 0.58,
    carcassHeight: 0.72,
    plinthHeight: 0.1,
    showPlinth: true,
    withCountertop: true,
    countertopThickness: 0.02,
  } as AnyNode
}

function cabinetModule(id: string, parentId: string, children: string[] = []) {
  return {
    id,
    type: 'cabinet-module',
    object: 'node',
    parentId,
    visible: true,
    metadata: {},
    children,
    position: [0, 0.1, 0],
    rotation: 0,
    width: 0.6,
    depth: 0.58,
    carcassHeight: 0.72,
    plinthHeight: 0.1,
    showPlinth: true,
    countertopThickness: 0.02,
  } as AnyNode
}

function isCabinetNode(node: AnyNode | undefined): boolean {
  return node?.type === 'cabinet' || node?.type === 'cabinet-module'
}

function childIdsOf(node: AnyNode | undefined): AnyNodeId[] {
  return Array.isArray((node as { children?: unknown } | undefined)?.children)
    ? ((node as { children: AnyNodeId[] }).children ?? [])
    : []
}

function cabinetAffectedIds({
  node,
  nodes,
  liveOverrides,
}: {
  node: AnyNode
  nodes: Record<AnyNodeId, AnyNode>
  liveOverrides: Map<string, Record<string, unknown>>
}): readonly AnyNodeId[] {
  const affected = new Set<AnyNodeId>()
  const visited = new Set<AnyNodeId>()
  const queue: AnyNodeId[] = [node.id as AnyNodeId]

  while (queue.length > 0) {
    const id = queue.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const current = nodes[id]
    if (!isCabinetNode(current)) continue
    affected.add(id)

    const parentIds = [
      current?.parentId as AnyNodeId | undefined,
      (liveOverrides.get(id) as { parentId?: AnyNodeId } | undefined)?.parentId,
    ]
    for (const parentId of parentIds) {
      const parent = parentId ? nodes[parentId] : undefined
      if (parentId && isCabinetNode(parent)) queue.push(parentId)
    }
    for (const childId of childIdsOf(current)) {
      if (isCabinetNode(nodes[childId])) queue.push(childId)
    }
  }

  return Array.from(affected)
}

function registerCabinetFloorplanDefinition(kind: 'cabinet' | 'cabinet-module') {
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as never,
    category: 'utility',
    defaults: () => ({}) as never,
    floorplanAffectedIds: cabinetAffectedIds,
  } as unknown as AnyNodeDefinition)
}

describe('floorplan affordance cancellation', () => {
  test('tool:cancel reverts the drag and makes a later pointerup inert', () => {
    const releasePointerCapture = mock(() => {})
    const commit = mock(() => {})
    const session: FloorplanAffordanceSession = {
      affectedIds: ['wall_a', 'wall_b'],
      apply: () => {},
      canCommit: () => true,
      commit,
    }
    const snapshots = [{ id: 'wall_a' as AnyNodeId, data: { width: 1 } }]
    const drag = {
      pointerId: 7,
      captureTarget: {
        hasPointerCapture: mock(() => true),
        releasePointerCapture,
      } as unknown as Element,
      handleId: 'wall_a:endpoint',
      session,
      snapshots,
      historyPaused: true,
      lastPlanPoint: [0, 0] as [number, number],
    }
    const dragRef = { current: drag }
    const restoreSnapshots = mock(() => {})
    const resumeHistory = mock(() => {})
    const clearPreview = mock(() => {})
    const clearSnapFeedback = mock(() => {})
    const endReshapeScope = mock(() => {})
    const clearDragFeedback = mock(() => {})
    const consumeToolCancel = mock(() => {})

    const unsubscribe = subscribeFloorplanAffordanceToolCancel(
      () =>
        cancelFloorplanAffordanceDrag(dragRef, {
          restoreSnapshots,
          resumeHistory,
          clearPreview,
          clearSnapFeedback,
          endReshapeScope,
          clearDragFeedback,
        }),
      consumeToolCancel,
    )

    try {
      emitter.emit('tool:cancel')
      emitter.emit('tool:cancel')
    } finally {
      unsubscribe()
    }

    expect(dragRef.current).toBeNull()
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(restoreSnapshots).toHaveBeenCalledWith(snapshots)
    expect(resumeHistory).toHaveBeenCalledTimes(1)
    expect(clearPreview).toHaveBeenCalledTimes(2)
    expect(clearPreview).toHaveBeenNthCalledWith(1, 'wall_a')
    expect(clearPreview).toHaveBeenNthCalledWith(2, 'wall_b')
    expect(clearSnapFeedback).toHaveBeenCalledTimes(1)
    expect(endReshapeScope).toHaveBeenCalledWith(drag)
    expect(clearDragFeedback).toHaveBeenCalledTimes(1)
    expect(consumeToolCancel).toHaveBeenCalledTimes(1)
    expect(drag.historyPaused).toBe(false)

    const activeDrag = dragRef.current
    if (activeDrag?.pointerId === 7) activeDrag.session.commit?.()
    expect(commit).toHaveBeenCalledTimes(0)
  })
})

describe('floorplan vertex double-click routing', () => {
  test('routes polygon vertex handles to the kind-owned delete affordance', () => {
    expect(
      floorplanHandleDoubleClickAffordance({
        kind: 'endpoint-handle',
        point: [1, 2],
        state: 'idle',
        affordance: 'move-vertex',
        payload: { vertexIndex: 2 },
      }),
    ).toBe('delete-vertex')

    expect(
      floorplanHandleDoubleClickAffordance({
        kind: 'endpoint-handle',
        point: [1, 2],
        state: 'idle',
        affordance: 'move-endpoint',
        payload: { endpoint: 'end' },
      }),
    ).toBeNull()
  })
})

describe('floorplan annotation overlay routing', () => {
  test('keeps automatic dimension strings left-to-right and top-to-bottom after rotation', () => {
    const noop = () => {}
    const renderAt180Degrees = (geometry: FloorplanGeometry) =>
      renderToStaticMarkup(
        createElement(
          'svg',
          null,
          createElement(InteractiveGeometry, {
            activeDragId: null,
            activeRotateNodeId: null,
            geometry,
            hatchPatternId: undefined,
            hoveredHandleId: null,
            isMarqueeSelectionActive: false,
            nodeId: 'wall_test' as AnyNodeId,
            onHandleDoubleClick: noop,
            onHandleHoverChange: noop,
            onHandlePointerDown: noop,
            onMoveHandlePointerDown: noop,
            palette: undefined,
            sceneRotationDeg: 180,
            unitsPerPixel: 0.01,
          }),
        ),
      )
    const dimensionString = (
      end: readonly [number, number],
      offsetNormal: readonly [number, number],
    ): FloorplanGeometry => ({
      kind: 'dimension-string',
      segments: [{ start: [0, 0], end, text: '2m' }],
      offsetNormal,
      offsetDistance: 0.55,
      extensionOvershoot: 0.12,
      textPosition: 'above',
    })

    expect(renderAt180Degrees(dimensionString([2, 0], [0, 1]))).toContain('rotate(-180)')
    expect(renderAt180Degrees(dimensionString([0, 2], [1, 0]))).toContain('rotate(-90)')
  })

  test('keeps a fixed mark pill together in the overlay pass', () => {
    const mark = {
      kind: 'group',
      metadata: floorplanGeometryMetadata({ annotationRole: 'opening-mark' }),
      children: [
        { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0.4 },
        { kind: 'rect', x: -0.2, y: 0.4, width: 0.4, height: 0.32 },
        { kind: 'text', x: 0, y: 0.56, text: '107', fontSize: 0.15, upright: true },
      ],
    } satisfies FloorplanGeometry

    expect(splitFloorplanOverlay(mark)).toEqual({ base: null, overlay: mark })
  })

  test('keeps fixed annotation symbols in the overlay pass for collision layout', () => {
    const columnCenter = {
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      metadata: floorplanGeometryMetadata({ annotationRole: 'column-center' }),
    } satisfies FloorplanGeometry

    expect(splitFloorplanOverlay(columnCenter)).toEqual({ base: null, overlay: columnCenter })
  })
})

describe('computeAffectedSiblingIds', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    registerCabinetFloorplanDefinition('cabinet')
    registerCabinetFloorplanDefinition('cabinet-module')
  })

  test('propagates cabinet live overrides through the cabinet family', () => {
    const run = cabinetRun('cabinet_run', ['cabinet-module_main', 'cabinet-module_corner'])
    const module = cabinetModule('cabinet-module_main', run.id)
    const cornerModule = cabinetModule('cabinet-module_corner', run.id, ['cabinet_child-run'])
    const childRun = cabinetRun('cabinet_child-run', ['cabinet-module_child'], cornerModule.id)
    const childModule = cabinetModule('cabinet-module_child', childRun.id)
    const nodes = {
      [run.id]: run,
      [module.id]: module,
      [cornerModule.id]: cornerModule,
      [childRun.id]: childRun,
      [childModule.id]: childModule,
    } as Record<string, AnyNode>

    const affected = computeAffectedSiblingIds(
      [run.id as AnyNodeId],
      nodes,
      new Map([[run.id, { position: [2, 0, 3] }]]),
    )

    expect(affected).toEqual(
      new Set([run.id, module.id, cornerModule.id, childRun.id, childModule.id] as AnyNodeId[]),
    )
  })

  test('propagates a live-moving cabinet module back to its owning run', () => {
    const run = cabinetRun('cabinet_run', ['cabinet-module_main', 'cabinet-module_child'])
    const module = cabinetModule('cabinet-module_main', run.id)
    const sibling = cabinetModule('cabinet-module_child', run.id)
    const nodes = {
      [run.id]: run,
      [module.id]: module,
      [sibling.id]: sibling,
    } as Record<string, AnyNode>

    const affected = computeAffectedSiblingIds(
      [module.id as AnyNodeId],
      nodes,
      new Map([[module.id, { position: [1.2, 0.1, 0.3] }]]),
    )

    expect(affected).toEqual(new Set([module.id, run.id, sibling.id] as AnyNodeId[]))
  })
})

describe('collectFloorplanDependencyNodes', () => {
  test('includes referenced hosts and their transform-owning parents', () => {
    const level = {
      id: 'level_test',
      type: 'level',
      parentId: null,
      children: ['roof_test'],
    } as unknown as AnyNode
    const roof = {
      id: 'roof_test',
      type: 'roof',
      parentId: level.id,
      children: [],
      position: [0, 0, 0],
      rotation: 0,
    } as unknown as AnyNode
    const measurement = {
      id: 'measurement_test',
      type: 'measurement',
      parentId: level.id,
    } as unknown as AnyNode
    const definition = {
      floorplanDependencies: () => [roof.id],
    } as unknown as AnyNodeDefinition

    expect(
      collectFloorplanDependencyNodes(
        definition,
        measurement,
        {
          [level.id]: level,
          [roof.id]: roof,
          [measurement.id]: measurement,
        },
        new Map<string, LiveNodeOverrides>([
          [roof.id, { position: [3, 0, 2] }],
          [level.id, { visible: false }],
        ]),
      ),
    ).toEqual([
      expect.objectContaining({ id: roof.id, position: [3, 0, 2] }),
      expect.objectContaining({ id: level.id, visible: false }),
    ])
  })
})

describe('collectFloorplanLinkedLevelNodes', () => {
  test('projects a node onto a linked destination level with its real children', () => {
    nodeRegistry._reset()
    registerNode({
      kind: 'linked-floorplan-test',
      schemaVersion: 1,
      schema: z.object({ type: z.literal('linked-floorplan-test') }) as never,
      category: 'structure',
      defaults: () => ({}) as never,
      floorplan: () => null,
      extensions: {
        [FLOORPLAN_NODE_EXTENSION_KEY]: {
          linkedLevelIds: () => ['level_upper' as AnyNodeId],
        },
      },
    } as unknown as AnyNodeDefinition)
    const child = {
      id: 'linked_child',
      type: 'linked-child',
      parentId: 'linked_parent',
    } as unknown as AnyNode
    const parent = {
      id: 'linked_parent',
      type: 'linked-floorplan-test',
      parentId: 'level_lower',
      children: [child.id],
    } as unknown as AnyNode
    const nodes = { [parent.id]: parent, [child.id]: child }

    expect(collectFloorplanLinkedLevelNodes(nodes, 'level_upper' as AnyNodeId)).toEqual([
      { id: parent.id, node: parent, children: [child] },
    ])
    expect(
      collectFloorplanLinkedLevelNodes(
        nodes,
        'level_upper' as AnyNodeId,
        new Set([parent.id as AnyNodeId]),
      ),
    ).toEqual([])
  })
})
