import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../registry'
import type { AnyNodeDefinition } from '../registry/types'
import { LevelNode, WallNode } from '../schema'
import { validateBuildJson } from './validate-build-json'

function makeScene() {
  const wall = WallNode.parse({
    id: 'wall_test1',
    parentId: 'level_test',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1,
  })
  const level = LevelNode.parse({
    id: 'level_test',
    level: 0,
    children: [wall.id],
  })
  return {
    nodes: { [level.id]: level, [wall.id]: wall } as Record<string, unknown>,
    rootNodeIds: [level.id],
  }
}

describe('validateBuildJson', () => {
  test('accepts a minimal valid scene', () => {
    const result = validateBuildJson(makeScene())
    expect(result.ok).toBe(true)
    expect(result.schemaIssueCount).toBe(0)
  })

  test('plugin-typed children do not hard-fail their parent level', () => {
    // Exports from projects with plugins carry nodes like `trees:tree`
    // whose ids sit in level.children. The static children id union would
    // reject them, but the scene store loads them fine (same data
    // round-trips through the DB) — they must only surface as the
    // unknown-types warning, never as an import-blocking schema error.
    const scene = makeScene()
    const level = scene.nodes.level_test as { children: string[] }
    scene.nodes.tree_plugin1 = {
      id: 'tree_plugin1',
      type: 'trees:tree',
      object: 'node',
      parentId: 'level_test',
      visible: true,
      metadata: {},
      children: [],
      position: [1, 0, 1],
    }
    level.children = [...level.children, 'tree_plugin1']

    const result = validateBuildJson(scene)
    expect(result.ok).toBe(true)
    expect(result.schemaIssueCount).toBe(0)
    expect(result.warnings.some((w) => w.code === 'unknown_types')).toBe(true)
    // The parsed payload keeps the plugin child — only validation filters it.
    const parsedLevel = result.parsed?.nodes.level_test as { children: string[] }
    expect(parsedLevel.children).toContain('tree_plugin1')
  })

  test('a genuinely malformed known-type node still blocks import', () => {
    const scene = makeScene()
    ;(scene.nodes.wall_test1 as { start: unknown }).start = 'not-a-point'

    const result = validateBuildJson(scene)
    expect(result.ok).toBe(false)
    expect(result.schemaIssueCount).toBe(1)
    expect(result.schemaIssues[0]?.nodeId).toBe('wall_test1')
  })
})

describe('validateBuildJson with registered plugin kinds', () => {
  const sceneWithTree = (position: unknown) => {
    const scene = makeScene()
    const level = scene.nodes.level_test as { children: string[] }
    scene.nodes.tree_plugin1 = {
      id: 'tree_plugin1',
      type: 'trees:tree',
      object: 'node',
      parentId: 'level_test',
      visible: true,
      metadata: {},
      children: [],
      position,
    }
    level.children = [...level.children, 'tree_plugin1']
    return scene
  }

  beforeEach(() => {
    nodeRegistry._reset()
    registerNode({
      kind: 'trees:tree',
      schemaVersion: 1,
      schema: z.looseObject({
        id: z.string(),
        type: z.literal('trees:tree'),
        position: z.tuple([z.number(), z.number(), z.number()]),
      }),
      category: 'utility',
      defaults: () => ({}),
      capabilities: {},
    } as unknown as AnyNodeDefinition)
  })

  afterEach(() => {
    nodeRegistry._reset()
  })

  test('a registered plugin kind is first-class: no unknown-types warning', () => {
    const result = validateBuildJson(sceneWithTree([1, 0, 1]))
    expect(result.ok).toBe(true)
    expect(result.schemaIssueCount).toBe(0)
    expect(result.warnings.some((w) => w.code === 'unknown_types')).toBe(false)
    expect(result.stats.pluginTypes['trees:tree']).toBe(1)
    expect(result.stats.unknownTypes).toEqual({})
  })

  test('a corrupt registered plugin node is caught by its own schema', () => {
    const result = validateBuildJson(sceneWithTree('not-a-position'))
    expect(result.ok).toBe(false)
    expect(result.schemaIssueCount).toBe(1)
    expect(result.schemaIssues[0]?.nodeId).toBe('tree_plugin1')
    expect(result.schemaIssues[0]?.nodeType).toBe('trees:tree')
  })
})
