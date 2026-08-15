import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type Definition,
  type DefinitionId,
  InstanceNode,
  LevelNode,
} from '../schema'
import { cloneSceneGraph, forkSceneGraph, type SceneGraph } from './clone-scene-graph'

function nestedDefinitionScene(): SceneGraph {
  const sceneLevel = LevelNode.parse({ id: 'level_scene', children: ['instance_a'], height: 2.5 })
  const rootA = LevelNode.parse({ id: 'level_definition-a', children: ['instance_b'], height: 2.5 })
  const rootB = LevelNode.parse({ id: 'level_definition-b', children: [], height: 2.5 })
  const instanceA = InstanceNode.parse({
    id: 'instance_a',
    parentId: sceneLevel.id,
    definitionId: 'definition_a',
  })
  const instanceB = InstanceNode.parse({
    id: 'instance_b',
    parentId: rootA.id,
    definitionId: 'definition_b',
  })

  return {
    nodes: {
      [sceneLevel.id]: sceneLevel,
      [rootA.id]: rootA,
      [rootB.id]: rootB,
      [instanceA.id]: instanceA,
      [instanceB.id]: instanceB,
    } as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [sceneLevel.id],
    definitions: {
      definition_a: {
        id: 'definition_a',
        name: 'A',
        rootNodeId: rootA.id,
      },
      definition_b: {
        id: 'definition_b',
        name: 'B',
        rootNodeId: rootB.id,
      },
    } as Record<DefinitionId, Definition>,
  }
}

function expectNestedReferencesRemapped(graph: SceneGraph) {
  const definitions = Object.values(graph.definitions ?? {})
  const definitionA = definitions.find((definition) => definition.name === 'A')
  const definitionB = definitions.find((definition) => definition.name === 'B')
  expect(definitionA).toBeDefined()
  expect(definitionB).toBeDefined()

  const rootA = graph.nodes[definitionA!.rootNodeId]
  expect(rootA?.type).toBe('level')
  if (rootA?.type !== 'level') return
  const nested = graph.nodes[rootA.children[0] as AnyNodeId]
  expect(nested?.type).toBe('instance')
  if (nested?.type !== 'instance') return
  expect(nested.definitionId).toBe(definitionB!.id)

  const sceneRoot = graph.nodes[graph.rootNodeIds[0]!]
  expect(sceneRoot?.type).toBe('level')
  if (sceneRoot?.type !== 'level') return
  const sceneInstance = graph.nodes[sceneRoot.children[0] as AnyNodeId]
  expect(sceneInstance?.type).toBe('instance')
  if (sceneInstance?.type === 'instance') expect(sceneInstance.definitionId).toBe(definitionA!.id)
}

describe('nested component persistence boundaries', () => {
  test('clone remaps definition roots and nested definition references together', () => {
    expectNestedReferencesRemapped(cloneSceneGraph(nestedDefinitionScene()))
  })

  test('fork preserves the same nested definition graph', () => {
    expectNestedReferencesRemapped(forkSceneGraph(nestedDefinitionScene()))
  })
})
