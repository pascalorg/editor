import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, sceneRegistry, useScene } from '@pascal-app/core'
import { verifyScene } from '@pascal-app/core/agent-operations'
import { ItemNode, LevelNode, WallNode, WindowNode } from '@pascal-app/core/schema'
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import { registerWallObjectSceneCheck, wallObjectRenderedObservations } from '../index'

const previous = useScene.getState()
const registered: string[] = []
const geometries: BufferGeometry[] = []
const material = new MeshStandardMaterial()
afterEach(() => {
  for (const id of registered.splice(0)) sceneRegistry.nodes.delete(id)
  for (const geometry of geometries.splice(0)) geometry.dispose()
  useScene.setState(previous)
})

function box(group: Group, w: number, h: number, d: number, x: number, y: number, z: number) {
  const geometry = new BoxGeometry(w, h, d)
  geometries.push(geometry)
  const mesh = new Mesh(geometry, material)
  mesh.position.set(x, y, z)
  group.add(mesh)
}

// The owner's authored geometry, including the flush acoustic back and speaker cones.
function cinemaScreen() {
  const group = new Group()
  box(group, 6.6, 2.5, 0.08, 0, 1.25, 0.04)
  box(group, 4.85, 2.32, 0.06, 0, 1.25, 0.11)
  box(group, 4.72, 2.19, 0.035, 0, 1.25, 0.16)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) box(group, 0.025, 2.46, 0.12, side * (2.52 + i * 0.085), 1.25, 0.12)
    box(group, 0.35, 1.3, 0.17, side * 2.94, 0.85, 0.21)
    for (const y of [0.48, 0.86, 1.2]) {
      const geometry = new CylinderGeometry(0.105, 0.08, 0.035, 24)
      geometries.push(geometry)
      const cone = new Mesh(geometry, material)
      cone.rotation.x = Math.PI / 2
      cone.position.set(side * 2.94, y, 0.315)
      group.add(cone)
    }
  }
  return group
}

function mountedScene(yaw = 0) {
  const level = LevelNode.parse({ id: 'level_wall_observation', height: 3.8 })
  const wall = WallNode.parse({
    id: 'wall_wall_observation',
    parentId: level.id,
    start: [-3, 3],
    end: [-12, 3],
    thickness: 0.22,
  })
  const item = ItemNode.parse({
    id: 'item_wall_observation',
    parentId: wall.id,
    wallId: wall.id,
    side: 'back',
    position: [4.5, 0.55, 0],
    rotation: [0, yaw, 0],
    asset: {
      id: 'screen',
      name: 'Cinema projection screen and acoustic surround',
      category: 'media wall',
      src: 'asset://screen',
      thumbnail: '',
      dimensions: [6.6, 2.5, 0.3325],
      attachTo: 'wall-side',
    },
  })
  wall.children = [item.id]
  level.children = [wall.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, wall, item].map((node) => [node.id, node]),
  )
  useScene.setState({ nodes, dirtyNodes: new Set() })
  const buildingRoot = new Group()
  buildingRoot.position.set(40, 8, -30)
  buildingRoot.rotation.y = 0.7
  const host = new Group()
  host.position.set(-3, 0, 3)
  host.rotation.y = -Math.PI
  buildingRoot.add(host)
  const root = new Group()
  root.position.set(4.5, 0.55, -0.11)
  root.rotation.y = yaw
  root.userData.itemModelSettled = true
  root.add(cinemaScreen())
  host.add(root)
  for (const [node, mesh] of [
    [wall, host],
    [item, root],
  ] as const) {
    sceneRegistry.nodes.set(node.id, mesh)
    registered.push(node.id)
  }
  return { nodes, level, wall, item, host, root }
}

function currentGraph(nodes: Record<string, AnyNode>) {
  useScene.setState({ nodes: { ...nodes }, dirtyNodes: new Set() })
  return useScene.getState().nodes
}

function peer(scene: ReturnType<typeof mountedScene>, depth: number, x = 4.5) {
  const node = ItemNode.parse({ ...scene.item, id: 'item_wall_peer' })
  scene.nodes[node.id] = node
  scene.wall.children.push(node.id)
  const root = new Group()
  root.position.set(x, 0.55, -0.11)
  root.rotation.y = Math.PI
  root.userData.itemModelSettled = true
  box(root, 1, 1, 0.04, 0, 0.5, depth)
  scene.host.add(root)
  sceneRegistry.nodes.set(node.id, root)
  registered.push(node.id)
  return root
}

describe('rendered wall object observations', () => {
  test('owner screen has a 16.5 square metre competing face on the cinema wall', () => {
    const scene = mountedScene()
    registerWallObjectSceneCheck()
    const nodes = currentGraph(scene.nodes)
    const before = JSON.stringify(nodes)
    const matrix = scene.root.matrix.clone()
    const observations = verifyScene(nodes, {}, { activeLevelId: scene.level.id }).result
      .issues as Record<string, unknown>[]
    expect(observations).toContainEqual(
      expect.objectContaining({
        type: 'item_wall_coplanar_face',
        itemId: scene.item.id,
        wallId: scene.wall.id,
        evidence: 'rendered_faces',
        overlapAreaSquareMeters: expect.closeTo(16.5, 4),
        separationMeters: expect.closeTo(0, 6),
      }),
    )
    expect(observations).toContainEqual(
      expect.objectContaining({
        type: 'item_through_wall',
        beyondOppositeFaceMeters: expect.closeTo(0.1125, 5),
      }),
    )
    expect(JSON.stringify(nodes)).toBe(before)
    expect(scene.root.matrix.equals(matrix)).toBe(true)
  })

  test('outward screen and hidden back-to-wall contact are silent', () => {
    const scene = mountedScene(Math.PI)
    expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toEqual([])
  })

  test('a tilted triangle crossing the host plane is not a wholly coplanar face', () => {
    const scene = mountedScene()
    scene.root.clear()
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, -0.01, 0, 1, 0, 1, 0, 0.01], 3),
    )
    geometries.push(geometry)
    scene.root.add(new Mesh(geometry, material))
    const observations = wallObjectRenderedObservations(currentGraph(scene.nodes))
    expect(observations.filter((issue) => issue.type === 'item_wall_coplanar_face')).toEqual([])
  })

  test.each(['picture', 'mirror'])(
    'correct catalog %s uses actual corrective model bounds',
    (name) => {
      const scene = mountedScene(Math.PI)
      scene.root.clear()
      scene.item.asset.attachTo = 'wall'
      scene.item.asset.dimensions = [0.8, 0.6, 0.04]
      scene.item.asset.offset = [0.013, 0, 0.151]
      scene.root.position.z = 0
      const correction = new Group()
      correction.position.set(...scene.item.asset.offset)
      box(correction, 0.8, 0.6, 0.04, -0.013, 0.3, -0.02)
      scene.root.add(correction)
      expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toEqual([])
    },
  )

  test('windows and geometry entirely in their cutout remain silent', () => {
    const scene = mountedScene()
    const window = WindowNode.parse({
      id: 'window_wall_observation',
      parentId: scene.wall.id,
      wallId: scene.wall.id,
      position: [4.5, 1.8, 0],
      width: 7,
      height: 2.8,
    })
    scene.nodes[window.id] = window
    scene.wall.children.push(window.id)
    expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toEqual([])
  })

  test('overlapping same-facing peer surfaces within one millimetre are measured', () => {
    const scene = mountedScene(Math.PI)
    scene.root.clear()
    box(scene.root, 1, 1, 0.04, 0, 0.5, 0.022)
    const other = peer(scene, 0.0225)
    expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toContainEqual(
      expect.objectContaining({
        type: 'item_wall_object_coplanar_face',
        itemId: scene.item.id,
        otherItemId: 'item_wall_peer',
        overlapAreaSquareMeters: expect.closeTo(1, 4),
        separationMeters: expect.closeTo(0.0005, 5),
      }),
    )
    other.position.x = 6
    expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toEqual([])
    other.position.x = 4.5
    other.position.z -= 0.005
    expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toEqual([])
  })

  test('opposed touching peer faces are not competing surfaces', () => {
    const scene = mountedScene(Math.PI)
    scene.root.clear()
    box(scene.root, 1, 1, 0.04, 0, 0.5, 0.022)
    peer(scene, 0.062)
    expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toEqual([])
  })

  test('unfinished, dirty, hidden and stale meshes do not supply face evidence', () => {
    const scene = mountedScene()
    scene.root.userData.itemModelSettled = false
    expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toEqual([])
    scene.root.userData.itemModelSettled = true
    scene.root.visible = false
    expect(wallObjectRenderedObservations(currentGraph(scene.nodes))).toEqual([])
    scene.root.visible = true
    const nodes = currentGraph(scene.nodes)
    useScene.getState().dirtyNodes.add(scene.item.id)
    expect(wallObjectRenderedObservations(nodes)).toEqual([])
    useScene.getState().dirtyNodes.clear()
    expect(wallObjectRenderedObservations(structuredClone(nodes))).toEqual([])
  })
})
