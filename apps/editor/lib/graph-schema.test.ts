import { expect, test } from 'bun:test'
import { CabinetModuleNode, CabinetNode } from '@pascal-app/core/schema'
import { apiGraphSchema } from './graph-schema'

function buildGraph(nodes: Record<string, unknown>, rootNodeIds: string[] = []) {
  return { nodes, rootNodeIds }
}

const LEVEL_ID = 'level_a1b2c3d4e5f6g7h8'
const TREE_ID = 'tree_a1b2c3d4e5f6g7h8'

const level = (children: string[] = []) => ({
  object: 'node',
  id: LEVEL_ID,
  type: 'level',
  parentId: null,
  children,
  level: 0,
})

const pluginTree = (overrides: Record<string, unknown> = {}) => ({
  object: 'node',
  id: TREE_ID,
  type: 'trees:tree',
  parentId: LEVEL_ID,
  position: [1, 0, 2],
  rotation: 0,
  ...overrides,
})

test('accepts a graph containing a plugin node kind', () => {
  const graph = buildGraph({ [TREE_ID]: pluginTree() }, [LEVEL_ID])

  expect(apiGraphSchema.safeParse(graph).success).toBe(true)
})

test('accepts a builtin container whose children include a plugin node id', () => {
  const graph = buildGraph({ [LEVEL_ID]: level([TREE_ID]), [TREE_ID]: pluginTree() }, [LEVEL_ID])

  expect(apiGraphSchema.safeParse(graph).success).toBe(true)
})

test('accepts a cabinet run containing a derived L-corner run', () => {
  const source = CabinetNode.parse({
    id: 'cabinet_graph-source',
    children: ['cabinet_graph-derived'],
  })
  const derived = CabinetNode.parse({
    id: 'cabinet_graph-derived',
    parentId: source.id,
    children: ['cabinet-module_graph-derived'],
  })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_graph-derived',
    parentId: derived.id,
  })

  expect(
    apiGraphSchema.safeParse(
      buildGraph({ [source.id]: source, [derived.id]: derived, [module.id]: module }, [source.id]),
    ).success,
  ).toBe(true)
})

test('keeps plugin child ids in the parsed graph', () => {
  const graph = buildGraph({ [LEVEL_ID]: level([TREE_ID]), [TREE_ID]: pluginTree() }, [LEVEL_ID])

  const res = apiGraphSchema.safeParse(graph)

  expect(res.success).toBe(true)
  expect((res.data?.nodes[LEVEL_ID] as { children: string[] }).children).toEqual([TREE_ID])
})

test('preserves installedPlugins alongside a plugin node', () => {
  const res = apiGraphSchema.safeParse({
    ...buildGraph({ [TREE_ID]: pluginTree() }, [LEVEL_ID]),
    installedPlugins: ['pascal:trees'],
  })

  expect(res.success).toBe(true)
  expect(res.data?.installedPlugins).toEqual(['pascal:trees'])
})

test('rejects a plugin node that fails the base envelope', () => {
  const graph = buildGraph({ tree_bad: pluginTree({ id: 42 }) })

  expect(apiGraphSchema.safeParse(graph).success).toBe(false)
})

// The `AssetUrl` allowlist is the whole Phase 3 posture: every scheme outside
// it is rejected, so this list does not have to be exhaustive to be sound. A
// denylist would — which is why one isn't used. `169.254.169.254` is the cloud
// instance-metadata endpoint, the canonical SSRF target.
test('rejects URL-shaped plugin fields outside the AssetUrl allowlist', () => {
  for (const url of [
    'javascript:alert(1)',
    ' file:///etc/passwd',
    'data:text/html,<script>1</script>',
    'http://169.254.169.254/latest/meta-data',
    'http://evil.example/beacon.png',
    'ws://evil.example/socket',
    'gopher://evil.example/x',
    'about:blank',
    // C0 controls inside the scheme: a browser ignores them and navigates, so
    // a prefix match on the raw string is not enough.
    'java\tscript:alert(1)',
    '\u0000javascript:alert(1)',
    // Scheme matching must be case-insensitive.
    'DATA:TEXT/HTML,<script>1</script>',
  ]) {
    const graph = buildGraph({ [TREE_ID]: pluginTree({ config: { textures: [{ src: url }] } }) })

    const res = apiGraphSchema.safeParse(graph)

    expect(res.success, `expected ${JSON.stringify(url)} to be rejected`).toBe(false)
    expect(res.error?.issues[0]?.message).toBe('URL is not in the allowed scheme list')
  }
})

test('accepts the asset URL forms core allows', () => {
  for (const url of [
    'data:image/png;base64,iVBORw0KGgo=',
    'https://cdn.example/tree.webp',
    'asset://tree-bark',
    'blob:https://editor.pascal.app/9f1c',
    '/textures/bark.webp',
    'http://localhost:3000/textures/bark.webp',
  ]) {
    const graph = buildGraph({ [TREE_ID]: pluginTree({ thumbnail: url }) })

    expect(apiGraphSchema.safeParse(graph).success, `expected ${url} to be accepted`).toBe(true)
  }
})

// Prose that happens to start with a word and a colon is not a URL. A plugin
// may put arbitrary text in `name` / `metadata`, exactly as builtin nodes do —
// the allowlist applies to URL-shaped values, not to every string.
test('does not treat prose or drive paths as URLs', () => {
  for (const text of [
    'FTP: north bed',
    'note: see plan 3',
    'Data: unavailable',
    'C:\\Users\\me\\plan.png',
    'Oak tree',
  ]) {
    const graph = buildGraph({ [TREE_ID]: pluginTree({ name: text, metadata: { note: text } }) })

    expect(apiGraphSchema.safeParse(graph).success, `expected ${text} to be accepted`).toBe(true)
  }
})

// A recursive walk over untrusted JSON must not throw past `safeParse` — the
// route would answer 500 where the contract is a 400 with issues.
test('reports deeply nested plugin nodes as a validation issue, not a crash', () => {
  let nested: unknown = 'leaf'
  for (let i = 0; i < 100_000; i++) nested = [nested]
  const graph = buildGraph({ [TREE_ID]: pluginTree({ nested }) })

  const res = apiGraphSchema.safeParse(graph)

  expect(res.success).toBe(false)
  expect(res.error?.issues[0]?.message).toBe('Node is too deeply nested to validate')
})

test('still rejects invalid builtin nodes', () => {
  const graph = buildGraph({
    wall_bad: { object: 'node', id: 'wall_a1b2c3d4e5f6g7h8', type: 'wall' },
  })

  expect(apiGraphSchema.safeParse(graph).success).toBe(false)
})

// Unnamespaced kinds are legitimate: `wiki/architecture/plugin-authoring.md`
// requires plugin *ids* to look like `vendor:pack`, never kinds, and its worked
// example registers `kind: 'couch'`. Membership is decided by "not in AnyNode",
// so such a node is validated as foreign rather than rejected outright.
test('treats an unnamespaced unknown type as a foreign node', () => {
  const couch = {
    object: 'node',
    id: 'couch_a1b2c3d4e5f6g7h8',
    type: 'couch',
    parentId: LEVEL_ID,
  }

  expect(apiGraphSchema.safeParse(buildGraph({ [couch.id]: couch })).success).toBe(true)
  expect(
    apiGraphSchema.safeParse(buildGraph({ [couch.id]: { ...couch, src: 'javascript:alert(1)' } }))
      .success,
  ).toBe(false)
})

const MATERIAL_ID = 'mat_a1b2c3d4e5f6g7h8'
const material = (overrides: Record<string, unknown> = {}) => ({
  id: MATERIAL_ID,
  name: 'Oak',
  material: { preset: 'wood', ...overrides },
})

test('keeps materials in the parsed output', () => {
  const graph = { ...buildGraph({}), materials: { [MATERIAL_ID]: material() } }
  const res = apiGraphSchema.safeParse(graph)

  expect(res.success).toBe(true)
  expect(res.data?.materials).toEqual(graph.materials)
})

// A material's texture is a URL the editor loads, so it is held to the same
// `AssetUrl` allowlist as every other URL-shaped field in the graph.
test('rejects a material texture URL outside the allowlist', () => {
  for (const url of ['ftp://host/a.png', 'javascript:alert(1)']) {
    const graph = {
      ...buildGraph({}),
      materials: { [MATERIAL_ID]: material({ texture: { url } }) },
    }
    expect(apiGraphSchema.safeParse(graph).success).toBe(false)
  }
})

test('accepts a material texture URL inside the allowlist', () => {
  const graph = {
    ...buildGraph({}),
    materials: {
      [MATERIAL_ID]: material({ texture: { url: 'https://cdn.example.com/oak.png' } }),
    },
  }

  expect(apiGraphSchema.safeParse(graph).success).toBe(true)
})

// The routes persist this schema's output, so validation must not double as
// normalization: a save has to store the palette it was handed.
test('does not rewrite materials it accepts', () => {
  const sparse = { id: MATERIAL_ID, name: 'Oak', material: { properties: { color: '#886644' } } }
  const graph = { ...buildGraph({}), materials: { [MATERIAL_ID]: sparse } }
  const res = apiGraphSchema.safeParse(graph)

  expect(res.success).toBe(true)
  expect(res.data?.materials?.[MATERIAL_ID]).toEqual(sparse)
})
