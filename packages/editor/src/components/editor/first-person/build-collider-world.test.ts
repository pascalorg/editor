import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  CeilingNode,
  ColumnNode,
  ElevatorNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  ShelfNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { buildFirstPersonColliderWorldFromRegistry } from './build-collider-world'

function registerColliderDefinition(
  kind: AnyNode['type'],
  schema: AnyNodeDefinition['schema'],
  category: AnyNodeDefinition['category'],
  surfaceRole?: AnyNodeDefinition['surfaceRole'],
) {
  registerNode({
    kind,
    schema,
    schemaVersion: 1,
    category,
    surfaceRole,
    capabilities: {},
  } as AnyNodeDefinition)
}

function mountNode(
  node: AnyNode,
  box: [number, number, number],
  position: [number, number, number],
) {
  const group = new Group()
  const mesh = new Mesh(new BoxGeometry(box[0], box[1], box[2]), new MeshBasicMaterial())
  mesh.position.set(position[0], position[1], position[2])
  group.add(mesh)
  group.updateMatrixWorld(true)
  sceneRegistry.nodes.set(node.id, group)
  sceneRegistry.byType[node.type]!.add(node.id)
}

function mountRegistryGroup(node: AnyNode) {
  const group = new Group()
  group.updateMatrixWorld(true)
  sceneRegistry.nodes.set(node.id, group)
  sceneRegistry.byType[node.type]!.add(node.id)
}

function setSceneNodes(nodes: AnyNode[]) {
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: nodes.map((node) => node.id),
  } as never)
}

describe('buildFirstPersonColliderWorldFromRegistry', () => {
  afterEach(() => {
    sceneRegistry.clear()
    nodeRegistry._reset()
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  })

  test('includes structure and furnish nodes discovered through the node registry', () => {
    registerColliderDefinition('column', ColumnNode, 'structure')
    registerColliderDefinition('shelf', ShelfNode, 'furnish')

    const column = ColumnNode.parse({ id: 'column_test' })
    const shelf = ShelfNode.parse({ id: 'shelf_test', position: [3, 0, 0] })
    setSceneNodes([column, shelf])
    mountNode(column, [1, 2, 1], [0, 1, 0])
    mountNode(shelf, [2, 1, 1], [3, 0.5, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    expect(world?.bounds?.min.x).toBeCloseTo(-0.5)
    expect(world?.bounds?.max.x).toBeCloseTo(4)
    world?.dispose()
  })

  test('excludes ceiling surfaces so the walkthrough player passes through them', () => {
    registerColliderDefinition('column', ColumnNode, 'structure')
    registerColliderDefinition('ceiling', CeilingNode, 'structure', 'ceiling')

    const column = ColumnNode.parse({ id: 'column_test' })
    const ceiling = CeilingNode.parse({ id: 'ceiling_test', polygon: [] })
    setSceneNodes([column, ceiling])
    mountNode(column, [1, 2, 1], [0, 1, 0])
    // A wide ceiling at head height — if it were collected, bounds would span ±5.
    mountNode(ceiling, [10, 0.1, 10], [0, 2.5, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    // Bounds reflect only the 1×1 column; the ceiling contributed no geometry.
    expect(world?.bounds?.min.x).toBeCloseTo(-0.5)
    expect(world?.bounds?.max.x).toBeCloseTo(0.5)
    world?.dispose()
  })

  test('skips meshes hidden by an invisible ancestor (stale roof segment CSG)', () => {
    registerColliderDefinition('column', ColumnNode, 'structure')

    // Mirror the roof's segments-wrapper shape: the registered mesh's own
    // visible flag stays true while a hidden wrapper hides it at render
    // time. The collider must match the render, not the own-flag.
    const column = ColumnNode.parse({ id: 'column_test' })
    const visibleColumn = ColumnNode.parse({ id: 'column_visible', position: [3, 0, 0] })
    setSceneNodes([column, visibleColumn])

    const wrapper = new Group()
    wrapper.visible = false
    const hiddenMesh = new Mesh(new BoxGeometry(10, 2, 10), new MeshBasicMaterial())
    wrapper.add(hiddenMesh)
    wrapper.updateMatrixWorld(true)
    sceneRegistry.nodes.set(column.id, hiddenMesh)
    sceneRegistry.byType[column.type]!.add(column.id)

    mountNode(visibleColumn, [1, 2, 1], [3, 1, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    // Bounds reflect only the visible 1×1 column at x = 3; the 10×10 mesh
    // under the hidden wrapper contributed no geometry.
    expect(world?.bounds?.min.x).toBeCloseTo(2.5)
    expect(world?.bounds?.max.x).toBeCloseTo(3.5)
    world?.dispose()
  })

  test('leaves elevators to their dedicated dynamic collider meshes', () => {
    registerColliderDefinition('elevator', ElevatorNode, 'structure')

    const elevator = ElevatorNode.parse({ id: 'elevator_test' })
    setSceneNodes([elevator])
    mountNode(elevator, [2, 3, 2], [0, 1.5, 0])

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).toBeNull()
  })

  test('adds a fallback floor for a visible level with no slab', () => {
    const level = LevelNode.parse({ id: 'level_test', level: 0 })
    setSceneNodes([level])
    mountRegistryGroup(level)

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    expect(world?.bounds?.min.y).toBeCloseTo(-0.08)
    expect(world?.bounds?.max.y).toBeCloseTo(0)
    world?.dispose()
  })

  test('adds a site ground collider so a spawn on bare ground has a floor', () => {
    const site = SiteNode.parse({ id: 'site_test' })
    setSceneNodes([site])
    mountRegistryGroup(site)

    const world = buildFirstPersonColliderWorldFromRegistry()

    expect(world).not.toBeNull()
    // Ground slab sits just below the site ground plane (y = 0).
    expect(world?.bounds?.min.y).toBeCloseTo(-0.08)
    expect(world?.bounds?.max.y).toBeCloseTo(0)
    // The ground collider extends far past the site polygon so stepping out of
    // the site boundary never drops the player below the ground plane.
    expect(world?.bounds?.min.x).toBeCloseTo(-1000)
    expect(world?.bounds?.max.x).toBeCloseTo(1000)
    expect(world?.bounds?.min.z).toBeCloseTo(-1000)
    expect(world?.bounds?.max.z).toBeCloseTo(1000)
    world?.dispose()
  })
})
