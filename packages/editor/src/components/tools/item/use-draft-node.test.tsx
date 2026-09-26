import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BlockNode,
  BuildingNode,
  getBlockFaceFrame,
  getSceneHistoryPauseDepth,
  ItemNode,
  LevelNode,
  type NodeEvent,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { renderToString } from 'react-dom/server'
import { BufferGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { commitFaceHostClick } from './face-host-commit'
import type { PlacementContext } from './placement-types'
import { registerTestBlockFaceHost } from './test-face-host'
import { type DraftNodeHandle, useDraftNode } from './use-draft-node'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const BUILDING_ID = 'building_draft_custom_mesh'
const LEVEL_ID = 'level_draft_custom_mesh'
const BLOCK_ID = 'block_draft_host'

let draftNode: DraftNodeHandle | null = null

function DraftHarness() {
  draftNode = useDraftNode()
  return null
}

beforeEach(() => {
  registerTestBlockFaceHost()
  const block = BlockNode.parse({
    id: BLOCK_ID,
    parentId: LEVEL_ID,
  })
  const level = LevelNode.parse({
    id: LEVEL_ID,
    parentId: BUILDING_ID,
    children: [BLOCK_ID],
    level: 0,
  })
  const building = BuildingNode.parse({
    id: BUILDING_ID,
    children: [LEVEL_ID],
  })
  useScene.setState({
    nodes: {
      [BUILDING_ID]: building,
      [LEVEL_ID]: level,
      [BLOCK_ID]: block,
    },
    rootNodeIds: [BUILDING_ID],
    collections: {},
    dirtyNodes: new Set(),
  } as never)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  useViewer.setState({
    selection: {
      buildingId: BUILDING_ID,
      levelId: LEVEL_ID,
      zoneId: null,
      selectedIds: [],
    },
  })
  draftNode = null
  renderToString(<DraftHarness />)
})

describe('useDraftNode block face commit', () => {
  test('persists the face host used by the placement preview', () => {
    const draft = draftNode!
    draft.create(new Vector3(0, 0, 0), {
      id: 'wall-art',
      category: 'decor',
      name: 'Wall art',
      thumbnail: '/wall-art.png',
      src: '/wall-art.glb',
      dimensions: [1, 1, 0.1],
      attachTo: 'wall-side',
    })

    const committedId = draft.commit({
      parentId: BLOCK_ID,
      position: [0.5, -0.5, 0],
      rotation: [0, 0, 0],
      blockFaceId: 'face-front',
    })

    const committed = useScene.getState().nodes[committedId as AnyNodeId]
    expect(committed).toMatchObject({
      parentId: BLOCK_ID,
      position: [0.5, -0.5, 0],
      blockFaceId: 'face-front',
    })
  })

  test('keeps a block-face placement visible until undo removes the committed item', () => {
    useScene.temporal.getState().pause()
    const draft = draftNode!
    const transient = draft.create(new Vector3(0, 0, 0), {
      id: 'potted-plant',
      category: 'decor',
      name: 'Potted plant',
      thumbnail: '/potted-plant.png',
      src: '/potted-plant.glb',
      dimensions: [0.5, 0.39, 0.5],
    })!

    const committedId = draft.commit({
      parentId: BLOCK_ID,
      position: [0.5, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      blockFaceId: 'face-top',
    })!

    const afterCommit = useScene.getState().nodes
    expect(afterCommit[transient.id as AnyNodeId]).toBeUndefined()
    expect(afterCommit[committedId as AnyNodeId]).toMatchObject({
      parentId: BLOCK_ID,
      blockFaceId: 'face-top',
    })
    expect((afterCommit[BLOCK_ID as AnyNodeId] as BlockNode).children).toContain(
      committedId as ItemNode['id'],
    )

    useScene.temporal.getState().undo()

    const afterUndo = useScene.getState().nodes
    expect(afterUndo[committedId as AnyNodeId]).toBeUndefined()
    expect(afterUndo[transient.id as AnyNodeId]).toBeUndefined()
    expect((afterUndo[BLOCK_ID as AnyNodeId] as BlockNode).children).not.toContain(
      committedId as ItemNode['id'],
    )
  })

  test('moves a block-face item to the floor as one undoable reparent', () => {
    const hosted = ItemNode.parse({
      id: 'item_hosted-potted-plant',
      parentId: BLOCK_ID,
      asset: {
        id: 'potted-plant',
        category: 'decor',
        name: 'Potted plant',
        thumbnail: '/potted-plant.png',
        src: '/potted-plant.glb',
        dimensions: [0.5, 0.39, 0.5],
      },
      position: [0.5, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      blockFaceId: 'face-top',
    })
    useScene.getState().createNode(hosted, BLOCK_ID as AnyNodeId)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().pause()

    const draft = draftNode!
    draft.adopt(hosted)
    draft.commit({
      parentId: LEVEL_ID,
      position: [2, 0, 3],
      rotation: [0, Math.PI / 4, 0],
      blockFaceId: undefined,
    })

    expect(useScene.getState().nodes[hosted.id as AnyNodeId]).toMatchObject({
      parentId: LEVEL_ID,
      position: [2, 0, 3],
      rotation: [0, Math.PI / 4, 0],
    })
    expect(
      (useScene.getState().nodes[hosted.id as AnyNodeId] as ItemNode).blockFaceId,
    ).toBeUndefined()
    expect((useScene.getState().nodes[BLOCK_ID as AnyNodeId] as BlockNode).children).not.toContain(
      hosted.id,
    )
    expect((useScene.getState().nodes[LEVEL_ID as AnyNodeId] as LevelNode).children).toContain(
      hosted.id,
    )

    useScene.temporal.getState().undo()

    expect(useScene.getState().nodes[hosted.id as AnyNodeId]).toMatchObject({
      parentId: BLOCK_ID,
      position: [0.5, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      blockFaceId: 'face-top',
    })
    expect((useScene.getState().nodes[BLOCK_ID as AnyNodeId] as BlockNode).children).toContain(
      hosted.id,
    )
    expect((useScene.getState().nodes[LEVEL_ID as AnyNodeId] as LevelNode).children).not.toContain(
      hosted.id,
    )
  })

  test('drops onto the level when the original host was deleted mid-carry', () => {
    const hosted = ItemNode.parse({
      id: 'item_host-deleted-plant',
      parentId: BLOCK_ID,
      asset: {
        id: 'potted-plant',
        category: 'decor',
        name: 'Potted plant',
        thumbnail: '/potted-plant.png',
        src: '/potted-plant.glb',
        dimensions: [0.5, 0.39, 0.5],
      },
      position: [0.5, 0, 0],
      blockFaceId: 'face-top',
    })
    useScene.getState().createNode(hosted, BLOCK_ID as AnyNodeId)
    useScene.temporal.getState().clear()

    const draft = draftNode!
    draft.adopt(hosted)
    draft.updateSurface({ parentId: LEVEL_ID, position: [1, 0, 1], blockFaceId: undefined }, null)
    // A collaborator deletes the block the item came from.
    useScene.getState().deleteNode(BLOCK_ID as AnyNodeId)
    draft.commit({ position: [2, 0, 3] })

    const nodes = useScene.getState().nodes
    expect(nodes[BLOCK_ID as AnyNodeId]).toBeUndefined()
    expect(nodes[hosted.id as AnyNodeId]).toMatchObject({ parentId: LEVEL_ID, position: [2, 0, 3] })
    expect((nodes[LEVEL_ID as AnyNodeId] as LevelNode).children).toContain(hosted.id)
    for (const state of useScene.temporal.getState().pastStates) {
      const recorded = state.nodes?.[hosted.id as AnyNodeId]
      if (recorded?.parentId) expect(state.nodes?.[recorded.parentId as AnyNodeId]).toBeDefined()
    }
  })

  test('cancel after the original host was deleted mid-carry keeps the item on the level', () => {
    const hosted = ItemNode.parse({
      id: 'item_host-deleted-cancel',
      parentId: BLOCK_ID,
      asset: {
        id: 'potted-plant',
        category: 'decor',
        name: 'Potted plant',
        thumbnail: '/potted-plant.png',
        src: '/potted-plant.glb',
        dimensions: [0.5, 0.39, 0.5],
      },
      position: [0.5, 0, 0],
      blockFaceId: 'face-top',
    })
    useScene.getState().createNode(hosted, BLOCK_ID as AnyNodeId)
    useScene.temporal.getState().clear()

    const draft = draftNode!
    draft.adopt(hosted)
    draft.updateSurface({ parentId: LEVEL_ID, position: [1, 0, 1], blockFaceId: undefined }, null)
    useScene.getState().deleteNode(BLOCK_ID as AnyNodeId)
    draft.destroy()

    const nodes = useScene.getState().nodes
    expect(nodes[hosted.id as AnyNodeId]?.parentId).toBe(LEVEL_ID)
    expect((nodes[LEVEL_ID as AnyNodeId] as LevelNode).children).toContain(hosted.id)
  })

  test("cancel and drop-then-undo keep a collaborator's later position", () => {
    const plant = ItemNode.parse({
      id: 'item_collab-position-plant',
      parentId: LEVEL_ID,
      asset: {
        id: 'potted-plant',
        category: 'decor',
        name: 'Potted plant',
        thumbnail: '/potted-plant.png',
        src: '/potted-plant.glb',
        dimensions: [0.5, 0.39, 0.5],
      },
      position: [0, 0, 0],
    })
    useScene.getState().createNode(plant, LEVEL_ID as AnyNodeId)
    const id = plant.id as AnyNodeId
    const position = () => (useScene.getState().nodes[id] as ItemNode).position

    // Escape keeps the collaborator's position.
    useScene.temporal.getState().clear()
    const draft = draftNode!
    draft.adopt(useScene.getState().nodes[id] as ItemNode)
    draft.updateSurface({ position: [1, 0, 1] }, null)
    useScene.getState().updateNode(id, { position: [7, 0, 7] })
    draft.destroy()
    expect(position()).toEqual([7, 0, 7])

    // Drop, then undo, returns to the collaborator's position.
    useScene.temporal.getState().clear()
    draft.adopt(useScene.getState().nodes[id] as ItemNode)
    draft.updateSurface({ position: [1, 0, 1] }, null)
    useScene.getState().updateNode(id, { position: [5, 0, 5] })
    draft.commit({ parentId: LEVEL_ID, position: [2, 0, 3] })
    expect(position()).toEqual([2, 0, 3])
    useScene.temporal.getState().undo()
    expect(position()).toEqual([5, 0, 5])
  })

  test("the 3D drop keeps an agent's metadata edit made during the carry, in one step", () => {
    const plant = ItemNode.parse({
      id: 'item_agent-metadata-plant',
      parentId: LEVEL_ID,
      asset: {
        id: 'potted-plant',
        category: 'decor',
        name: 'Potted plant',
        thumbnail: '/potted-plant.png',
        src: '/potted-plant.glb',
        dimensions: [0.5, 0.39, 0.5],
      },
      position: [0, 0, 0],
    })
    useScene.getState().createNode(plant, LEVEL_ID as AnyNodeId)
    const id = plant.id as AnyNodeId
    useScene.temporal.getState().clear()
    const draft = draftNode!
    draft.adopt(useScene.getState().nodes[id] as ItemNode)
    draft.updateSurface({ position: [1, 0, 1] }, null)
    const metadata = useScene.getState().nodes[id]!.metadata as Record<string, unknown>
    useScene.getState().updateNode(id, { metadata: { ...metadata, tag: 'x' } })
    const past = useScene.temporal.getState().pastStates.length
    // Placement strategies hand the drop the adoption-time metadata.
    draft.commit({ parentId: LEVEL_ID, position: [2, 0, 3], metadata: {} })

    const live = useScene.getState().nodes[id] as ItemNode
    expect(live.position).toEqual([2, 0, 3])
    expect((live.metadata as Record<string, unknown>).tag).toBe('x')
    expect((live.metadata as Record<string, unknown>).isTransient).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(past + 1)
    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[id] as ItemNode).position).toEqual([0, 0, 0])
  })

  test('never resumes history that another owner is pausing', () => {
    const hosted = ItemNode.parse({
      id: 'item_owned-pause-plant',
      parentId: LEVEL_ID,
      asset: {
        id: 'potted-plant',
        category: 'decor',
        name: 'Potted plant',
        thumbnail: '/potted-plant.png',
        src: '/potted-plant.glb',
        dimensions: [0.5, 0.39, 0.5],
      },
      position: [0, 0, 0],
    })
    useScene.getState().createNode(hosted, LEVEL_ID as AnyNodeId)
    useScene.temporal.getState().clear()
    pauseSceneHistory(useScene)
    try {
      const draft = draftNode!
      draft.adopt(hosted)
      draft.commit({ parentId: LEVEL_ID, position: [2, 0, 3] })
      draft.create(new Vector3(1, 0, 1), hosted.asset)
      draft.commit({ parentId: LEVEL_ID, position: [1, 0, 1] })

      expect(useScene.getState().nodes[hosted.id as AnyNodeId]).toMatchObject({
        position: [2, 0, 3],
      })
      expect(useScene.temporal.getState().isTracking).toBe(false)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(getSceneHistoryPauseDepth()).toBe(1)
    } finally {
      resumeSceneHistory(useScene)
    }
    expect(useScene.temporal.getState().isTracking).toBe(true)
  })

  test('keeps a hosted item visible through a block topology edit and its undo', () => {
    useScene.temporal.getState().pause()
    const draft = draftNode!
    draft.create(new Vector3(0, 0, 0), {
      id: 'potted-plant',
      category: 'decor',
      name: 'Potted plant',
      thumbnail: '/potted-plant.png',
      src: '/potted-plant.glb',
      dimensions: [0.5, 0.39, 0.5],
    })
    const committedId = draft.commit({
      parentId: BLOCK_ID,
      position: [0, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      blockFaceId: 'f-top',
    })!

    const beforeEdit = useScene.getState().nodes[BLOCK_ID as AnyNodeId] as BlockNode
    const topVertexIds = new Set(
      beforeEdit.topology.faces.find((face) => face.id === 'f-top')?.vertexIds ?? [],
    )
    const editedTopology = {
      ...beforeEdit.topology,
      vertices: beforeEdit.topology.vertices.map((vertex) =>
        topVertexIds.has(vertex.id)
          ? {
              ...vertex,
              position: [vertex.position[0], vertex.position[1] + 0.5, vertex.position[2]] as [
                number,
                number,
                number,
              ],
            }
          : vertex,
      ),
    }

    useScene.temporal.getState().resume()
    useScene.getState().updateNode(BLOCK_ID as AnyNodeId, { topology: editedTopology })
    useScene.temporal.getState().pause()

    const afterEdit = useScene.getState().nodes
    const editedHost = afterEdit[BLOCK_ID as AnyNodeId] as BlockNode
    expect(editedHost.children).toContain(committedId as ItemNode['id'])
    expect(afterEdit[committedId as AnyNodeId]).toMatchObject({
      parentId: BLOCK_ID,
      blockFaceId: 'f-top',
    })
    expect(getBlockFaceFrame(editedHost.topology, 'f-top')?.origin[1]).toBe(2.9)

    useScene.temporal.getState().undo()

    const afterUndo = useScene.getState().nodes
    const restoredHost = afterUndo[BLOCK_ID as AnyNodeId] as BlockNode
    expect(restoredHost.children).toContain(committedId as ItemNode['id'])
    expect(afterUndo[committedId as AnyNodeId]).toMatchObject({
      parentId: BLOCK_ID,
      blockFaceId: 'f-top',
    })
    expect(getBlockFaceFrame(restoredHost.topology, 'f-top')?.origin[1]).toBe(2.4)
  })

  test('commits before a stop-propagation leave can destroy the block-face draft', () => {
    useScene.temporal.getState().pause()
    const draft = draftNode!
    const transient = draft.create(new Vector3(), {
      id: 'potted-plant',
      category: 'decor',
      name: 'Potted plant',
      thumbnail: '/potted-plant.png',
      src: '/potted-plant.glb',
      dimensions: [0.5, 0.39, 0.5],
    })!
    Object.assign(transient, {
      parentId: BLOCK_ID,
      position: [0, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      blockFaceId: 'f-top',
    })
    useScene.getState().updateNode(transient.id, transient)

    const host = useScene.getState().nodes[BLOCK_ID as AnyNodeId] as BlockNode
    const geometry = new BufferGeometry()
    geometry.userData.blockFaces = [{ faceId: 'f-top', start: 0, count: 6 }]
    const object = new Mesh(geometry, new MeshBasicMaterial())
    object.updateMatrixWorld(true)
    const event: NodeEvent = {
      node: host,
      object,
      faceIndex: 0,
      position: [0, 2.4, 0],
      localPosition: [0, 2.4, 0],
      normal: [0, 1, 0],
      stopPropagation: () => draft.destroy(),
      nativeEvent: {} as NodeEvent['nativeEvent'],
    }
    const getContext = (): PlacementContext => ({
      asset: transient.asset,
      levelId: LEVEL_ID,
      draftItem: draft.current,
      gridPosition: new Vector3(),
      state: {
        surface: 'block-face',
        blockId: BLOCK_ID,
        wallId: null,
        roofSegmentId: null,
        ceilingId: null,
        surfaceItemId: null,
        shelfId: null,
      },
      currentCursorRotationY: 0,
    })

    const outcome = commitFaceHostClick({
      getContext,
      event,
      enterFaceHost: () => false,
      commitDraft: (nodeUpdate) => ({
        committedId: draft.commit(nodeUpdate),
        wasAdopted: draft.isAdopted,
      }),
    })

    expect(outcome?.committedId).not.toBeNull()
    expect(useScene.getState().nodes[outcome!.committedId as AnyNodeId]).toMatchObject({
      parentId: BLOCK_ID,
      blockFaceId: 'f-top',
      metadata: {},
    })
  })
})
