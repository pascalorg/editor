import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  getWallBaseElevationForNodes,
  type SlabNode,
  sceneRegistry,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three'
import { createWallOnCurrentLevel } from '../wall/wall-drafting'
import { resolvePointerSupportSurface } from './pointer-support-cap'

const LEVEL_ID = 'level_test' as AnyNodeId
const WALL_ID = 'wall_test' as AnyNodeId
const CUSTOM_MESH_ID = 'custom-mesh_test' as AnyNodeId

describe('resolvePointerSupportSurface node tops', () => {
  beforeEach(() => {
    spatialGridManager.clear()
    sceneRegistry.clear()
    useViewer.setState({
      selection: {
        buildingId: null,
        levelId: LEVEL_ID,
        zoneId: null,
        selectedIds: [],
      },
    } as never)
    useScene.setState({
      nodes: {
        [LEVEL_ID]: {
          id: LEVEL_ID,
          type: 'level',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: [WALL_ID],
          level: 0,
        } as AnyNode,
        [WALL_ID]: {
          id: WALL_ID,
          type: 'wall',
          object: 'node',
          parentId: LEVEL_ID,
          visible: true,
          metadata: {},
          children: [],
          assemblyLayers: [],
          start: [-1, 0],
          end: [1, 0],
          frontSide: 'unknown',
          backSide: 'unknown',
        } as AnyNode,
      },
    })
  })

  afterEach(() => {
    sceneRegistry.clear()
  })

  test('prefers the nearest upward-facing registered node surface over the ground', () => {
    const wallMesh = new Mesh(new BoxGeometry(2, 2, 0.2), new MeshBasicMaterial())
    wallMesh.position.y = 1
    wallMesh.updateMatrixWorld(true)
    sceneRegistry.nodes.set(WALL_ID, wallMesh)
    sceneRegistry.byType.wall!.add(WALL_ID)

    const camera = new PerspectiveCamera()
    camera.position.set(0, 5, 0)
    camera.updateMatrixWorld(true)

    const support = resolvePointerSupportSurface(camera, [0, 0, 0], {
      includeNodeTopSurfaces: true,
    })

    expect(support?.sourceNodeId).toBe(WALL_ID)
    expect(support?.elevation).toBeCloseTo(2)
    expect(support?.worldPoint).toEqual([0, 2, 0])
  })

  test('keeps the ground result when node-top surfaces are not requested', () => {
    const wallMesh = new Mesh(new BoxGeometry(2, 2, 0.2), new MeshBasicMaterial())
    wallMesh.position.y = 1
    wallMesh.updateMatrixWorld(true)
    sceneRegistry.nodes.set(WALL_ID, wallMesh)
    sceneRegistry.byType.wall!.add(WALL_ID)

    const camera = new PerspectiveCamera()
    camera.position.set(0, 5, 0)
    camera.updateMatrixWorld(true)

    const support = resolvePointerSupportSurface(camera, [0, 0, 0])

    expect(support?.sourceNodeId).toBeNull()
    expect(support?.elevation).toBe(0)
  })

  test('uses an upward-facing custom mesh for ordinary placement tools', () => {
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [CUSTOM_MESH_ID]: {
          id: CUSTOM_MESH_ID,
          type: 'custom-mesh',
          object: 'node',
          parentId: LEVEL_ID,
          visible: true,
          metadata: {},
          children: [],
          position: [0, 0, 0],
          rotation: 0,
          topology: { vertices: [], edges: [], faces: [] },
        } as AnyNode,
      },
    }))
    const platformMesh = new Mesh(new BoxGeometry(4, 2, 4), new MeshBasicMaterial())
    platformMesh.position.y = 1
    platformMesh.updateMatrixWorld(true)
    sceneRegistry.nodes.set(CUSTOM_MESH_ID, platformMesh)
    sceneRegistry.byType['custom-mesh']!.add(CUSTOM_MESH_ID)

    const camera = new PerspectiveCamera()
    camera.position.set(0, 5, 0)
    camera.updateMatrixWorld(true)

    const support = resolvePointerSupportSurface(camera, [0, 0, 0])

    expect(support?.sourceNodeId).toBe(CUSTOM_MESH_ID)
    expect(support?.elevation).toBeCloseTo(2)
    expect(support?.worldPoint).toEqual([0, 2, 0])
  })

  test('uses an upward-facing custom mesh as the wall construction surface', () => {
    const lowSlab = {
      id: 'slab_low',
      type: 'slab',
      object: 'node',
      parentId: LEVEL_ID,
      visible: true,
      metadata: {},
      children: [],
      polygon: [
        [-2, 1],
        [2, 1],
        [2, 3],
        [-2, 3],
      ],
      holes: [],
      holeMetadata: [],
      elevation: 0.25,
      thickness: 0.25,
      recessed: false,
      autoFromWalls: false,
    } as SlabNode
    const highSlab = {
      ...lowSlab,
      id: 'slab_high',
      polygon: [
        [-1, 1],
        [0, 1],
        [0, 3],
        [-1, 3],
      ],
      elevation: 1,
    } as SlabNode
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [lowSlab.id]: lowSlab,
        [highSlab.id]: highSlab,
        [CUSTOM_MESH_ID]: {
          id: CUSTOM_MESH_ID,
          type: 'custom-mesh',
          object: 'node',
          parentId: LEVEL_ID,
          visible: true,
          metadata: {},
          children: [],
          position: [0, 0, 0],
          rotation: 0,
          topology: { vertices: [], edges: [], faces: [] },
        } as AnyNode,
      },
    }))
    spatialGridManager.handleNodeCreated(lowSlab as AnyNode, LEVEL_ID)
    spatialGridManager.handleNodeCreated(highSlab as AnyNode, LEVEL_ID)
    const platformMesh = new Mesh(new BoxGeometry(4, 2, 4), new MeshBasicMaterial())
    platformMesh.position.y = 1
    platformMesh.position.z = 2
    platformMesh.updateMatrixWorld(true)
    sceneRegistry.nodes.set(CUSTOM_MESH_ID, platformMesh)
    sceneRegistry.byType['custom-mesh']!.add(CUSTOM_MESH_ID)

    const camera = new PerspectiveCamera()
    camera.position.set(0, 5, 2)
    camera.updateMatrixWorld(true)

    const support = resolvePointerSupportSurface(camera, [0, 0, 2], {
      includeNodeTopSurfaces: true,
    })

    expect(support?.sourceNodeId).toBe(CUSTOM_MESH_ID)
    expect(support?.elevation).toBeCloseTo(2)
    expect(support?.worldPoint).toEqual([0, 2, 2])

    const wall = createWallOnCurrentLevel([-0.75, 2], [0.75, 2], {
      supportCap: support?.elevation,
      preferredSupportSlabId: support?.supportSlabId,
      constructionElevation: support?.elevation,
      constructionHeight: 2.5,
      flatConstructionBase: support?.sourceNodeId != null,
    })
    expect(wall).not.toBeNull()
    expect(getWallBaseElevationForNodes(wall!, useScene.getState().nodes)).toBeCloseTo(2)
    const wallSupport = spatialGridManager.getSlabSupportForWall(
      LEVEL_ID,
      wall!.start,
      wall!.end,
      wall!.curveOffset,
      wall!.thickness,
      wall!.supportSlabId,
      undefined,
      wall!.supportOffset,
    )
    expect(
      wallSupport.baseSegments.every((segment) => Math.abs(segment.elevation - 2) < 1e-6),
    ).toBe(true)
  })
})
