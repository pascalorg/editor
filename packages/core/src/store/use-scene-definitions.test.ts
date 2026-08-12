import { beforeEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  Definition,
  DoorNode,
  InstanceNode,
  LevelNode,
  ShelfNode,
  SiteNode,
  WallNode,
} from '../schema'
import useScene, { clearSceneHistory } from './use-scene'

function componentScene() {
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  const instance = InstanceNode.parse({
    definitionId: 'definition_balcony',
    parentId: 'level_component',
    position: [4, 0, 2],
  })
  const level = LevelNode.parse({
    id: 'level_component',
    parentId: building.id,
    level: 0,
    children: [instance.id],
  })
  const definitionRoot = ShelfNode.parse({
    id: 'shelf_definition_root',
    name: 'Balcony source',
    parentId: null,
    children: [],
  })
  const definition = Definition.parse({
    id: 'definition_balcony',
    name: 'Balcony A',
    rootNodeId: definitionRoot.id,
  })

  return {
    definition,
    definitionRoot,
    instance,
    level,
    nodes: {
      [site.id]: { ...site, children: [building.id] },
      [building.id]: { ...building, children: [level.id] },
      [level.id]: level,
      [definitionRoot.id]: definitionRoot,
      [instance.id]: instance,
    },
    rootNodeIds: [site.id],
  }
}

describe('useScene component definitions', () => {
  beforeEach(() => {
    useScene.getState().unloadScene()
    clearSceneHistory()
  })

  test('keeps a detached definition subtree during load', () => {
    const scene = componentScene()
    useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
      definitions: { [scene.definition.id]: scene.definition },
    })

    expect(useScene.getState().nodes[scene.definitionRoot.id]).toEqual(scene.definitionRoot)
    expect(useScene.getState().rootNodeIds).not.toContain(scene.definitionRoot.id)
    expect(useScene.getState().definitions[scene.definition.id]).toEqual(scene.definition)
  })

  test('deleting a definition removes its source subtree and placed instances in one undo step', () => {
    const scene = componentScene()
    useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
      definitions: { [scene.definition.id]: scene.definition },
    })
    clearSceneHistory()

    useScene.getState().deleteDefinition(scene.definition.id)

    expect(useScene.getState().definitions[scene.definition.id]).toBeUndefined()
    expect(useScene.getState().nodes[scene.definitionRoot.id]).toBeUndefined()
    expect(useScene.getState().nodes[scene.instance.id]).toBeUndefined()
    expect(useScene.getState().nodes[scene.level.id]?.children).not.toContain(scene.instance.id)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()

    expect(useScene.getState().definitions[scene.definition.id]).toEqual(scene.definition)
    expect(useScene.getState().nodes[scene.definitionRoot.id]).toBeDefined()
    expect(useScene.getState().nodes[scene.instance.id]).toBeDefined()
  })

  test('turns a placed node into a detached definition and one instance in one undo step', () => {
    const scene = componentScene()
    const placedShelf = ShelfNode.parse({
      id: 'shelf_placed',
      name: 'Bookcase',
      parentId: scene.level.id,
      position: [3, 0.5, 4],
      rotation: [0, Math.PI / 4, 0],
    })
    scene.nodes[scene.level.id] = {
      ...scene.level,
      children: [...scene.level.children, placedShelf.id],
    }
    scene.nodes[placedShelf.id] = placedShelf
    useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
      definitions: { [scene.definition.id]: scene.definition },
    })
    const collectionId = useScene.getState().createCollection('Furniture', [placedShelf.id])
    clearSceneHistory()

    const result = useScene.getState().makeComponent(placedShelf.id)

    expect(result).not.toBeNull()
    const instance = useScene.getState().nodes[result!.instanceId]
    expect(instance?.type).toBe('instance')
    expect(instance).toMatchObject({
      position: [3, 0.5, 4],
      rotation: [0, Math.PI / 4, 0],
      scale: [1, 1, 1],
    })
    expect(useScene.getState().definitions[result!.definitionId]).toMatchObject({
      name: 'Bookcase',
      rootNodeId: placedShelf.id,
    })
    expect(useScene.getState().nodes[placedShelf.id]?.parentId).toBeNull()
    expect(useScene.getState().nodes[placedShelf.id]).toMatchObject({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
    expect(useScene.getState().nodes[placedShelf.id]?.collectionIds).toBeUndefined()
    expect(useScene.getState().nodes[scene.level.id]?.children).toContain(result!.instanceId)
    expect(useScene.getState().nodes[scene.level.id]?.children).not.toContain(placedShelf.id)
    expect(useScene.getState().collections[collectionId]?.nodeIds).toContain(result!.instanceId)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().definitions[result!.definitionId]).toBeUndefined()
    expect(useScene.getState().nodes[result!.instanceId]).toBeUndefined()
    expect(useScene.getState().nodes[placedShelf.id]?.parentId).toBe(scene.level.id)
  })

  test('rejects coordinate-authored roots that cannot be represented by an instance transform', () => {
    const scene = componentScene()
    const wall = WallNode.parse({
      id: 'wall_absolute_component',
      parentId: scene.level.id,
      start: [4, 3],
      end: [7, 3],
    })
    scene.nodes[scene.level.id] = { ...scene.level, children: [...scene.level.children, wall.id] }
    scene.nodes[wall.id] = wall
    useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
      definitions: { [scene.definition.id]: scene.definition },
    })

    expect(useScene.getState().makeComponent(wall.id)).toBeNull()
    expect(useScene.getState().nodes[wall.id]).toEqual(wall)
  })

  test('makes an instance unique by cloning its definition subtree and internal host refs', () => {
    const scene = componentScene()
    const wall = WallNode.parse({
      id: 'wall_definition_root',
      parentId: null,
      children: ['door_definition_child'],
      start: [0, 0],
      end: [3, 0],
    })
    const door = DoorNode.parse({
      id: 'door_definition_child',
      parentId: wall.id,
      wallId: wall.id,
    })
    const definition = Definition.parse({
      id: 'definition_entry',
      name: 'Entry',
      rootNodeId: wall.id,
    })
    const instance = InstanceNode.parse({
      id: 'instance_entry',
      definitionId: definition.id,
      parentId: scene.level.id,
    })
    scene.nodes[scene.level.id] = {
      ...scene.level,
      children: [...scene.level.children, instance.id],
    }
    scene.nodes[wall.id] = wall
    scene.nodes[door.id] = door
    scene.nodes[instance.id] = instance
    useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
      definitions: {
        [scene.definition.id]: scene.definition,
        [definition.id]: definition,
      },
    })
    clearSceneHistory()

    const uniqueDefinitionId = useScene.getState().makeInstanceUnique(instance.id)

    expect(uniqueDefinitionId).not.toBeNull()
    const uniqueDefinition = useScene.getState().definitions[uniqueDefinitionId!]
    expect(uniqueDefinition?.name).toBe('Entry copy')
    expect(uniqueDefinition?.rootNodeId).not.toBe(wall.id)
    expect(useScene.getState().rootNodeIds).not.toContain(uniqueDefinition?.rootNodeId)
    const clonedWall = useScene.getState().nodes[uniqueDefinition!.rootNodeId]
    expect(clonedWall?.type).toBe('wall')
    const clonedDoorId = clonedWall?.type === 'wall' ? clonedWall.children[0] : undefined
    const clonedDoor = clonedDoorId ? useScene.getState().nodes[clonedDoorId] : undefined
    expect(clonedDoor?.type).toBe('door')
    if (clonedDoor?.type === 'door') expect(clonedDoor.wallId).toBe(clonedWall?.id)
    expect((useScene.getState().nodes[instance.id] as InstanceNode).definitionId).toBe(
      uniqueDefinitionId,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().definitions[uniqueDefinitionId!]).toBeUndefined()
    expect((useScene.getState().nodes[instance.id] as InstanceNode).definitionId).toBe(
      definition.id,
    )
  })
})
