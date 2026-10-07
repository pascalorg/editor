import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  applySceneSnapshot,
  BlockNode,
  CeilingNode,
  clearSceneHistory,
  emitter,
  type FloorplanMoveTargetSession,
  getSceneHistoryPauseDepth,
  ItemNode,
  initSpaceDetectionSync,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  type SceneCommit,
  ShelfNode,
  SlabNode,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { renderToString } from 'react-dom/server'
import gridTableRecipe from '../../../core/src/procedural-items/__fixtures__/grid-table.json'
import { FloorplanRegistryMoveOverlay } from '../../../editor/src/components/editor-2d/floorplan-registry-move-overlay'
import {
  type DraftNodeHandle,
  useDraftNode,
} from '../../../editor/src/components/tools/item/use-draft-node'
import { MoveRegistryNodeTool } from '../../../editor/src/components/tools/registry/move-registry-node-tool'
import { updateSurfaceNode } from '../../../editor/src/lib/surface-attachment'
import { ceilingDefinition } from '../ceiling/definition'
import { shelfDefinition } from '../shelf/definition'
import { slabDefinition } from '../slab/definition'
import { zoneDefinition } from '../zone/definition'
import { itemDefinition } from './definition'

const LEVEL_ID = 'level_item-2d-move' as AnyNodeId
const ITEM_ID = 'item_item-2d-move' as AnyNodeId

const walls = [
  WallNode.parse({ id: 'wall_item-2d-south', parentId: LEVEL_ID, start: [0, 0], end: [4, 0] }),
  WallNode.parse({ id: 'wall_item-2d-east', parentId: LEVEL_ID, start: [4, 0], end: [4, 4] }),
  WallNode.parse({ id: 'wall_item-2d-north', parentId: LEVEL_ID, start: [4, 4], end: [0, 4] }),
  WallNode.parse({ id: 'wall_item-2d-west', parentId: LEVEL_ID, start: [0, 4], end: [0, 0] }),
]
const item = ItemNode.parse({
  id: ITEM_ID,
  parentId: LEVEL_ID,
  asset: {
    id: 'box',
    category: 'decor',
    name: 'Box',
    thumbnail: '/box.png',
    src: '/box.glb',
    dimensions: [0.5, 0.5, 0.5],
  },
  position: [1, 0, 1],
})

let stopDetection = () => {}
let savedWindow: PropertyDescriptor | undefined
let savedDocument: PropertyDescriptor | undefined
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame
let renderer: Awaited<ReturnType<typeof create>> | null = null

function nodesOfType(type: AnyNode['type']) {
  return Object.values(useScene.getState().nodes).filter((node) => node.type === type)
}

beforeEach(() => {
  savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  savedRaf = globalThis.requestAnimationFrame
  savedCancelRaf = globalThis.cancelAnimationFrame
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  // The floor-plan pane: client coordinates are plan meters.
  const svg = {
    createSVGPoint: () => {
      const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) }
      return point
    },
    getBoundingClientRect: () => ({ left: -100, right: 100, top: -100, bottom: 100 }),
  }
  const scene = {
    ownerSVGElement: svg,
    getScreenCTM: () => ({ inverse: () => ({}) }),
    appendChild: () => {},
    querySelector: () => null,
  }
  globalThis.document = {
    querySelector: (selector: string) => (selector === '[data-floorplan-scene]' ? scene : null),
    body: { style: { cursor: '' } },
  } as unknown as Document
  if (!nodeRegistry.get('item')) registerNode(itemDefinition)

  useScene.setState({
    nodes: { [LEVEL_ID]: LevelNode.parse({ id: LEVEL_ID, level: 0, height: 3, children: [] }) },
    rootNodeIds: [LEVEL_ID],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
  useLiveNodeOverrides.getState().clearAll()
  stopDetection = initSpaceDetectionSync(useScene, useEditor)
  useScene.getState().applyNodeChanges({
    create: [...walls, item].map((node) => ({ node, parentId: LEVEL_ID })),
  })
  clearSceneHistory()
  useEditor.setState({ mode: 'build', movingNodeOrigin: null, gridSnapStep: 0.5 } as never)
  useViewer.setState({
    selection: { buildingId: null, levelId: LEVEL_ID, zoneId: null, selectedIds: [] },
  } as never)
})

afterEach(async () => {
  const leftover = renderer
  renderer = null
  if (leftover) {
    try {
      await act(async () => leftover.unmount())
    } catch {
      // Already unmounted by the case.
    }
  }
  stopDetection()
  useLiveNodeOverrides.getState().clearAll()
  clearSceneHistory()
  for (const [key, saved] of [
    ['window', savedWindow],
    ['document', savedDocument],
  ] as const) {
    if (saved) Object.defineProperty(globalThis, key, saved)
    else Reflect.deleteProperty(globalThis, key)
  }
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})

async function pointer(type: 'pointermove' | 'pointerup', x: number, z: number) {
  await act(async () => {
    window.dispatchEvent(
      Object.assign(new Event(type), {
        button: 0,
        clientX: x,
        clientY: z,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    )
  })
}

async function mountStagedMove(
  name: string,
  session: (id: AnyNodeId) => FloorplanMoveTargetSession,
) {
  const kind = `test:staged-${name}`
  const schema = ItemNode.extend({ id: objectId(kind), type: nodeType(kind) })
  registerNode({
    ...itemDefinition,
    kind,
    schema,
    floorplanMoveTarget: ({ node }: { node: AnyNode }) => session(node.id),
  } as never)
  const node = schema.parse({ ...item, id: `${kind}_root`, type: kind }) as AnyNode
  useScene.getState().createNode(node, LEVEL_ID)
  clearSceneHistory()
  useEditor.getState().setMovingNode(useScene.getState().nodes[node.id]!)
  await act(async () => {
    renderer = await create(<FloorplanRegistryMoveOverlay />)
  })
  return node.id
}

describe('carried face-host history fallback', () => {
  const fields = (host: BlockNode | RoofSegmentNode, alternate = false): Partial<ItemNode> =>
    host.type === 'roof-segment'
      ? { roofSegmentId: host.id, roofFace: alternate ? 'back' : 'front' }
      : { blockFaceId: alternate ? 'f-top' : 'f-front' }
  const makeHost = (kind: 'roof' | 'block', parentId: AnyNodeId) =>
    kind === 'roof' ? RoofSegmentNode.parse({ parentId }) : BlockNode.parse({ parentId })
  const makeParent = (kind: 'roof' | 'block'): AnyNodeId => {
    if (kind === 'block') return LEVEL_ID
    const roof = RoofNode.parse({ parentId: LEVEL_ID })
    useScene.getState().createNode(roof, LEVEL_ID)
    return roof.id
  }
  const adopt = (node: ItemNode) => {
    let draft!: DraftNodeHandle
    function Harness() {
      draft = useDraftNode()
      return null
    }
    renderToString(<Harness />)
    draft.adopt(node)
    return draft
  }

  for (const kind of ['roof', 'block'] as const) {
    for (const fresh of [false, true]) {
      test(`undoing a ${kind} host clears its carried binding before cancellation (fresh=${fresh})`, () => {
        const parentId = makeParent(kind)
        clearSceneHistory()
        const host = makeHost(kind, parentId)
        const carried = fresh
          ? ItemNode.parse({
              parentId: host.id,
              asset: item.asset,
              metadata: { isNew: true },
              ...fields(host),
            })
          : (useScene.getState().nodes[ITEM_ID] as ItemNode)
        let draft = fresh ? null : adopt(carried)
        useScene.getState().createNode(host, parentId)
        if (fresh) {
          useScene.getState().createNode(carried, host.id)
          draft = adopt(carried)
        } else {
          draft!.updateSurface({ parentId: host.id, position: [0.5, 0, 0], ...fields(host) }, null)
        }
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        useScene.temporal.getState().undo()
        const fallback = fresh ? parentId : LEVEL_ID
        const assertFallback = () => {
          const restored = useScene.getState().nodes[carried.id] as ItemNode
          expect(restored.parentId).toBe(fallback)
          expect(useScene.getState().nodes[fallback]!.children).toContain(carried.id)
          expect(restored.roofSegmentId).toBeUndefined()
          expect(restored.roofFace).toBeUndefined()
          expect(restored.blockFaceId).toBeUndefined()
        }
        expect(useScene.getState().nodes[host.id]).toBeUndefined()
        assertFallback()
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        expect(useScene.temporal.getState().futureStates).toHaveLength(1)
        useScene.temporal.getState().redo()
        expect(useScene.getState().nodes[host.id]).toBeDefined()
        assertFallback()
        useScene.temporal.getState().undo()
        draft!.destroy()
        assertFallback()
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        expect(getSceneHistoryPauseDepth()).toBe(0)
      })
    }

    test(`undoing a new ${kind} host preserves the adopted item's surviving host binding`, () => {
      const parentId = makeParent(kind)
      const original = makeHost(kind, parentId)
      const target = makeHost(kind, parentId)
      useScene.getState().createNode(original, parentId)
      useScene.getState().updateNode(ITEM_ID, { parentId: original.id, ...fields(original) })
      clearSceneHistory()
      const draft = adopt(useScene.getState().nodes[ITEM_ID] as ItemNode)
      useScene.getState().createNode(target, parentId)
      draft.updateSurface(
        { parentId: target.id, position: [0.5, 0, 0], ...fields(target, true) },
        null,
      )
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes[target.id]).toBeUndefined()
      expect(useScene.getState().nodes[ITEM_ID]).toMatchObject({
        parentId: original.id,
        ...fields(original),
      })
      expect(useScene.getState().nodes[original.id]!.children).toContain(ITEM_ID)
      draft.destroy()
      expect(useScene.getState().nodes[ITEM_ID]).toMatchObject({
        parentId: original.id,
        ...fields(original),
      })
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    })

    test(`a fresh carry keeps a valid foreign ${kind} binding when its first host is undone`, () => {
      const parentId = makeParent(kind)
      const surviving = makeHost(kind, parentId)
      useScene.getState().createNode(surviving, parentId)
      clearSceneHistory()
      const removed = makeHost(kind, parentId)
      useScene.getState().createNode(removed, parentId)
      const carried = ItemNode.parse({
        parentId: removed.id,
        asset: item.asset,
        metadata: { isNew: true },
        ...fields(removed),
      })
      useScene.getState().createNode(carried, removed.id)
      const draft = adopt(carried)
      useScene
        .getState()
        .updateNode(carried.id, { parentId: surviving.id, ...fields(surviving, true) })
      useScene.temporal.getState().undo()
      const assertBinding = () => {
        expect(useScene.getState().nodes[removed.id]).toBeUndefined()
        expect(useScene.getState().nodes[carried.id]).toMatchObject({
          parentId: surviving.id,
          ...fields(surviving, true),
        })
        expect(useScene.getState().nodes[surviving.id]!.children).toContain(carried.id)
      }
      assertBinding()
      draft.destroy()
      assertBinding()
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    })
  }
})

describe('registered staged move history', () => {
  test('deleting the mover cancels held writes on surviving affected nodes', async () => {
    const id = await mountStagedMove('deleted-root', (id) => ({
      affectedIds: [id, ITEM_ID],
      apply: ({ planPoint: [x, z] }) =>
        useScene.getState().updateNodes([
          { id, data: { position: [x, 0, z] } },
          { id: ITEM_ID, data: { position: [x + 1, 0, z] } },
        ]),
      canCommit: () => true,
    }))
    await pointer('pointermove', 3, 3)
    expect(useScene.getState().nodes[ITEM_ID]).toMatchObject({ position: [4, 0, 3] })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    useScene.getState().updateNode(ITEM_ID, { name: 'Renamed by another editor' })
    useScene.getState().deleteNode(id)
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)

    await pointer('pointerup', 3, 3)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useScene.getState().nodes[id]).toBeUndefined()
    expect(useScene.getState().nodes[LEVEL_ID]!.children).not.toContain(id)
    expect(useScene.getState().nodes[ITEM_ID]).toMatchObject({
      position: item.position,
      name: 'Renamed by another editor',
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[id]).toMatchObject({ position: item.position })
    expect(useScene.getState().nodes[ITEM_ID]).toMatchObject({
      position: item.position,
      name: 'Renamed by another editor',
    })
  })

  test('drop preserves a held field absent from the original node through undo and redo', async () => {
    const slab = nodesOfType('slab')[0]!
    const id = await mountStagedMove('added-field', (id) => ({
      affectedIds: [id],
      apply: ({ planPoint: [x, z] }) =>
        useScene.getState().updateNode(id, { position: [x, 0, z], supportSlabId: slab.id }),
      canCommit: () => true,
    }))
    expect(useScene.getState().nodes[id]).not.toHaveProperty('supportSlabId')
    await pointer('pointermove', 3, 3)
    expect(useScene.getState().nodes[id]).toMatchObject({ supportSlabId: slab.id })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await pointer('pointerup', 3, 3)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useScene.getState().nodes[id]).toMatchObject({
      position: [3, 0, 3],
      supportSlabId: slab.id,
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[id]).toMatchObject({ position: item.position })
    expect((useScene.getState().nodes[id] as ItemNode).supportSlabId).toBeUndefined()
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes[id]).toMatchObject({
      position: [3, 0, 3],
      supportSlabId: slab.id,
    })
  })

  test('drop preserves a named attachment held on a host outside affectedIds', async () => {
    const host = ProceduralItemNode.parse({
      parentId: LEVEL_ID,
      recipe: {
        ...gridTableRecipe,
        surfaces: [{ id: 'top', label: 'Top', position: [0, 0.74, 0], size: [0.45, 0.6] }],
      },
    })
    useScene.getState().createNode(host, LEVEL_ID)
    const id = await mountStagedMove('host-attachment', (id) => ({
      affectedIds: [id],
      apply: () => updateSurfaceNode(id, { parentId: host.id, position: [0, 0, 0] }, 'top'),
      canCommit: () => true,
    }))
    await pointer('pointermove', 3, 3)
    expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[id]).toBe('top')
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    useScene.getState().updateNode(host.id, { name: 'Renamed host' })
    await pointer('pointerup', 3, 3)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useScene.getState().nodes[id]).toMatchObject({ parentId: host.id })
    expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[id]).toBe('top')
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[id]).toMatchObject({ parentId: LEVEL_ID })
    expect(
      (useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[id],
    ).toBeUndefined()
    expect(useScene.getState().nodes[host.id]).toMatchObject({ name: 'Renamed host' })
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes[id]).toMatchObject({ parentId: host.id })
    expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[id]).toBe('top')
  })
})

describe('2D item move history', () => {
  test('a 2D tick preserves the co-mounted registry mover raw pause until cancellation', async () => {
    if (!nodeRegistry.get('shelf')) registerNode(shelfDefinition)
    const shelf = ShelfNode.parse({ parentId: LEVEL_ID, position: [6, 0, 6] })
    useScene.getState().createNode(shelf, LEVEL_ID)
    clearSceneHistory()
    useEditor.getState().setMovingNode(shelf)
    await act(async () => {
      renderer = await create(
        <>
          <FloorplanRegistryMoveOverlay />
          <MoveRegistryNodeTool node={shelf} />
        </>,
      )
    })
    expect(useScene.temporal.getState().isTracking).toBe(false)
    await pointer('pointermove', 6, 6)
    await pointer('pointermove', 8, 8)
    const trackingAfterTick = useScene.temporal.getState().isTracking
    useScene.getState().updateNode(ITEM_ID, { name: 'Edit during legacy carry' })
    const stepsDuringCarry = useScene.temporal.getState().pastStates.length
    await act(async () => {
      emitter.emit('tool:cancel')
    })
    await act(async () => renderer!.unmount())
    renderer = null
    expect(useScene.temporal.getState().isTracking).toBe(true)
    expect((useScene.getState().nodes[shelf.id] as ShelfNode).position).toEqual(shelf.position)
    expect(stepsDuringCarry).toBe(0)
    expect(trackingAfterTick).toBe(false)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('a refused fresh drop retains both the mover and its history draft', async () => {
    useScene.getState().updateNode(ITEM_ID, { metadata: { isNew: true } })
    clearSceneHistory()
    useEditor.getState().setMovingNode(useScene.getState().nodes[ITEM_ID]!)
    await act(async () => {
      renderer = await create(<FloorplanRegistryMoveOverlay />)
    })
    await pointer('pointermove', 1.5, 1.5)
    await pointer('pointermove', 3, 3)
    useScene.setState({ readOnly: true })
    await pointer('pointerup', 3, 3)
    expect(useEditor.getState().movingNodeOrigin).toBeNull()
    useScene.setState({ readOnly: false })
    const state = useScene.getState()
    expect(() =>
      applySceneSnapshot(
        {
          nodes: state.nodes,
          rootNodeIds: state.rootNodeIds,
          collections: state.collections,
          materials: state.materials,
          installedPlugins: state.installedPlugins,
        },
        { origin: 'host' },
      ),
    ).toThrow()
    await pointer('pointerup', 3, 3)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useEditor.getState().movingNodeOrigin).toBe('2d')
  })

  test.each([
    [SlabNode, slabDefinition],
    [CeilingNode, ceilingDefinition],
    [ZoneNode, zoneDefinition],
  ] as const)('a rejected polygon drop retains ownership for an undoable retry (%s)', async (schema, definition) => {
    if (!nodeRegistry.get(definition.type)) registerNode(definition)
    const polygon = [
      [6, 6],
      [8, 6],
      [8, 8],
      [6, 8],
    ]
    const node = schema.parse({
      name: 'Moved polygon',
      parentId: LEVEL_ID,
      polygon,
      autoFromWalls: false,
    })
    useScene.getState().createNode(node, LEVEL_ID)
    clearSceneHistory()
    const before = useScene.getState().nodes
    const listeners = spyOn(window, 'addEventListener')
    useEditor.getState().setMovingNode(node)
    await act(async () => {
      renderer = await create(<FloorplanRegistryMoveOverlay />)
    })
    const release = listeners.mock.calls.filter(([type]) => type === 'pointerup').at(-1)![1] as (
      event: PointerEvent,
    ) => void
    listeners.mockRestore()
    await pointer('pointermove', 7, 7)
    await pointer('pointermove', 9, 9)

    const updateNodes = useScene.getState().updateNodes
    const fault = new Error('Commit write rejected before publication')
    const writes = spyOn(useScene.getState(), 'updateNodes').mockImplementation((updates) => {
      if (useScene.temporal.getState().isTracking && updates.some(({ id }) => id === node.id)) {
        throw fault
      }
      return updateNodes(updates)
    })
    let caught: unknown
    try {
      await act(async () => {
        try {
          // Invoke the actual mounted handler so EventTarget cannot defer the exception.
          release({ button: 0, clientX: 9, clientY: 9 } as PointerEvent)
        } catch (error) {
          caught = error
        }
      })
    } finally {
      writes.mockRestore()
      useScene.setState({ updateNodes })
    }
    expect(caught).toBe(fault)
    expect(useScene.getState().nodes).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)

    useScene.getState().updateNode(node.id, { name: 'Renamed while retrying' })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await pointer('pointermove', 10, 10)
    await pointer('pointerup', 10, 10)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useScene.getState().nodes[node.id]).toMatchObject({
      name: 'Renamed while retrying',
      polygon: [
        [9, 9],
        [11, 9],
        [11, 11],
        [9, 11],
      ],
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    const committed = useScene.getState().nodes
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual({
      ...before,
      [node.id]: { ...before[node.id], name: 'Renamed while retrying' },
    })
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(committed)
  })

  test.each([
    [SlabNode, slabDefinition],
    [CeilingNode, ceilingDefinition],
    [ZoneNode, zoneDefinition],
  ] as const)('a polygon drop restores selection and records one undo step (%s)', async (schema, definition) => {
    if (!nodeRegistry.get(definition.type)) registerNode(definition)
    const polygon = [
      [6, 6],
      [8, 6],
      [8, 8],
      [6, 8],
    ]
    const node = schema.parse({
      name: 'Moved polygon',
      parentId: LEVEL_ID,
      polygon,
      autoFromWalls: false,
    })
    useScene.getState().createNode(node, LEVEL_ID)
    clearSceneHistory()
    useEditor.getState().setMovingNode(node)
    await act(async () => {
      renderer = await create(<FloorplanRegistryMoveOverlay />)
    })
    await pointer('pointermove', 7, 7)
    await pointer('pointermove', 9, 9)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await pointer('pointerup', 9, 9)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useViewer.getState().selection.selectedIds).toEqual([node.id])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useScene.getState().nodes[node.id]).toMatchObject({
      polygon: [
        [8, 8],
        [10, 8],
        [10, 10],
        [8, 10],
      ],
    })
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[node.id]).toMatchObject({ polygon })
  })

  test('a wall added mid-carry is its own reconciled step; one undo reverts only the drop', async () => {
    expect(nodesOfType('zone')).toHaveLength(1)
    useEditor.getState().setMovingNode(useScene.getState().nodes[ITEM_ID]!)
    await act(async () => {
      renderer = await create(<FloorplanRegistryMoveOverlay />)
    })
    await pointer('pointermove', 1.5, 1.5)
    await pointer('pointermove', 3, 3)
    const foreignId = 'wall_item-2d-foreign' as AnyNodeId
    useScene
      .getState()
      .createNode(
        WallNode.parse({ id: foreignId, parentId: LEVEL_ID, start: [2, 0], end: [2, 4] }),
        LEVEL_ID,
      )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    // The dividing wall splits the room; both rooms keep standing on one base plate.
    expect(nodesOfType('zone')).toHaveLength(2)
    expect(nodesOfType('slab')).toHaveLength(1)

    await pointer('pointerup', 3, 3)
    // Let the overlay's swallow-next-click timer run while `window` is still stubbed.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const moved = useScene.getState().nodes[ITEM_ID] as ItemNode
    expect(moved.position).not.toEqual([1, 0, 1])
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)

    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[ITEM_ID] as ItemNode).position).toEqual([1, 0, 1])
    expect(useScene.getState().nodes[foreignId]).toBeDefined()
  })

  test('a foreign rename of the carried item survives the drop and the cancel', async () => {
    for (const outcome of ['drop', 'Escape'] as const) {
      useEditor.getState().setMovingNode(useScene.getState().nodes[ITEM_ID]!)
      await act(async () => {
        renderer = await create(<FloorplanRegistryMoveOverlay />)
      })
      await pointer('pointermove', 1.5, 1.5)
      await pointer('pointermove', 3, 3)
      useScene.getState().updateNode(ITEM_ID, { name: `Renamed before ${outcome}` })
      if (outcome === 'drop') await pointer('pointerup', 3, 3)
      else
        await act(async () => {
          window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
        })
      await new Promise((resolve) => setTimeout(resolve, 0))
      const current = useScene.getState().nodes[ITEM_ID] as ItemNode
      expect(current.name).toBe(`Renamed before ${outcome}`)
      if (outcome === 'Escape') expect(current.position).toEqual([1, 0, 1])
      else expect(current.position).not.toEqual([1, 0, 1])
      expect(getSceneHistoryPauseDepth()).toBe(0)
      await act(async () => renderer!.unmount())
      renderer = null
      useScene.getState().updateNode(ITEM_ID, { position: [1, 0, 1] })
    }
  })

  test("a split-view 2D drop stays committed after an agent's metadata edit", async () => {
    // The 3D placement coordinator's draft node adopts the item (split view) and cleans up
    // after the 2D drop; an agent tags the item mid-carry and keeps its transient flag.
    let draft: DraftNodeHandle | null = null
    function DraftHarness() {
      draft = useDraftNode()
      return null
    }
    renderToString(<DraftHarness />)
    draft!.adopt(useScene.getState().nodes[ITEM_ID] as ItemNode)
    useEditor.getState().setMovingNode(useScene.getState().nodes[ITEM_ID]!)
    await act(async () => {
      renderer = await create(<FloorplanRegistryMoveOverlay />)
    })
    await pointer('pointermove', 1.5, 1.5)
    await pointer('pointermove', 3, 3)
    const metadata = useScene.getState().nodes[ITEM_ID]!.metadata as Record<string, unknown>
    useScene.getState().updateNode(ITEM_ID, { metadata: { ...metadata, tag: 'x' } })
    const past = useScene.temporal.getState().pastStates.length
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    await pointer('pointerup', 3, 3)
    stop()
    // The drop is one undo entry and one scene commit.
    expect(useScene.temporal.getState().pastStates).toHaveLength(past + 1)
    expect(commits).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    draft!.destroy()

    const current = useScene.getState().nodes[ITEM_ID] as ItemNode
    expect(current.position).not.toEqual([1, 0, 1])
    expect((current.metadata as Record<string, unknown>).tag).toBe('x')
    expect((current.metadata as Record<string, unknown>).isTransient).toBeUndefined()
    useScene.temporal.getState().undo()
    const undone = useScene.getState().nodes[ITEM_ID] as ItemNode
    expect(undone.position).toEqual([1, 0, 1])
    expect((undone.metadata as Record<string, unknown>).tag).toBe('x')
    expect((undone.metadata as Record<string, unknown>).isTransient).toBeUndefined()
  })
})
