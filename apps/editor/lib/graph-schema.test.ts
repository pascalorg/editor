import { expect, test } from 'bun:test'
import { apiGraphSchema } from './graph-schema'

function buildGraph(nodes: Record<string, unknown>, rootNodeIds: string[] = []) {
  return { nodes, rootNodeIds }
}

const level = (children: string[] = []) => ({
  object: 'node',
  id: 'level_a1b2c3d4e5f6g7h8',
  type: 'level',
  parentId: null,
  children,
  level: 0,
})

const pluginTree = (overrides: Record<string, unknown> = {}) => ({
  object: 'node',
  id: 'tree_a1b2c3d4e5f6g7h8',
  type: 'trees:tree',
  parentId: 'level_a1b2c3d4e5f6g7h8',
  position: [1, 0, 2],
  rotation: 0,
  ...overrides,
})

test('accepts a graph containing a plugin node kind', () => {
  const graph = buildGraph({ [pluginTree().id]: pluginTree() }, ['level_a1b2c3d4e5f6g7h8'])

  expect(apiGraphSchema.safeParse(graph).success).toBe(true)
})

test('accepts a builtin level whose children include a plugin node id', () => {
  const tree = pluginTree()
  const graph = buildGraph(
    {
      [level().id]: level([tree.id]),
      [tree.id]: tree,
    },
    [level().id],
  )

  expect(apiGraphSchema.safeParse(graph).success).toBe(true)
})

test('keeps plugin child ids in the parsed graph', () => {
  const tree = pluginTree()
  const graph = buildGraph(
    {
      [level().id]: level([tree.id]),
      [tree.id]: tree,
    },
    [level().id],
  )

  const res = apiGraphSchema.safeParse(graph)

  expect(res.success).toBe(true)
  const parsedLevel = res.data?.nodes[level().id] as { children: string[] }
  expect(parsedLevel.children).toEqual([tree.id])
})

test('rejects a plugin node that fails the base envelope', () => {
  const graph = buildGraph({
    tree_bad: pluginTree({ id: 42 }),
  })

  expect(apiGraphSchema.safeParse(graph).success).toBe(false)
})

test('rejects dangerous URL schemes nested in plugin node fields', () => {
  for (const url of [
    'javascript:alert(1)',
    ' file:///etc/passwd',
    'data:text/html,<script>1</script>',
  ]) {
    const graph = buildGraph({
      [pluginTree().id]: pluginTree({ config: { textures: [{ src: url }] } }),
    })

    const res = apiGraphSchema.safeParse(graph)

    expect(res.success).toBe(false)
    expect(res.error?.issues[0]?.message).toBe('URL scheme not allowed in plugin node fields')
  }
})

test('allows data:image URLs in plugin node fields', () => {
  const graph = buildGraph({
    [pluginTree().id]: pluginTree({ thumbnail: 'data:image/png;base64,iVBORw0KGgo=' }),
  })

  expect(apiGraphSchema.safeParse(graph).success).toBe(true)
})

test('still rejects invalid builtin nodes', () => {
  const graph = buildGraph({
    wall_bad: { object: 'node', id: 'wall_a1b2c3d4e5f6g7h8', type: 'wall' },
  })

  expect(apiGraphSchema.safeParse(graph).success).toBe(false)
})

test('does not treat non-namespaced unknown types as plugin kinds', () => {
  const graph = buildGraph({
    mystery_1: { object: 'node', id: 'mystery_1', type: 'mystery' },
  })

  expect(apiGraphSchema.safeParse(graph).success).toBe(false)
})
