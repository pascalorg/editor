import { describe, expect, test } from 'bun:test'
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
