import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  sceneRegistry,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three'
import { resolvePointerSupportSurface } from './pointer-support-cap'

const LEVEL_ID = 'level_test' as AnyNodeId
const WALL_ID = 'wall_test' as AnyNodeId

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
})
