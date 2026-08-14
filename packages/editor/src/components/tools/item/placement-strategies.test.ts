import { describe, expect, test } from 'bun:test'
import { type CustomMeshEvent, CustomMeshNode, ItemNode, type LevelNode } from '@pascal-app/core'
import { BufferGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { customMeshFaceStrategy } from './placement-strategies'
import type { PlacementContext } from './placement-types'

const CUSTOM_MESH_ID = 'custom-mesh_ceiling-host'
const LEVEL_ID = 'level_ceiling-host' as LevelNode['id']

function ceilingContext(): PlacementContext {
  return {
    asset: {
      id: 'ceiling-light',
      category: 'lighting',
      name: 'Ceiling light',
      thumbnail: '/ceiling-light.png',
      src: '/ceiling-light.glb',
      dimensions: [1, 0.25, 1],
      attachTo: 'ceiling',
    },
    levelId: LEVEL_ID,
    draftItem: null,
    gridPosition: new Vector3(),
    state: {
      surface: 'floor',
      wallId: null,
      roofSegmentId: null,
      customMeshId: null,
      ceilingId: null,
      surfaceItemId: null,
      shelfId: null,
    },
    currentCursorRotationY: 0,
  }
}

function floorItemContext(): PlacementContext {
  return {
    ...ceilingContext(),
    asset: {
      id: 'potted-plant',
      category: 'decor',
      name: 'Potted plant',
      thumbnail: '/potted-plant.png',
      src: '/potted-plant.glb',
      dimensions: [0.5, 0.39, 0.5],
    },
  }
}

function bottomFaceEvent(): CustomMeshEvent {
  const node = CustomMeshNode.parse({ id: CUSTOM_MESH_ID, parentId: LEVEL_ID })
  const geometry = new BufferGeometry()
  geometry.userData.customMeshFaces = [{ faceId: 'f-bottom', start: 0, count: 6 }]
  const object = new Mesh(geometry, new MeshBasicMaterial())
  object.updateMatrixWorld(true)

  return {
    node,
    object,
    faceIndex: 0,
    position: [0, 0, 0],
    localPosition: [0, 0, 0],
    normal: [0, -1, 0],
    stopPropagation: () => {},
    nativeEvent: {} as CustomMeshEvent['nativeEvent'],
  }
}

function topFaceEvent(): CustomMeshEvent {
  const node = CustomMeshNode.parse({ id: CUSTOM_MESH_ID, parentId: LEVEL_ID })
  const geometry = new BufferGeometry()
  geometry.userData.customMeshFaces = [{ faceId: 'f-top', start: 0, count: 6 }]
  const object = new Mesh(geometry, new MeshBasicMaterial())
  object.updateMatrixWorld(true)

  return {
    node,
    object,
    faceIndex: 0,
    position: [0, 2.4, 0],
    localPosition: [0, 2.4, 0],
    normal: [0, 1, 0],
    stopPropagation: () => {},
    nativeEvent: {} as CustomMeshEvent['nativeEvent'],
  }
}

describe('customMeshFaceStrategy', () => {
  test('hosts a ceiling item on a downward-facing custom-mesh face', () => {
    const result = customMeshFaceStrategy.enter(ceilingContext(), bottomFaceEvent())

    expect(result).not.toBeNull()
    expect(result?.stateUpdate).toMatchObject({
      surface: 'custom-mesh-face',
      customMeshId: CUSTOM_MESH_ID,
    })
    expect(result?.nodeUpdate).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      customMeshFaceId: 'f-bottom',
      position: [0, 0, 0.25],
      rotation: [-Math.PI / 2, 0, 0],
    } satisfies Partial<ItemNode>)
    expect(result?.cursorPosition).toEqual([0, -0.25, 0])
  })

  test('hosts a floor item on an upward-facing custom-mesh face', () => {
    const context = floorItemContext()
    const event = topFaceEvent()
    const result = customMeshFaceStrategy.enter(context, event)

    expect(result).not.toBeNull()
    expect(result?.stateUpdate).toMatchObject({
      surface: 'custom-mesh-face',
      customMeshId: CUSTOM_MESH_ID,
    })
    expect(result?.nodeUpdate).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      customMeshFaceId: 'f-top',
      position: [0, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
    } satisfies Partial<ItemNode>)
    expect(result?.cursorPosition).toEqual([0, 2.4, 0])

    context.draftItem = ItemNode.parse({
      id: 'item_potted-plant',
      parentId: CUSTOM_MESH_ID,
      asset: context.asset,
      ...result?.nodeUpdate,
    })
    Object.assign(context.state, result?.stateUpdate)
    context.gridPosition.set(...result!.gridPosition)

    expect(customMeshFaceStrategy.click(context, event)?.nodeUpdate).toMatchObject({
      parentId: CUSTOM_MESH_ID,
      customMeshFaceId: 'f-top',
      position: [0, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
    } satisfies Partial<ItemNode>)
  })

  test('restores floor-local position and rotation when an item leaves a custom-mesh face', () => {
    const context = floorItemContext()
    context.state.surface = 'custom-mesh-face'
    context.state.customMeshId = CUSTOM_MESH_ID
    context.currentCursorRotationY = Math.PI / 4
    context.gridPosition.set(1, -0.5, 2)
    context.draftItem = ItemNode.parse({
      id: 'item_moving-potted-plant',
      parentId: CUSTOM_MESH_ID,
      asset: context.asset,
      position: [0, 0, 0],
      rotation: [Math.PI / 2, Math.PI / 4, 0],
      customMeshFaceId: 'f-top',
    })

    expect(customMeshFaceStrategy.leave(context)).toMatchObject({
      nodeUpdate: {
        parentId: LEVEL_ID,
        customMeshFaceId: undefined,
        position: [1, 0, 2],
        rotation: [0, Math.PI / 4, 0],
      } satisfies Partial<ItemNode>,
      gridPosition: [1, 0, 2],
      cursorPosition: [1, 0, 2],
    })
  })
})
