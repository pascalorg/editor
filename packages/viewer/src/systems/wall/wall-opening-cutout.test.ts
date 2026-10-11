// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  calculateLevelMiters,
  DoorNode,
  getOpeningWallPlacement,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallPlaneTop,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  runAsSceneCommitAuthor,
  sceneRegistry,
  useScene,
  WallNode,
  WindowNode,
  wallSupportForNodes,
} from '@pascal-app/core'
import * as THREE from 'three'
import structure from '../../../../core/src/utils/__fixtures__/project_hrY3qVVq16yo5Out.json'
import { startConstructionReveal } from '../construction-reveal/construction-reveal'
import openings from './__fixtures__/wawa-house-openings.json'
import { generateExtrudedWall, wallGeometryChildren } from './wall-system'

describe('wall opening cutout', () => {
  test('cuts a floor-level door directly from node geometry without a proxy mesh', () => {
    const wall = WallNode.parse({
      id: 'wall_floor-opening-cutout',
      start: [0, 0],
      end: [2, 0],
      height: 2.5,
      thickness: 0.1,
    })
    const door = DoorNode.parse({
      id: 'door_floor-opening-cutout',
      wallId: wall.id,
      position: [1, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    const wallMesh = new THREE.Mesh()
    sceneRegistry.nodes.set(wall.id, wallMesh)

    try {
      const geometry = generateExtrudedWall(wall, [door], calculateLevelMiters([wall]))
      const position = geometry.getAttribute('position')
      const index = geometry.index
      const openingLeft = door.position[0] - door.width / 2
      const openingRight = door.position[0] + door.width / 2
      let wallFaceTrianglesInsideOpening = 0
      let baseTrianglesInsideOpening = 0

      for (let offset = 0; offset < (index?.count ?? position.count); offset += 3) {
        const indices = [0, 1, 2].map((corner) =>
          index ? index.getX(offset + corner) : offset + corner,
        )
        const vertices = indices.map(
          (vertexIndex) =>
            new THREE.Vector3(
              position.getX(vertexIndex),
              position.getY(vertexIndex),
              position.getZ(vertexIndex),
            ),
        )
        const centroid = vertices
          .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
          .multiplyScalar(1 / 3)
        const insideOpeningX = centroid.x > openingLeft + 1e-4 && centroid.x < openingRight - 1e-4
        if (!insideOpeningX) continue

        const onWallFace = vertices.every(
          (vertex) => Math.abs(Math.abs(vertex.z) - (wall.thickness ?? 0.1) / 2) < 1e-5,
        )
        if (onWallFace && centroid.y > 1e-4 && centroid.y < door.height - 1e-4) {
          wallFaceTrianglesInsideOpening += 1
        }

        if (vertices.every((vertex) => Math.abs(vertex.y) < 1e-5)) {
          baseTrianglesInsideOpening += 1
        }
      }

      expect(wallFaceTrianglesInsideOpening).toBe(0)
      expect(baseTrianglesInsideOpening).toBe(0)
      geometry.dispose()
    } finally {
      sceneRegistry.nodes.delete(wall.id)
      wallMesh.geometry.dispose()
    }
  })
})

test('curved walls cut rectangular and arched openings along the arc', () => {
  const wall = WallNode.parse({
    id: 'wall_curved-opening-cutout',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
    curveOffset: 0.6,
  })
  const length = getWallCurveLength(wall)
  const door = DoorNode.parse({
    id: 'door_curved-opening-cutout',
    wallId: wall.id,
    position: [length * 0.3, 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const arched = WindowNode.parse({
    id: 'window_curved-opening-cutout',
    wallId: wall.id,
    position: [length * 0.7, 1.4, 0],
    width: 0.8,
    height: 1,
    openingShape: 'arch',
  })
  const wallMesh = new THREE.Mesh()
  sceneRegistry.nodes.set(wall.id, wallMesh)
  try {
    const geometry = generateExtrudedWall(wall, [door, arched], calculateLevelMiters([wall]))
    const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    // The wall runs along +x from the origin, so wall-local equals plan coordinates.
    const hits = (station: number, y: number) => {
      const { point, normal } = getWallCurveFrameAt(wall, station / length)
      return (
        new THREE.Raycaster(
          new THREE.Vector3(point.x - normal.x, y, point.y - normal.y),
          new THREE.Vector3(normal.x, 0, normal.y),
          0,
          2,
        ).intersectObject(body).length > 0
      )
    }
    for (const u of [-0.3, 0, 0.3]) {
      expect(hits(door.position[0] + door.width * u, 1)).toBe(false)
      expect(hits(arched.position[0] + arched.width * u, 1.2)).toBe(false)
    }
    expect(hits(length * 0.5, 1.2)).toBe(true)
    expect(hits(door.position[0], 2.3)).toBe(true)
    geometry.dispose()
  } finally {
    sceneRegistry.nodes.delete(wall.id)
    wallMesh.geometry.dispose()
  }
})

// Prod "Wawa House" (level 0) with doors and windows that stopped cutting their
// walls: the cutter was the aperture clipped to the wall's own footprint, so its
// sides lay on the wall faces and the coplanar CSG subtraction kept the wall.
// Covers a slightly skewed wall (area drift), doors hanging past a short wall's
// end whose sill drops to the plate, windows, and a wall-hosted decor item.
describe('Wawa House openings', () => {
  test('every door, window and wall item cuts its wall after the real load path', () => {
    useScene
      .getState()
      .setScene({ ...structure, ...openings } as unknown as Record<AnyNodeId, AnyNode>, [
        'site_mvx8m7yyc39e1smp' as AnyNodeId,
      ])
    const nodes = useScene.getState().nodes as Record<string, AnyNode>
    const walls = Object.values(nodes).filter((node): node is WallNode => node.type === 'wall')
    const miters = calculateLevelMiters(walls)
    const registered: THREE.Mesh[] = []
    const failures: string[] = []
    try {
      for (const wall of walls) {
        const children = wall.children
          .map((id) => nodes[id])
          .filter((child): child is AnyNode => child !== undefined)
        if (!children.length) continue
        const support = wallSupportForNodes(wall, nodes)
        const wallMesh = new THREE.Mesh()
        wallMesh.position.set(wall.start[0], support.elevation, wall.start[1])
        wallMesh.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
        sceneRegistry.nodes.set(wall.id, wallMesh)
        registered.push(wallMesh)
        // Wall items cut through their GLB's `cutout` proxy, posed under the wall.
        const targets: Array<{ id: string; x: number; y: number; w: number; h: number }> = []
        for (const child of children) {
          if (child.type === 'item') {
            const [w, h, d] = child.asset.dimensions
            const group = new THREE.Group()
            group.position.set(...child.position)
            const cutout = new THREE.Mesh(new THREE.BoxGeometry(w, h, d))
            cutout.name = 'cutout'
            group.add(cutout)
            wallMesh.add(group)
            sceneRegistry.nodes.set(child.id, group)
            targets.push({ id: child.id, x: child.position[0], y: child.position[1], w, h })
          } else if (child.type === 'door' || child.type === 'window') {
            const [x, y] = getOpeningWallPlacement(wall, child, nodes).position
            targets.push({ id: child.id, x, y, w: child.width, h: child.height })
          }
        }
        wallMesh.updateMatrixWorld(true)
        const geometry = generateExtrudedWall(
          wall,
          children,
          miters,
          support.elevation,
          support.baseElevation,
          support.baseSegments,
          getWallPlaneTop(wall, wall.parentId!, nodes),
          undefined,
          support.faceDatum,
          undefined,
          nodes,
        )
        const body = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
        )
        const hits = (x: number, y: number) =>
          new THREE.Raycaster(
            new THREE.Vector3(x, y, -2),
            new THREE.Vector3(0, 0, 1),
            0,
            4,
          ).intersectObject(body).length > 0
        for (const target of targets) {
          for (const u of [-0.3, 0, 0.3])
            for (const v of [-0.25, 0, 0.25])
              if (hits(target.x + target.w * u, target.y + target.h * v))
                failures.push(`${target.id} uncut at (${u}, ${v})`)
        }
        // The cut stays local: the wall stands 5 cm beside every opening.
        for (const target of targets)
          for (const x of [target.x - target.w / 2 - 0.05, target.x + target.w / 2 + 0.05]) {
            const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
            const inAnother = targets.some((other) => Math.abs(x - other.x) < other.w / 2 + 0.01)
            if (x > 0.1 && x < length - 0.1 && !inAnother && !hits(x, target.y))
              failures.push(`${wall.id} missing beside ${target.id}`)
          }
        geometry.dispose()
      }
      expect(failures).toEqual([])
    } finally {
      for (const node of Object.values(nodes)) sceneRegistry.nodes.delete(node.id)
      for (const mesh of registered) mesh.geometry.dispose()
      useScene.getState().unloadScene()
    }
  })
})

// Victor run 12: walls rose with their window holes cut while the windows waited for the openings
// phase. The user's pick: a wall stays whole until each opening's own turn.
describe('an opening waiting for its construction reveal', () => {
  test('cuts no hole in its wall until its turn comes', async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
    const previousScene = useScene.getState()
    const definition = (kind: string, schema: typeof WallNode | typeof DoorNode, reveal?: object) =>
      ({
        kind,
        schemaVersion: 1,
        schema,
        category: 'structure',
        defaults: () => ({}),
        capabilities: reveal ? { reveal } : {},
      }) as unknown as AnyNodeDefinition
    await loadPlugin({
      id: 'fixture:opening-reveal',
      apiVersion: 1,
      nodes: [
        definition('wall', WallNode),
        definition('door', DoorNode, { phase: 'openings', style: 'cut' }),
      ],
    })
    const level = LevelNode.parse({ id: 'level_reveal', level: 0, children: [] })
    const wall = WallNode.parse({
      id: 'wall_reveal-opening',
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 0.2,
    })
    const door = DoorNode.parse({
      id: 'door_reveal-opening',
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    useScene.getState().setScene({ [level.id]: level } as never, [level.id] as AnyNodeId[], {
      installedPlugins: ['fixture:opening-reveal'],
      hasExplicitPluginInstallState: true,
    })
    useScene.getState().createNode(wall, level.id as AnyNodeId)
    const driver = startConstructionReveal({
      reveals: (commit) => commit.author === 'agent',
      prefersReducedMotion: () => false,
    })
    const wallMesh = new THREE.Mesh()
    sceneRegistry.nodes.set(wall.id, wallMesh)
    const solidAtDoor = () => {
      const nodes = useScene.getState().nodes
      const hosted = nodes[wall.id as AnyNodeId] as WallNode
      const geometry = generateExtrudedWall(
        hosted,
        wallGeometryChildren(hosted, nodes),
        calculateLevelMiters([wall]),
      )
      const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
      const hit =
        new THREE.Raycaster(
          new THREE.Vector3(2, 1, -1),
          new THREE.Vector3(0, 0, 1),
          0,
          2,
        ).intersectObject(body).length > 0
      geometry.dispose()
      return hit
    }
    try {
      runAsSceneCommitAuthor('agent', () =>
        useScene.getState().createNode(door, wall.id as AnyNodeId),
      )
      expect(solidAtDoor()).toBe(true)
      driver.stop()
      expect(solidAtDoor()).toBe(false)
    } finally {
      driver.stop()
      sceneRegistry.nodes.delete(wall.id)
      useScene.setState(previousScene)
      restoreRegistry()
    }
  })
})
