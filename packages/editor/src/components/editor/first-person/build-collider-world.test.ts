import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  ColumnNode,
  ElevatorNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  ShelfNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { buildFirstPersonColliderWorldFromRegistry } from './build-collider-world'

function registerColliderDefinition(
  kind: AnyNode['type'],
  schema: AnyNodeDefinition['schema'],
  category: AnyNodeDefinition['category'],
) {
  registerNode({
    kind,
    schema,
    schemaVersion: 1,
    category,
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
})
