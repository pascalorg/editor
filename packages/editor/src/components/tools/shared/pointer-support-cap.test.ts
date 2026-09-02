import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  getWallBaseElevationForNodes,
  nodeRegistry,
  registerNode,
  type SlabNode,
  sceneRegistry,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from 'three'
import { z } from 'zod'
import useInteractionScope from '../../../store/use-interaction-scope'
import { createWallOnCurrentLevel } from '../wall/wall-drafting'
import { resolvePointerSupportSurface } from './pointer-support-cap'

const LEVEL_ID = 'level_test' as AnyNodeId
const WALL_ID = 'wall_test' as AnyNodeId
const PLATFORM_ID = 'plugin-platform_test' as AnyNodeId
const PLATFORM_KIND = 'plugin-platform'

describe('resolvePointerSupportSurface node tops', () => {
  beforeAll(() => {
    if (nodeRegistry.has(PLATFORM_KIND)) return
    registerNode({
      kind: PLATFORM_KIND,
      schemaVersion: 1,
      schema: z.object({}),
      category: 'structure',
      defaults: () => ({}),
      capabilities: { surfaces: { top: { height: 2 } } },
    } as unknown as AnyNodeDefinition)
  })

  beforeEach(() => {
    spatialGridManager.clear()
    sceneRegistry.clear()
    useInteractionScope.getState().end()
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

  const addPluginPlatform = (z = 0, size: [number, number, number] = [4, 2, 4]) => {
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [PLATFORM_ID]: {
          id: PLATFORM_ID,
          type: PLATFORM_KIND,
          object: 'node',
          parentId: LEVEL_ID,
          visible: true,
          metadata: {},
        } as unknown as AnyNode,
      },
    }))
    const platformMesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial())
    platformMesh.position.set(0, 1, z)
    platformMesh.updateMatrixWorld(true)
    sceneRegistry.nodes.set(PLATFORM_ID, platformMesh)
    sceneRegistry.byType[PLATFORM_KIND]!.add(PLATFORM_ID)
  }

  test('keeps an off-center orthographic ray on the cursor line', () => {
    const camera = new OrthographicCamera(-20, 20, 20, -20, -1000, 1000)
    camera.position.set(10, 10, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    const direction = camera.getWorldDirection(new Vector3())
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    const rayOrigin = camera.position.clone().addScaledVector(right, 3).addScaledVector(up, 2)
    const groundDistance = -rayOrigin.y / direction.y
    const worldHit = rayOrigin.clone().addScaledVector(direction, groundDistance)
    const topDistance = (2 - rayOrigin.y) / direction.y
    const expectedTop = rayOrigin.clone().addScaledVector(direction, topDistance)

    addPluginPlatform(expectedTop.z, [0.5, 2, 0.5])
    const platformMesh = sceneRegistry.nodes.get(PLATFORM_ID)!
    platformMesh.position.set(expectedTop.x, 1, expectedTop.z)
    platformMesh.updateMatrixWorld(true)

    const support = resolvePointerSupportSurface(
      camera,
      worldHit.toArray() as [number, number, number],
      {
        includeNodeTopSurfaces: true,
      },
    )

    expect(support?.sourceNodeId).toBe(PLATFORM_ID)
    expect(support?.worldPoint?.[0]).toBeCloseTo(expectedTop.x)
    expect(support?.worldPoint?.[1]).toBeCloseTo(expectedTop.y)
    expect(support?.worldPoint?.[2]).toBeCloseTo(expectedTop.z)
  })

  test('discovers a plugin-declared top surface without a kind-name list', () => {
    addPluginPlatform()

    const camera = new PerspectiveCamera()
    camera.position.set(0, 5, 0)
    camera.updateMatrixWorld(true)

    const support = resolvePointerSupportSurface(camera, [0, 0, 0], {
      includeNodeTopSurfaces: true,
    })

    expect(support?.sourceNodeId).toBe(PLATFORM_ID)
    expect(support?.elevation).toBeCloseTo(2)
    expect(support?.worldPoint).toEqual([0, 2, 0])
  })

  test('keeps the ground result unless node-top surfaces are asked for', () => {
    addPluginPlatform()

    const camera = new PerspectiveCamera()
    camera.position.set(0, 5, 0)
    camera.updateMatrixWorld(true)

    // The default. A floor placement aims THROUGH whatever upward-facing
    // geometry sits between the camera and the floor — a room's ceiling, the
    // top of the wall the ray passes over — so only the tools that build on a
    // surface opt in.
    for (const options of [undefined, { includeNodeTopSurfaces: false }]) {
      const support = resolvePointerSupportSurface(camera, [0, 0, 0], options)
      expect(support?.sourceNodeId).toBeNull()
      expect(support?.elevation).toBe(0)
    }
  })

  test('never elects the node the active interaction is placing or moving', () => {
    addPluginPlatform()
    useInteractionScope.getState().begin({
      kind: 'placing',
      node: useScene.getState().nodes[PLATFORM_ID]!,
      nodeId: PLATFORM_ID,
      nodeType: PLATFORM_KIND,
      view: '3d',
      pressDrag: false,
      driver: 'registry-tool',
    })

    const camera = new PerspectiveCamera()
    camera.position.set(0, 5, 0)
    camera.updateMatrixWorld(true)

    const support = resolvePointerSupportSurface(camera, [0, 0, 0], {
      includeNodeTopSurfaces: true,
    })

    // Its own top would raise it by its own height on every pointer move.
    expect(support?.sourceNodeId).toBeNull()
    expect(support?.elevation).toBe(0)
  })

  test('uses a plugin-declared top as the wall construction surface', () => {
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
      },
    }))
    spatialGridManager.handleNodeCreated(lowSlab as AnyNode, LEVEL_ID)
    spatialGridManager.handleNodeCreated(highSlab as AnyNode, LEVEL_ID)
    addPluginPlatform(2)

    const camera = new PerspectiveCamera()
    camera.position.set(0, 5, 2)
    camera.updateMatrixWorld(true)

    const support = resolvePointerSupportSurface(camera, [0, 0, 2], {
      includeNodeTopSurfaces: true,
    })

    expect(support?.sourceNodeId).toBe(PLATFORM_ID)
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

  test('tolerates a registered definition without capabilities', () => {
    // Gates the pollution class behind the night-8 CI flake (run
    // 32580694134): `capabilities` is typed required, but a minimal plugin
    // definition (or a leaked test fixture) can ship without it at runtime.
    // The resolver enumerates every registered kind, so one capabilities-less
    // entry must read as "no top surface" — not crash the election.
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      registerNode({
        kind: 'plugin-minimal-capless',
        schemaVersion: 1,
        schema: z.object({}),
        category: 'structure',
        defaults: () => ({}),
        // No `capabilities` — deliberately.
      } as unknown as AnyNodeDefinition)
      addPluginPlatform()

      const camera = new PerspectiveCamera()
      camera.position.set(0, 5, 0)
      camera.updateMatrixWorld(true)

      const support = resolvePointerSupportSurface(camera, [0, 0, 0], {
        includeNodeTopSurfaces: true,
      })

      // No throw, and the election still works: the capabilities-less kind is
      // skipped while the platform's declared top is found as usual.
      expect(support?.sourceNodeId).toBe(PLATFORM_ID)
      expect(support?.elevation).toBeCloseTo(2)
    } finally {
      restoreRegistry()
    }
  })
})
