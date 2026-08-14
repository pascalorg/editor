import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  type CustomMeshEvent,
  CustomMeshNode,
  getCustomMeshFaceFrame,
  ItemNode,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { renderToString } from 'react-dom/server'
import { BufferGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { commitCustomMeshClick } from './custom-mesh-commit'
import type { PlacementContext } from './placement-types'
import { type DraftNodeHandle, useDraftNode } from './use-draft-node'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const BUILDING_ID = 'building_draft_custom_mesh'
const LEVEL_ID = 'level_draft_custom_mesh'
const CUSTOM_MESH_ID = 'custom-mesh_draft_host'

let draftNode: DraftNodeHandle | null = null

function DraftHarness() {
  draftNode = useDraftNode()
  return null
}

beforeEach(() => {
  const customMesh = CustomMeshNode.parse({
    id: CUSTOM_MESH_ID,
    parentId: LEVEL_ID,
  })
  const level = LevelNode.parse({
    id: LEVEL_ID,
    parentId: BUILDING_ID,
    children: [CUSTOM_MESH_ID],
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
      [CUSTOM_MESH_ID]: customMesh,
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

describe('useDraftNode custom-mesh face commit', () => {
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
      parentId: CUSTOM_MESH_ID,
      position: [0.5, -0.5, 0],
      rotation: [0, 0, 0],
      customMeshFaceId: 'face-front',
    })

    const committed = useScene.getState().nodes[committedId as AnyNodeId]
    expect(committed).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      position: [0.5, -0.5, 0],
      customMeshFaceId: 'face-front',
    })
  })

  test('keeps a custom-face placement visible until undo removes the committed item', () => {
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
      parentId: CUSTOM_MESH_ID,
      position: [0.5, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      customMeshFaceId: 'face-top',
    })!

    const afterCommit = useScene.getState().nodes
    expect(afterCommit[transient.id as AnyNodeId]).toBeUndefined()
    expect(afterCommit[committedId as AnyNodeId]).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      customMeshFaceId: 'face-top',
    })
    expect((afterCommit[CUSTOM_MESH_ID as AnyNodeId] as CustomMeshNode).children).toContain(
      committedId as ItemNode['id'],
    )

    useScene.temporal.getState().undo()

    const afterUndo = useScene.getState().nodes
    expect(afterUndo[committedId as AnyNodeId]).toBeUndefined()
    expect(afterUndo[transient.id as AnyNodeId]).toBeUndefined()
    expect((afterUndo[CUSTOM_MESH_ID as AnyNodeId] as CustomMeshNode).children).not.toContain(
      committedId as ItemNode['id'],
    )
  })

  test('moves a custom-face item to the floor as one undoable reparent', () => {
    const hosted = ItemNode.parse({
      id: 'item_hosted-potted-plant',
      parentId: CUSTOM_MESH_ID,
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
      customMeshFaceId: 'face-top',
    })
    useScene.getState().createNode(hosted, CUSTOM_MESH_ID as AnyNodeId)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().pause()

    const draft = draftNode!
    draft.adopt(hosted)
    draft.commit({
      parentId: LEVEL_ID,
      position: [2, 0, 3],
      rotation: [0, Math.PI / 4, 0],
      customMeshFaceId: undefined,
    })

    expect(useScene.getState().nodes[hosted.id as AnyNodeId]).toMatchObject({
      parentId: LEVEL_ID,
      position: [2, 0, 3],
      rotation: [0, Math.PI / 4, 0],
    })
    expect(
      (useScene.getState().nodes[hosted.id as AnyNodeId] as ItemNode).customMeshFaceId,
    ).toBeUndefined()
    expect(
      (useScene.getState().nodes[CUSTOM_MESH_ID as AnyNodeId] as CustomMeshNode).children,
    ).not.toContain(hosted.id)
    expect((useScene.getState().nodes[LEVEL_ID as AnyNodeId] as LevelNode).children).toContain(
      hosted.id,
    )

    useScene.temporal.getState().undo()

    expect(useScene.getState().nodes[hosted.id as AnyNodeId]).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      position: [0.5, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      customMeshFaceId: 'face-top',
    })
    expect(
      (useScene.getState().nodes[CUSTOM_MESH_ID as AnyNodeId] as CustomMeshNode).children,
    ).toContain(hosted.id)
    expect((useScene.getState().nodes[LEVEL_ID as AnyNodeId] as LevelNode).children).not.toContain(
      hosted.id,
    )
  })

  test('keeps a hosted item visible through a custom-mesh topology edit and its undo', () => {
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
      parentId: CUSTOM_MESH_ID,
      position: [0, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      customMeshFaceId: 'f-top',
    })!

    const beforeEdit = useScene.getState().nodes[CUSTOM_MESH_ID as AnyNodeId] as CustomMeshNode
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
    useScene.getState().updateNode(CUSTOM_MESH_ID as AnyNodeId, { topology: editedTopology })
    useScene.temporal.getState().pause()

    const afterEdit = useScene.getState().nodes
    const editedHost = afterEdit[CUSTOM_MESH_ID as AnyNodeId] as CustomMeshNode
    expect(editedHost.children).toContain(committedId as ItemNode['id'])
    expect(afterEdit[committedId as AnyNodeId]).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      customMeshFaceId: 'f-top',
    })
    expect(getCustomMeshFaceFrame(editedHost.topology, 'f-top')?.origin[1]).toBe(2.9)

    useScene.temporal.getState().undo()

    const afterUndo = useScene.getState().nodes
    const restoredHost = afterUndo[CUSTOM_MESH_ID as AnyNodeId] as CustomMeshNode
    expect(restoredHost.children).toContain(committedId as ItemNode['id'])
    expect(afterUndo[committedId as AnyNodeId]).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      customMeshFaceId: 'f-top',
    })
    expect(getCustomMeshFaceFrame(restoredHost.topology, 'f-top')?.origin[1]).toBe(2.4)
  })

  test('commits before a stop-propagation leave can destroy the custom-face draft', () => {
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
      parentId: CUSTOM_MESH_ID,
      position: [0, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      customMeshFaceId: 'f-top',
    })
    useScene.getState().updateNode(transient.id, transient)

    const host = useScene.getState().nodes[CUSTOM_MESH_ID as AnyNodeId] as CustomMeshNode
    const geometry = new BufferGeometry()
    geometry.userData.customMeshFaces = [{ faceId: 'f-top', start: 0, count: 6 }]
    const object = new Mesh(geometry, new MeshBasicMaterial())
    object.updateMatrixWorld(true)
    const event: CustomMeshEvent = {
      node: host,
      object,
      faceIndex: 0,
      position: [0, 2.4, 0],
      localPosition: [0, 2.4, 0],
      normal: [0, 1, 0],
      stopPropagation: () => draft.destroy(),
      nativeEvent: {} as CustomMeshEvent['nativeEvent'],
    }
    const getContext = (): PlacementContext => ({
      asset: transient.asset,
      levelId: LEVEL_ID,
      draftItem: draft.current,
      gridPosition: new Vector3(),
      state: {
        surface: 'custom-mesh-face',
        customMeshId: CUSTOM_MESH_ID,
        wallId: null,
        roofSegmentId: null,
        ceilingId: null,
        surfaceItemId: null,
        shelfId: null,
      },
      currentCursorRotationY: 0,
    })

    const outcome = commitCustomMeshClick({
      getContext,
      event,
      enterCustomMeshFace: () => false,
      commitDraft: (nodeUpdate) => ({
        committedId: draft.commit(nodeUpdate),
        wasAdopted: draft.isAdopted,
      }),
    })

    expect(outcome?.committedId).not.toBeNull()
    expect(useScene.getState().nodes[outcome!.committedId as AnyNodeId]).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      customMeshFaceId: 'f-top',
      metadata: {},
    })
  })
})
