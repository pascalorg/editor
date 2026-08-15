import { describe, expect, test } from 'bun:test'
import {
  analyzeDefinitionGraph,
  collectDefinitionSubtreeNodeIds,
  wouldCreateDefinitionCycle,
} from './definition-graph'
import type { Definition, DefinitionId } from './definitions'

const definition = (id: string, rootNodeId: string): Definition => ({
  id: id as DefinitionId,
  name: id,
  rootNodeId,
})

describe('definition graph', () => {
  test('collects a physical definition subtree without following instance references', () => {
    const nodes = {
      root_a: { id: 'root_a', type: 'level', children: ['instance_b'] },
      instance_b: { id: 'instance_b', type: 'instance', definitionId: 'definition_b' },
      root_b: { id: 'root_b', type: 'level', children: ['wall_b'] },
      wall_b: { id: 'wall_b', type: 'wall' },
    }

    expect([...collectDefinitionSubtreeNodeIds(nodes, 'root_a')].sort()).toEqual([
      'instance_b',
      'root_a',
    ])
  })

  test('allows acyclic nesting and reports missing references', () => {
    const definitions = {
      definition_a: definition('definition_a', 'root_a'),
      definition_b: definition('definition_b', 'root_b'),
    } as Record<DefinitionId, Definition>
    const nodes = {
      root_a: { type: 'level', children: ['instance_b', 'instance_missing'] },
      instance_b: { type: 'instance', definitionId: 'definition_b' },
      instance_missing: { type: 'instance', definitionId: 'definition_missing' },
      root_b: { type: 'level', children: [] },
    }

    const analysis = analyzeDefinitionGraph(definitions, nodes)
    expect(analysis.cycles).toEqual([])
    expect([...analysis.dependencies.get('definition_a' as DefinitionId)!].sort()).toEqual([
      'definition_b',
      'definition_missing',
    ])
    expect(analysis.missingReferences).toEqual([
      {
        definitionId: 'definition_a',
        nodeId: 'instance_missing',
        referencedDefinitionId: 'definition_missing',
      },
    ])
  })

  test('detects direct and indirect cycles before a nested instance is placed', () => {
    const definitions = {
      definition_a: definition('definition_a', 'root_a'),
      definition_b: definition('definition_b', 'root_b'),
      definition_c: definition('definition_c', 'root_c'),
    } as Record<DefinitionId, Definition>
    const nodes = {
      root_a: { type: 'level', children: ['instance_b'] },
      instance_b: { type: 'instance', definitionId: 'definition_b' },
      root_b: { type: 'level', children: ['instance_c'] },
      instance_c: { type: 'instance', definitionId: 'definition_c' },
      root_c: { type: 'level', children: ['instance_a'] },
      instance_a: { type: 'instance', definitionId: 'definition_a' },
    }

    expect(analyzeDefinitionGraph(definitions, nodes).cycles).toEqual([
      ['definition_a', 'definition_b', 'definition_c', 'definition_a'],
    ])
    expect(
      wouldCreateDefinitionCycle(
        definitions,
        { ...nodes, root_c: { type: 'level', children: [] } },
        'definition_c' as DefinitionId,
        'definition_a' as DefinitionId,
      ),
    ).toBe(true)
    expect(
      wouldCreateDefinitionCycle(
        definitions,
        { ...nodes, root_c: { type: 'level', children: [] } },
        'definition_a' as DefinitionId,
        'definition_c' as DefinitionId,
      ),
    ).toBe(false)
  })
})
