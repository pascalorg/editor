import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from '@ovurrsl/plugin-warehouse'
import { AnyNode, CabinetModuleNode, CabinetNode } from '@pascal-app/core/schema'
import { treesPlugin } from '@pascal-app/plugin-trees'
import { apiGraphSchema } from './graph-schema'

/**
 * Two suites over one module, kept together on purpose.
 *
 * Upstream's tests below cover the envelope: the graph shape, plugin children,
 * `installedPlugins`, materials round-tripping. The fork's suite at the bottom
 * covers the one thing upstream cannot know about — that a `warehouse:*` node
 * validates against the PLUGIN's schema rather than the host's hand-maintained
 * `AnyNode` union, which is the 400 every save containing a rack used to
 * return.
 *
 * **Six of upstream's tests are deliberately absent**, and it is worth knowing
 * which so nobody "restores" them into a red build:
 *
 *   rejects URL-shaped plugin fields outside the AssetUrl allowlist
 *   reports deeply nested plugin nodes as a validation issue, not a crash
 *   treats an unnamespaced unknown type as a foreign node
 *   rejects a material texture URL outside the allowlist
 *   accepts the asset URL forms core allows
 *   does not treat prose or drive paths as URLs
 *
 * All six exercise upstream's content scan — the walk that hunts URL-shaped
 * strings through a node's free-form fields and checks them against `AssetUrl`,
 * bounded by a depth and value budget. This fork kept its own plugin-aware
 * validator through the beta.5 merge and does NOT implement that scan.
 *
 * The first four fail here outright. The last two would *pass* — and that is
 * the worse outcome: with no scan, a plugin node's free-form fields are never
 * walked, so "this URL is accepted" and "this prose is accepted" are true of
 * every string whatsoever. A green test asserting nothing is a claim of
 * coverage the file cannot back. All six come back with the scan, not before.
 * See `UPSTREAM.md`.
 */

function buildGraph(nodes: Record<string, unknown>, rootNodeIds: string[] = []) {
  return { nodes, rootNodeIds }
}

const LEVEL_ID = 'level_a1b2c3d4e5f6g7h8'

const level = (children: string[] = []) => ({
  object: 'node',
  id: LEVEL_ID,
  type: 'level',
  parentId: null,
  children,
  level: 0,
})

/**
 * Upstream's fixture was a hand-written object literal. It cannot be one here:
 * this fork validates a plugin node against the PLUGIN's schema rather than
 * the base envelope, so a literal is only as valid as its author's memory of
 * the trees plugin's required fields — and it silently rots when the plugin
 * changes. Built from the plugin's own schema instead, so defaults materialise
 * and the branded id is minted by `objectId` rather than guessed.
 */
const treeDef = treesPlugin.nodes?.find((d) => d.kind === 'trees:tree') ?? treesPlugin.nodes?.[0]
if (!treeDef) throw new Error('trees plugin registers no node kinds')
const treeParsed = treeDef.schema.safeParse({
  object: 'node',
  type: treeDef.kind,
  parentId: LEVEL_ID,
})
if (!treeParsed.success) {
  throw new Error(
    `could not build a valid ${treeDef.kind}: ${treeParsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`,
  )
}
const TREE_BASE = treeParsed.data as Record<string, unknown>
const TREE_ID = String(TREE_BASE.id)

const pluginTree = (overrides: Record<string, unknown> = {}) => ({
  ...TREE_BASE,
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

// A recursive walk over untrusted JSON must not throw past `safeParse` — the
// route would answer 500 where the contract is a 400 with issues.
test('still rejects invalid builtin nodes', () => {
  const graph = buildGraph({
    wall_bad: { object: 'node', id: 'wall_a1b2c3d4e5f6g7h8', type: 'wall' },
  })

  expect(apiGraphSchema.safeParse(graph).success).toBe(false)
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

// Materials are carried as opaque records here (see `apiGraphSchema`), so this
// asserts the round trip, not the allowlist — the negative half of the pair
// lives with upstream's content scan and is listed absent at the top.
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

/**
 * A real node of the given plugin kind, built by the plugin's own schema so
 * the test breaks if the plugin's contract changes rather than drifting.
 */
function pluginNode(kind: string): Record<string, unknown> {
  const def = warehousePlugin.nodes?.find((d) => d.kind === kind)
  if (!def) throw new Error(`plugin does not register ${kind}`)
  // `id` is deliberately omitted so `objectId`'s default mints a correctly
  // branded one. An earlier version derived it from the kind's local part
  // (`live-rack` → `live-rack_t1`) and that is not a rule: `warehouse:live-rack`
  // brands its ids `live-racking_`. The prefix is persisted user data, so the
  // plugin cannot be renamed to match — the test asks the schema instead.
  const parsed = def.schema.safeParse({
    object: 'node',
    type: kind,
    name: 'Test node',
    parentId: 'level_1',
  })
  if (!parsed.success) {
    throw new Error(`could not build a valid ${kind}: ${parsed.error.issues[0]?.message}`)
  }
  return parsed.data as Record<string, unknown>
}

function graphWith(node: Record<string, unknown>) {
  return {
    nodes: { [String(node.id)]: node },
    rootNodeIds: [String(node.id)],
  }
}

describe('apiGraphSchema plugin nodes', () => {
  test('a warehouse pallet is NOT part of the host AnyNode union (the 400 bug)', () => {
    expect(AnyNode.safeParse(pluginNode('warehouse:pallet')).success).toBe(false)
  })

  test('accepts every node kind the warehouse plugin registers', () => {
    for (const def of warehousePlugin.nodes ?? []) {
      const result = apiGraphSchema.safeParse(graphWith(pluginNode(def.kind)))
      expect(
        result.success,
        `${def.kind} rejected: ${JSON.stringify(result.error?.issues[0])}`,
      ).toBe(true)
    }
  })

  test('still accepts built-in nodes', () => {
    const wall = {
      object: 'node',
      id: 'wall_1',
      type: 'wall',
      name: 'Wall',
      visible: true,
      thickness: 0.2,
      start: [0, 0],
      end: [1, 0],
    }
    expect(apiGraphSchema.safeParse(graphWith(wall)).success).toBe(true)
  })

  test('still rejects unknown node kinds', () => {
    const bogus = { object: 'node', id: 'x_1', type: 'not-a-kind', name: 'X' }
    expect(apiGraphSchema.safeParse(graphWith(bogus)).success).toBe(false)
  })

  test('still rejects a malformed plugin node', () => {
    const broken = { ...pluginNode('warehouse:pallet'), position: 'not-a-vector' }
    expect(apiGraphSchema.safeParse(graphWith(broken)).success).toBe(false)
  })
})
