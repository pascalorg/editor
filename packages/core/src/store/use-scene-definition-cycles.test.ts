import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, Definition, InstanceNode, LevelNode } from '../schema'
import useScene, { clearSceneHistory } from './use-scene'

const root = (id: string, children: string[] = []) =>
  LevelNode.parse({ id, parentId: null, children, height: 2.5 })

const nestedInstance = (id: string, parentId: string, definitionId: string) =>
  InstanceNode.parse({ id, parentId, definitionId })

beforeEach(() => {
  useScene.getState().unloadScene()
  clearSceneHistory()
})

describe('component definition cycle guards', () => {
  test('drops cyclic definitions when a scene is loaded', () => {
    const rootA = root('level_a', ['instance_b'])
    const rootB = root('level_b', ['instance_a'])
    const instanceB = nestedInstance('instance_b', rootA.id, 'definition_b')
    const instanceA = nestedInstance('instance_a', rootB.id, 'definition_a')
    const nodes = {
      [rootA.id]: rootA,
      [rootB.id]: rootB,
      [instanceA.id]: instanceA,
      [instanceB.id]: instanceB,
    } as Record<AnyNodeId, AnyNode>

    useScene.getState().setScene(nodes, [], {
      definitions: {
        definition_a: Definition.parse({
          id: 'definition_a',
          name: 'A',
          rootNodeId: rootA.id,
        }),
        definition_b: Definition.parse({
          id: 'definition_b',
          name: 'B',
          rootNodeId: rootB.id,
        }),
      },
    })

    expect(useScene.getState().definitions).toEqual({})
  })

  test('rejects an update that would close an indirect cycle', () => {
    const rootA = root('level_a', ['instance_b'])
    const rootB = root('level_b')
    const cyclicRootB = root('level_b_cycle', ['instance_a'])
    const instanceB = nestedInstance('instance_b', rootA.id, 'definition_b')
    const instanceA = nestedInstance('instance_a', cyclicRootB.id, 'definition_a')
    useScene.setState({
      nodes: {
        [rootA.id]: rootA,
        [rootB.id]: rootB,
        [cyclicRootB.id]: cyclicRootB,
        [instanceA.id]: instanceA,
        [instanceB.id]: instanceB,
      } as Record<AnyNodeId, AnyNode>,
    })
    useScene
      .getState()
      .addDefinition(Definition.parse({ id: 'definition_b', name: 'B', rootNodeId: rootB.id }))
    useScene
      .getState()
      .addDefinition(Definition.parse({ id: 'definition_a', name: 'A', rootNodeId: rootA.id }))

    expect(() =>
      useScene.getState().updateDefinition('definition_b', { rootNodeId: cyclicRootB.id }),
    ).toThrow('Component definition cycle')
    expect(useScene.getState().definitions.definition_b?.rootNodeId).toBe(rootB.id)
  })
})
