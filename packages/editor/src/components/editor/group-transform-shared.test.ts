import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  CeilingNode,
  clearSceneHistory,
  getSceneHistoryPauseDepth,
  LevelNode,
  nodeRegistry,
  registerNode,
  SlabNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { BoxGeometry, Group, Mesh } from 'three'
import { z } from 'zod'
import { getEditorClipboardSnapshot } from '../../lib/scene-clipboard'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { startFloorplanGroupRotate, useFloorplanGroupDrag } from '../editor-2d/floorplan-group-move'
import { startGroupPickUp } from './group-actions'
import {
  classifyParticipant,
  collectParticipants,
  computeGroupPlanBox,
  groupPlanBounds,
  planBoundsCenter,
  rotateGroupPatches,
  rotateGroupSnapshots,
  rotatePlanBounds,
  translateGroupPatches,
} from './group-transform-shared'

const BUILDING_SCOPED_KIND = 'group-transform-building-scoped-test'

function registerBuildingScopedTestKind() {
  if (nodeRegistry.has(BUILDING_SCOPED_KIND)) return

  registerNode({
    kind: BUILDING_SCOPED_KIND,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(BUILDING_SCOPED_KIND) }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: {},
    floorplanScope: 'building',
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

function registerElevatorTestKind() {
  if (nodeRegistry.has('elevator')) return

  registerNode({
    kind: 'elevator',
    schemaVersion: 1,
    schema: z.object({ type: z.literal('elevator') }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: { selectable: {} },
    floorplanScope: 'building',
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

// A level holding one of each rigid placement shape: an item ([x,y,z] rotation)
// and a column (numeric rotation).
function placedNodes() {
  return {
    building_test: { id: 'building_test', type: 'building', children: ['level_test'] },
    level_test: {
      id: 'level_test',
      type: 'level',
      parentId: 'building_test',
      children: ['item_chair', 'column_post'],
    },
    item_chair: {
      id: 'item_chair',
      type: 'item',
      parentId: 'level_test',
      position: [1, 0, 3],
      rotation: [0, 0.5, 0],
    },
    column_post: {
      id: 'column_post',
      type: 'column',
      parentId: 'level_test',
      position: [4, 0, -1],
      rotation: 1.25,
    },
  } as unknown as Record<string, AnyNode>
}

describe('group transform participants', () => {
  beforeAll(() => {
    registerBuildingScopedTestKind()
    registerElevatorTestKind()
  })

  test('includes building-scoped positioned nodes for the active level building', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: BUILDING_SCOPED_KIND,
        parentId: 'building_test',
        position: [1, 0, 2],
        rotation: 0,
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')

    const participants = collectParticipants(['elevator_test'], nodes, 'level_test')
    expect(participants.starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [1, 0, 2],
        rotation: 0,
      },
    ])
  })

  test('excludes building-scoped positioned nodes from other buildings', () => {
    const nodes = {
      building_active: {
        id: 'building_active',
        type: 'building',
        children: ['level_test'],
      },
      building_other: {
        id: 'building_other',
        type: 'building',
        children: ['elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_active',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: BUILDING_SCOPED_KIND,
        parentId: 'building_other',
        position: [1, 0, 2],
        rotation: 0,
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBeNull()
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([])
  })

  test('uses current elevator defaults for legacy elevators with no saved rotation', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'building_test',
        position: [3, 0, 4],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [3, 0, 4],
        rotation: 0,
      },
    ])
  })

  test('resolves building-scoped elevators when legacy level parentId is missing', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: null,
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'building_test',
        position: [7, 0, 8],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [7, 0, 8],
        rotation: 0,
      },
    ])
  })

  test('classifies and transforms polygon kinds (slab / ceiling / zone)', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: ['slab_test', 'zone_test'],
      },
      slab_test: {
        id: 'slab_test',
        type: 'slab',
        parentId: 'level_test',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
        holes: [
          [
            [0.5, 0.5],
            [1, 0.5],
            [1, 1],
          ],
        ],
      },
      zone_test: {
        id: 'zone_test',
        type: 'zone',
        parentId: 'level_test',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
      slab_elsewhere: {
        id: 'slab_elsewhere',
        type: 'slab',
        parentId: 'level_other',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.slab_test, 'level_test', nodes)).toBe('polygon')
    expect(classifyParticipant(nodes.zone_test, 'level_test', nodes)).toBe('polygon')
    // Not in the active level frame → excluded.
    expect(classifyParticipant(nodes.slab_elsewhere, 'level_test', nodes)).toBeNull()

    const { starts, links } = collectParticipants(['slab_test', 'zone_test'], nodes, 'level_test')
    expect(links).toEqual([])
    expect(starts).toEqual([
      {
        id: 'slab_test',
        kind: 'polygon',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
        holes: [
          [
            [0.5, 0.5],
            [1, 0.5],
            [1, 1],
          ],
        ],
      },
      {
        id: 'zone_test',
        kind: 'polygon',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        holes: null,
      },
    ])

    // Translate: every vertex (holes included) shifts; the hole-less zone's
    // patch never grows a `holes` field.
    const moved = translateGroupPatches(starts, [], 1, -2)
    expect(moved).toEqual([
      [
        'slab_test',
        {
          polygon: [
            [1, -2],
            [3, -2],
            [3, 0],
            [1, 0],
          ],
          holes: [
            [
              [1.5, -1.5],
              [2, -1.5],
              [2, -1],
            ],
          ],
        },
      ],
      [
        'zone_test',
        {
          polygon: [
            [1, -2],
            [2, -2],
            [2, -1],
          ],
        },
      ],
    ])

    // Rotate 90° in the atan2 x→z sense around the origin: (x, z) → (-z, x).
    const rotated = rotateGroupPatches(
      starts.filter((s) => s.id === 'zone_test'),
      [],
      { x: 0, z: 0 },
      Math.PI / 2,
    )
    expect(rotated).toHaveLength(1)
    const rotatedPolygon = (rotated[0]![1] as { polygon: [number, number][] }).polygon
    const expected = [
      [0, 0],
      [0, 1],
      [-1, 1],
    ]
    rotatedPolygon.forEach((point, i) => {
      expect(point[0]).toBeCloseTo(expected[i]![0]!)
      expect(point[1]).toBeCloseTo(expected[i]![1]!)
    })
  })

  test('polygon hosts carry their attached positioned children (ceiling items)', () => {
    const nodes = {
      building_test: { id: 'building_test', type: 'building', children: ['level_test'] },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: ['ceiling_test'],
      },
      ceiling_test: {
        id: 'ceiling_test',
        type: 'ceiling',
        parentId: 'level_test',
        children: ['item_lamp'],
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      },
      item_lamp: {
        id: 'item_lamp',
        type: 'item',
        parentId: 'ceiling_test',
        position: [1, 2.4, 1],
        rotation: [0, 0.5, 0],
      },
    } as unknown as Record<string, AnyNode>

    // The lamp itself is not level-parented, so it is not an independent
    // participant — it rides its host ceiling.
    expect(classifyParticipant(nodes.item_lamp, 'level_test', nodes)).toBeNull()

    const { starts } = collectParticipants(['ceiling_test'], nodes, 'level_test')
    expect(starts.map((s) => s.id).sort()).toEqual(['ceiling_test', 'item_lamp'])

    const moved = translateGroupPatches(starts, [], 2, 1)
    const lampPatch = Object.fromEntries(moved).item_lamp as { position: [number, number, number] }
    expect(lampPatch.position).toEqual([3, 2.4, 2])
  })

  test('translate patches carry the snapshot rotation for vec3 and scalar kinds', () => {
    const { starts } = collectParticipants(
      ['item_chair', 'column_post'],
      placedNodes(),
      'level_test',
    )
    const patches = Object.fromEntries(translateGroupPatches(starts, [], 1, 2))

    expect(patches.item_chair).toEqual({ position: [2, 0, 5], rotation: [0, 0.5, 0] })
    expect(patches.column_post).toEqual({ position: [5, 0, 1], rotation: 1.25 })
  })

  test('a mid-drag rotation survives the next translate re-publish', () => {
    const { starts } = collectParticipants(
      ['item_chair', 'column_post'],
      placedNodes(),
      'level_test',
    )
    // What a mid-drag R does: turn the snapshots, then re-apply the live delta.
    const rotated = rotateGroupSnapshots(starts, [], { x: 0, z: 0 }, Math.PI / 2)
    const patches = Object.fromEntries(
      translateGroupPatches(rotated.starts, rotated.links, 1, 2),
    ) as Record<string, { position: number[]; rotation: number[] | number }>

    // Orbited 90° in the atan2 x→z sense ((x, z) → (-z, x)), then slid.
    expect(patches.item_chair!.position[0]).toBeCloseTo(-2)
    expect(patches.item_chair!.position[2]).toBeCloseTo(3)
    expect(patches.column_post!.position[0]).toBeCloseTo(2)
    expect(patches.column_post!.position[2]).toBeCloseTo(6)
    // …and the facings turned with it instead of reverting to the pre-drag yaw.
    expect((patches.item_chair!.rotation as number[])[1]).toBeCloseTo(0.5 - Math.PI / 2)
    expect(patches.column_post!.rotation as number).toBeCloseTo(1.25 - Math.PI / 2)
  })

  test('rotating the plan bounds keeps the footprint centred on the pivot', () => {
    const bounds = { minX: 0, minZ: 0, maxX: 4, maxZ: 2 }
    const [pivotX, pivotZ] = planBoundsCenter(bounds)
    const rotated = rotatePlanBounds(bounds, { x: pivotX, z: pivotZ }, Math.PI / 2)

    expect(rotated.minX).toBeCloseTo(1)
    expect(rotated.maxX).toBeCloseTo(3)
    expect(rotated.minZ).toBeCloseTo(-1)
    expect(rotated.maxZ).toBeCloseTo(3)
    expect(planBoundsCenter(rotated)[0]).toBeCloseTo(pivotX)
    expect(planBoundsCenter(rotated)[1]).toBeCloseTo(pivotZ)
  })

  test('supports legacy level-parented elevators already loaded in the editor', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: ['elevator_test'],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'level_test',
        position: [5, 0, 6],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [5, 0, 6],
        rotation: 0,
      },
    ])
  })
})

describe('group plan bounds', () => {
  const withNodes = (nodes: AnyNode[], run: () => void) => {
    const saved = useScene.getState().nodes
    useScene.setState({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) as typeof saved })
    try {
      run()
    } finally {
      useScene.setState({ nodes: saved })
    }
  }

  test('a placed object measures its built mesh in the level frame, or falls back to its anchor', () => {
    const level = new Group()
    level.position.set(10, 0, -4)
    level.rotation.y = Math.PI / 5
    const item = new Mesh(new BoxGeometry(1, 1, 1))
    item.position.set(2, 0.5, 0)
    level.add(item)
    level.updateWorldMatrix(true, true)
    const registry = sceneRegistry.nodes as unknown as Map<string, unknown>
    registry.set('item_plan_bounds_test', item)
    const start = {
      id: 'item_plan_bounds_test' as AnyNodeId,
      kind: 'vec3' as const,
      position: [2, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    }
    try {
      const frameInv = level.matrixWorld.clone().invert()
      const built = groupPlanBounds([start], frameInv)
      expect(built?.minX).toBeCloseTo(1.5)
      expect(built?.maxX).toBeCloseTo(2.5)
      expect(built?.minZ).toBeCloseTo(-0.5)
      expect(built?.maxZ).toBeCloseTo(0.5)
      // Unbuilt while the 3D scene is paused: the placeholder must not count.
      item.geometry.userData.placeholder = true
      expect(groupPlanBounds([start], frameInv)).toEqual({ minX: 2, minZ: 0, maxX: 2, maxZ: 0 })
    } finally {
      registry.delete('item_plan_bounds_test')
    }
  })

  test('hugs the selected wall outlines; a connected wall stays outside', () => {
    const level = LevelNode.parse({ children: [] })
    const bottom = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [2.4, 0],
      thickness: 0.2,
    })
    const side = WallNode.parse({
      parentId: level.id,
      start: [2.4, 0],
      end: [2.4, 5.3],
      thickness: 0.2,
    })
    const neighbour = WallNode.parse({
      parentId: level.id,
      start: [2.4, 5.3],
      end: [8, 5.3],
      thickness: 0.2,
    })
    withNodes([level, bottom, side, neighbour], () => {
      const plan = computeGroupPlanBox([bottom.id, side.id], level.id)
      expect(plan?.minX).toBeCloseTo(0)
      expect(plan?.maxX).toBeCloseTo(2.5)
      expect(plan?.minZ).toBeCloseTo(-0.1)
      expect(plan?.maxZ).toBeLessThan(5.5)
      expect(plan?.maxX).toBeLessThan(8)
    })
  })

  test('two walls with the room floor and ceiling: the box is the drawn outlines, never the meshes', () => {
    // A user's selection whose box came out 13 m wide in 2D-only view.
    const level = LevelNode.parse({ id: 'level_vvkg048zziz9ktiy', children: [] })
    const room: [number, number][] = [
      [-3.6221682640435353, -9.037533979512114],
      [-6.21504662384804, -8.29671159099654],
      [-5.712152486161543, -6.5365821090938],
      [-5.712152486161543, -5],
      [-8.223564365687542, -5],
      [-8.223564365687542, -6.5365821090938],
      [-10.712152486161543, -6.5365821090938],
      [-11.712152486161543, -8.5365821090938],
      [-4.119274126357038, -10.777404497609373],
    ]
    const wall15 = WallNode.parse({
      parentId: level.id,
      start: [-10.712152486161543, -6.5365821090938],
      end: [-11.712152486161543, -8.5365821090938],
    })
    const wall12 = WallNode.parse({
      parentId: level.id,
      start: [-11.712152486161543, -8.5365821090938],
      end: [-6.712152486161543, -10.0365821090938],
    })
    const slab = SlabNode.parse({ parentId: level.id, polygon: room, elevation: 0.05 })
    const ceiling = CeilingNode.parse({ parentId: level.id, polygon: room, height: 2.49 })
    withNodes([level, wall15, wall12, slab, ceiling], () => {
      const plan = computeGroupPlanBox([wall15.id, ceiling.id, slab.id, wall12.id], level.id)!
      expect(plan.minX).toBeLessThan(-11.71)
      expect(plan.minX).toBeGreaterThan(-11.95)
      expect(plan.maxX).toBeCloseTo(-3.62, 1)
      expect(plan.minZ).toBeCloseTo(-10.78, 1)
      expect(plan.maxZ).toBeCloseTo(-5, 1)
      expect(plan.maxX - plan.minX).toBeLessThan(8.4)
    })
  })
})

// Ownership comes from the editable-focus contract, not the rotation helper.
// Exercise the actual carry's registered listener and real scene/preview stores.
// These CPU targets model ownership only, not native focus, propagation or undo.
describe('group keyboard editable ownership', () => {
  function withCarry(
    run: (fixture: {
      press: (
        key: string,
        target?: object,
        modifiers?: { ctrlKey?: boolean; metaKey?: boolean },
      ) => Event
      snapshot: () => unknown
      cancellations: () => number
    }) => void,
  ) {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const rafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
    const cancelRafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    const savedScene = useScene.getState()
    const savedViewer = useViewer.getState()
    const savedEditor = useEditor.getState()
    const savedScope = useInteractionScope.getState()
    const savedOverrides = useLiveNodeOverrides.getState()
    const savedTransforms = useLiveTransforms.getState()
    const history = useScene.temporal.getState()
    const savedHistory = {
      pastStates: history.pastStates,
      futureStates: history.futureStates,
      isTracking: history.isTracking,
    }
    const host = Object.assign(new EventTarget(), { location: { search: '' } })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: host })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { body: { style: { cursor: '' } }, querySelector: () => null },
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frames.set(++frameId, callback)
        return frameId
      },
    })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: (id: number) => frames.delete(id),
    })
    const canvasTarget = { isContentEditable: false, closest: () => null }
    let cancellations = 0
    const press = (
      key: string,
      target: object = canvasTarget,
      modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
    ) => {
      const event = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...modifiers,
      })
      Object.defineProperty(event, 'target', { value: target })
      host.dispatchEvent(event)
      return event
    }
    const snapshot = () =>
      structuredClone({
        nodes: useScene.getState().nodes,
        selection: useViewer.getState().selection,
        scope: useInteractionScope.getState().scope,
        overrides: [...useLiveNodeOverrides.getState().overrides],
        transforms: [...useLiveTransforms.getState().transforms],
        clipboard: getEditorClipboardSnapshot(),
        history: {
          past: useScene.temporal.getState().pastStates.length,
          future: useScene.temporal.getState().futureStates.length,
          tracking: useScene.temporal.getState().isTracking,
        },
      })
    try {
      useScene.temporal.getState().pause()
      useScene.setState({
        nodes: placedNodes() as Record<AnyNodeId, AnyNode>,
        rootNodeIds: ['building_test' as AnyNodeId],
        dirtyNodes: new Set<AnyNodeId>(),
        readOnly: false,
      })
      useScene.temporal.getState().resume()
      clearSceneHistory()
      useScene.getState().updateNode('item_chair' as AnyNodeId, { name: 'undo sentinel' })
      expect(useScene.temporal.getState().pastStates.length).toBeGreaterThan(0)
      useLiveNodeOverrides.getState().clearAll()
      useLiveTransforms.getState().clearAll()
      useInteractionScope.getState().end()
      useEditor.getState().armToolMode({ mode: 'select' })
      useViewer.getState().setSelection({
        buildingId: 'building_test',
        levelId: 'level_test',
        selectedIds: ['item_chair', 'column_post'],
      })
      expect(
        startGroupPickUp({
          onCancel: () => {
            cancellations += 1
          },
        }),
      ).toBe(true)
      run({ press, snapshot, cancellations: () => cancellations })
    } finally {
      // Use the controller's own teardown before restoring shared globals/state.
      press('Escape')
      useScene.temporal.getState().pause()
      useScene.setState(savedScene)
      useScene.temporal.setState({
        pastStates: savedHistory.pastStates,
        futureStates: savedHistory.futureStates,
      })
      if (savedHistory.isTracking) useScene.temporal.getState().resume()
      useViewer.setState(savedViewer)
      useEditor.setState(savedEditor)
      useInteractionScope.setState(savedScope)
      useLiveNodeOverrides.setState(savedOverrides)
      useLiveTransforms.setState(savedTransforms)
      frames.clear()
      for (const [name, descriptor] of [
        ['window', windowDescriptor],
        ['document', documentDescriptor],
        ['requestAnimationFrame', rafDescriptor],
        ['cancelAnimationFrame', cancelRafDescriptor],
      ] as const) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    }
  }

  for (const kind of ['input', 'textarea', 'select', 'contenteditable descendant']) {
    test(`${kind} leaves an actual carried preview and its history untouched`, () => {
      withCarry(({ press, snapshot, cancellations }) => {
        expect(press('r').defaultPrevented).toBe(true)
        expect(useLiveNodeOverrides.getState().overrides.size).toBeGreaterThan(0)
        const before = snapshot()
        const owner = { kind }
        const target = {
          isContentEditable: kind === 'contenteditable descendant',
          closest: () => owner,
        }
        for (const key of ['r', 't', 'Escape', 'Backspace', 'Delete']) {
          expect(press(key, target).defaultPrevented).toBe(false)
          expect(snapshot()).toEqual(before)
          expect(cancellations()).toBe(0)
        }
        for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
          for (const key of ['c', 'x', 'v', 'z']) {
            expect(press(key, target, modifier).defaultPrevented).toBe(false)
            expect(snapshot()).toEqual(before)
            expect(cancellations()).toBe(0)
          }
        }
      })
    })
  }

  test('outside R/T still rotate the real preview and Escape restores the carry', () => {
    withCarry(({ press, cancellations }) => {
      const before = structuredClone(useScene.getState().nodes)
      const initialYaw = 0.5
      expect(press('r').defaultPrevented).toBe(true)
      const rotated = useLiveNodeOverrides.getState().get('item_chair')
      expect(rotated).toBeDefined()
      expect((rotated!.rotation as number[])[1]).not.toBeCloseTo(initialYaw)
      expect(useScene.getState().nodes).toEqual(before)
      expect(press('t').defaultPrevented).toBe(true)
      const restored = useLiveNodeOverrides.getState().get('item_chair')
      expect((restored!.rotation as number[])[1]).toBeCloseTo(initialYaw)
      expect(press('Escape').defaultPrevented).toBe(true)
      expect(cancellations()).toBe(1)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
      expect(useLiveTransforms.getState().transforms.size).toBe(0)
      expect(useScene.getState().nodes).toEqual(before)
      expect(useScene.temporal.getState().isTracking).toBe(true)
      expect(useViewer.getState().selection.selectedIds).toEqual(['item_chair', 'column_post'])
    })
  })
})

// The editable-focus contract owns these expectations: a live rotation is a
// preview, not a scene/history edit, until an outside release commits it.
// Real package stores/controller and CPU geometry; the DOM below supplies only
// identity screen coordinates and event dispatch, not browser focus/native undo.
describe('floorplan group rotation keyboard ownership', () => {
  function snapshot() {
    const history = useScene.temporal.getState()
    return structuredClone({
      nodes: useScene.getState().nodes,
      selection: useViewer.getState().selection,
      scope: useInteractionScope.getState().scope,
      overrides: [...useLiveNodeOverrides.getState().overrides],
      transforms: [...useLiveTransforms.getState().transforms],
      rotation: useFloorplanGroupDrag.getState().rotation,
      inputDragging: useViewer.getState().inputDragging,
      history: {
        past: history.pastStates,
        future: history.futureStates,
        tracking: history.isTracking,
        pauseDepth: getSceneHistoryPauseDepth(),
      },
    })
  }

  function withRotation(
    run: (fixture: {
      press: (key: string, target?: object, modifiers?: object) => Event
      pointer: (type: string) => void
      snapshot: () => ReturnType<typeof snapshot>
    }) => void,
  ) {
    const names = [
      'window',
      'document',
      'setTimeout',
      'clearTimeout',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ] as const
    const descriptors = names.map(
      (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
    )
    const savedStores = [
      [useScene, useScene.getState()],
      [useViewer, useViewer.getState()],
      [useEditor, useEditor.getState()],
      [useInteractionScope, useInteractionScope.getState()],
      [useLiveNodeOverrides, useLiveNodeOverrides.getState()],
      [useLiveTransforms, useLiveTransforms.getState()],
      [useFloorplanGroupDrag, useFloorplanGroupDrag.getState()],
    ] as const
    const savedHistory = useScene.temporal.getState()
    const pauseDepth = getSceneHistoryPauseDepth()
    const savedRegistry = new Map(sceneRegistry.nodes)
    const host = Object.assign(new EventTarget(), { location: { search: '' } })
    const timers = new Map<number, () => void>()
    const microtasks: (() => void)[] = []
    let timerId = 0
    const sceneElement = {
      getScreenCTM: () => ({ inverse: () => ({}) }),
      ownerSVGElement: {
        createSVGPoint: () => ({
          x: 0,
          y: 0,
          matrixTransform() {
            return { x: this.x, y: this.y }
          },
        }),
      },
    }
    const globals = {
      window: host,
      document: {
        body: { style: { cursor: '' } },
        querySelector: (selector: string) =>
          selector === 'g[data-floorplan-scene]' ? sceneElement : null,
      },
      setTimeout: (callback: () => void) => {
        timers.set(++timerId, callback)
        return timerId
      },
      clearTimeout: (id: number) => {
        timers.delete(id)
      },
      queueMicrotask: (callback: () => void) => {
        microtasks.push(callback)
      },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        timers.set(++timerId, () => callback(0))
        return timerId
      },
      cancelAnimationFrame: (id: number) => {
        timers.delete(id)
      },
    }
    const canvas = { isContentEditable: false, closest: () => null }
    const press = (key: string, target: object = canvas, modifiers: object = {}) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...modifiers,
      })
      Object.defineProperty(event, 'target', { value: target })
      host.dispatchEvent(event)
      return event
    }
    const pointer = (type: string) => {
      host.dispatchEvent(
        Object.assign(new Event(type), {
          pointerId: 7,
          clientX: 2.5,
          clientY: 4,
        }),
      )
    }
    const meshes: Mesh[] = []
    try {
      // No shared gesture may already own a history pause in this isolated test.
      expect(pauseDepth).toBe(0)
      for (const name of names) {
        Object.defineProperty(globalThis, name, { configurable: true, value: globals[name] })
      }
      useScene.temporal.getState().pause()
      useScene.setState({
        nodes: placedNodes() as Record<AnyNodeId, AnyNode>,
        rootNodeIds: ['building_test' as AnyNodeId],
        dirtyNodes: new Set<AnyNodeId>(),
        readOnly: false,
      })
      useScene.temporal.getState().resume()
      // Clear only this temporal stack, never the process-wide draft registry.
      useScene.temporal.getState().clear()
      useScene.getState().updateNode('item_chair' as AnyNodeId, { name: 'rotation undo sentinel' })
      useLiveNodeOverrides.getState().clearAll()
      useLiveTransforms.getState().clearAll()
      useFloorplanGroupDrag.setState({ delta: null, rotation: null })
      useInteractionScope.getState().end()
      useEditor.getState().armToolMode({ mode: 'select' })
      useViewer.getState().setSelection({
        buildingId: 'building_test',
        levelId: 'level_test',
        selectedIds: ['item_chair', 'column_post'],
      })
      sceneRegistry.nodes.clear()
      for (const id of ['item_chair', 'column_post'] as const) {
        const mesh = new Mesh(new BoxGeometry(1, 1, 1))
        mesh.position.fromArray(
          (useScene.getState().nodes[id as AnyNodeId] as unknown as { position: number[] })
            .position,
        )
        mesh.updateMatrixWorld(true)
        meshes.push(mesh)
        sceneRegistry.nodes.set(id as AnyNodeId, mesh)
      }
      expect(startFloorplanGroupRotate({ clientX: 5.5, clientY: 1, pointerId: 7 })).toBe(true)
      pointer('pointermove')
      expect(useFloorplanGroupDrag.getState().rotation?.angle).toBeCloseTo(Math.PI / 2)
      expect(useLiveNodeOverrides.getState().overrides.size).toBe(2)
      expect(useInteractionScope.getState().scope.kind).toBe('handle-drag')
      expect(useScene.temporal.getState().pastStates.length).toBeGreaterThan(0)
      expect(useScene.temporal.getState().isTracking).toBe(false)
      run({ press, pointer, snapshot })
    } finally {
      // Controller teardown balances its own history pause even after an assertion
      // fails. Drain its deferred input/click cleanup before restoring shared state.
      pointer('pointercancel')
      while (microtasks.length) microtasks.shift()!()
      for (const callback of timers.values()) {
        callback()
        while (microtasks.length) microtasks.shift()!()
      }
      timers.clear()
      useScene.temporal.getState().pause()
      for (const [store, state] of savedStores)
        (store.setState as (snapshot: unknown) => void)(state)
      useScene.temporal.setState(savedHistory)
      sceneRegistry.nodes.clear()
      for (const [id, object] of savedRegistry) sceneRegistry.nodes.set(id, object)
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        if (Array.isArray(mesh.material))
          mesh.material.forEach((material) => {
            material.dispose()
          })
        else mesh.material.dispose()
      }
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
      expect(getSceneHistoryPauseDepth()).toBe(pauseDepth)
    }
  }

  test('editable undo and cancel keys preserve the actual active rotation', () => {
    withRotation(({ press, snapshot }) => {
      const before = snapshot()
      const targets = [
        { isContentEditable: false, closest: () => ({ tagName: 'TEXTAREA' }) },
        { isContentEditable: true, closest: () => null },
      ]
      for (const target of targets) {
        for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
          expect(press('z', target, modifiers).defaultPrevented).toBe(false)
          expect(snapshot()).toEqual(before)
        }
        for (const key of ['Backspace', 'Delete', 'Escape']) {
          expect(press(key, target).defaultPrevented).toBe(false)
          expect(snapshot()).toEqual(before)
        }
      }
    })
  })

  test('outside history and Escape still cancel without consuming a scene undo', () => {
    for (const [key, modifiers] of [
      ['Escape', {}],
      ['z', { ctrlKey: true }],
      ['z', { metaKey: true }],
    ] as const) {
      withRotation(({ press, snapshot }) => {
        const before = snapshot()
        expect(press(key, undefined, modifiers).defaultPrevented).toBe(true)
        const after = snapshot()
        expect(after.nodes).toEqual(before.nodes)
        expect(after.history.past).toEqual(before.history.past)
        expect(after.history.future).toEqual(before.history.future)
        expect(after.history.tracking).toBe(true)
        expect(after.history.pauseDepth).toBe(0)
        expect(after.scope.kind).toBe('idle')
        expect(after.overrides).toEqual([])
        expect(after.transforms).toEqual([])
        expect(after.rotation).toBeNull()
      })
    }
  })

  test('outside pointer release commits one undoable rotation', () => {
    withRotation(({ pointer, snapshot }) => {
      const before = snapshot()
      pointer('pointerup')
      const after = snapshot()
      expect(after.nodes).not.toEqual(before.nodes)
      expect(after.history.past).toHaveLength(before.history.past.length + 1)
      expect(after.history.tracking).toBe(true)
      expect(after.scope.kind).toBe('idle')
      expect(after.overrides).toEqual([])
      expect(after.transforms).toEqual([])
      expect(after.rotation).toBeNull()
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(before.nodes)
    })
  })
})
