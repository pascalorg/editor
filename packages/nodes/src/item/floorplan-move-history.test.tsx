import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  clearSceneHistory,
  getSceneHistoryPauseDepth,
  ItemNode,
  initSpaceDetectionSync,
  LevelNode,
  nodeRegistry,
  registerNode,
  type SceneCommit,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { renderToString } from 'react-dom/server'
import { FloorplanRegistryMoveOverlay } from '../../../editor/src/components/editor-2d/floorplan-registry-move-overlay'
import {
  type DraftNodeHandle,
  useDraftNode,
} from '../../../editor/src/components/tools/item/use-draft-node'
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

describe('2D item move history', () => {
  test('a wall added mid-carry is its own reconciled step; one undo reverts only the drop', async () => {
    expect(nodesOfType('slab')).toHaveLength(1)
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
    expect(nodesOfType('slab')).toHaveLength(2)

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
  })
})
