import { expect, test } from 'bun:test'
import { type ScriptedNode, scriptedObjectMeta } from '@pascal-app/core'
import {
  addColumn,
  addObject,
  applySceneChanges,
  rescriptOpening,
} from '@pascal-app/core/agent-operations'
import {
  addColumnTool,
  addDoorTool,
  addObjectTool,
  addWindowTool,
} from '@pascal-app/core/agent-tools'
import { planWallOpening } from '@pascal-app/core/building'
import {
  type AnyNode,
  type CompiledGeometryScript,
  GeometryArtifactManifest,
  GeometryScriptSource,
  LevelNode,
  WallNode,
} from '@pascal-app/core/schema'
import { z } from 'zod'

const compiled: CompiledGeometryScript = {
  sha256: 'a'.repeat(64),
  script: 'b'.repeat(64),
  mount: 'floor',
  params: {},
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    triangles: 12,
  }),
}
const level = LevelNode.parse({ id: 'level_meta' })
const wall = WallNode.parse({ id: 'wall_meta', parentId: level.id, start: [0, 0], end: [5, 0] })
const nodes = { [level.id]: level, [wall.id]: wall }
const context = { activeLevelId: level.id }
const meta = {
  name: 'Oak cabinet',
  description: 'A cabinet with carved doors',
  category: 'cabinet',
  tags: ['oak', 'carved'],
}

test('old script sources still parse, and malformed lineage is refused', () => {
  const old = {
    kind: 'script',
    script: compiled.script,
    artifact: compiled.sha256,
    manifest: compiled.manifest,
  }
  expect(GeometryScriptSource.parse(old).meta).toBeUndefined()
  expect(GeometryScriptSource.safeParse({ ...old, meta: { parent: 'not-a-hash' } }).success).toBe(
    false,
  )
})
for (const tool of [addObjectTool, addDoorTool, addWindowTool, addColumnTool]) {
  test(`${tool.name} caps and normalizes reuse fields`, () => {
    const parsed = z.object(tool.input).parse({
      description: 'x'.repeat(250),
      name: 'n'.repeat(150),
      category: 'c'.repeat(90),
      tags: Array(8).fill(' A'.repeat(40)),
    })
    expect(parsed.description).toHaveLength(200)
    expect(parsed.name).toHaveLength(120)
    expect(parsed.category).toHaveLength(60)
    expect(parsed.tags).toHaveLength(5)
    expect(parsed.tags!.every((tag) => tag.length <= 32 && tag === tag.toLowerCase())).toBe(true)
  })
}
for (const kind of ['item', 'door', 'window', 'column'] as const) {
  test(`${kind} keeps reuse metadata and records lineage under its reserved identity`, () => {
    const build = {
      ...compiled,
      mount: kind === 'door' || kind === 'window' ? ('wall' as const) : ('floor' as const),
      nodeId: `${kind}_reserved_meta`,
    }
    let before: Record<string, AnyNode>
    if (kind === 'item')
      before = applySceneChanges(
        nodes,
        addObject(nodes, { ...meta, compiled: build }, context).changes,
      )
    else if (kind === 'column')
      before = applySceneChanges(
        nodes,
        addColumn(nodes, { ...meta, x: 1, z: 1, compiled: build }, context).changes,
      )
    else {
      const { node } = planWallOpening(nodes, {
        kind,
        wallId: wall.id,
        t: 0.5,
        ...meta,
        compiled: build,
      })
      before = { ...nodes, [node.id]: node }
    }
    const nodeId = build.nodeId
    // The name lives on the node and an item's category on its asset.
    const { name: _, ...stored } = meta
    const { category: __, ...itemStored } = stored
    const expected = kind === 'item' ? itemStored : stored
    expect(before[nodeId]).toBeDefined()
    expect((before[nodeId] as { source?: { meta?: unknown } }).source?.meta).toEqual(expected)
    const next = { ...build, script: 'c'.repeat(64), sha256: 'd'.repeat(64) }
    const outcome =
      kind === 'item'
        ? addObject(before, { nodeId, compiled: next }, context)
        : kind === 'column'
          ? addColumn(before, { nodeId, compiled: next }, context)
          : rescriptOpening(before, { nodeId, compiled: next }, context)
    const after = applySceneChanges(before, outcome.changes)
    expect((after[nodeId] as { source?: { meta?: unknown } }).source?.meta).toEqual({
      ...expected,
      parent: build.script,
    })
    expect(scriptedObjectMeta(after[nodeId] as ScriptedNode)).toEqual({
      ...meta,
      parent: build.script,
    })
    const updated =
      kind === 'item'
        ? addObject(
            after,
            { nodeId, compiled: build, tags: ['NEW'], description: 'Edited' },
            context,
          )
        : kind === 'column'
          ? addColumn(
              after,
              { nodeId, compiled: build, tags: ['NEW'], description: 'Edited' },
              context,
            )
          : rescriptOpening(
              after,
              { nodeId, compiled: build, tags: ['NEW'], description: 'Edited' },
              context,
            )
    expect(
      (applySceneChanges(after, updated.changes)[nodeId] as { source?: { meta?: unknown } }).source
        ?.meta,
    ).toEqual({ ...expected, description: 'Edited', tags: ['new'], parent: next.script })
  })
}

test('a column metadata edit keeps its current build and lineage', () => {
  const created = addColumn(nodes, { ...meta, x: 0, z: 0, compiled }, context)
  const before = applySceneChanges(nodes, created.changes)
  const nodeId = created.result.nodeId as string
  const outcome = addColumn(
    before,
    { nodeId, tags: ['Updated'], description: 'New description' },
    context,
  )
  const node = applySceneChanges(before, outcome.changes)[nodeId] as {
    source?: { script?: string; meta?: unknown }
  }
  expect(node.source?.script).toBe(compiled.script)
  expect(node.source?.meta).toEqual({
    category: meta.category,
    tags: ['updated'],
    description: 'New description',
  })
})

test('a build without reuse metadata carries no meta object', () => {
  const created = addObject(nodes, { compiled: { ...compiled, nodeId: 'item_bare' } }, context)
  const source = (applySceneChanges(nodes, created.changes).item_bare as ScriptedNode).source
  expect('meta' in source).toBe(false)
})

test('a params-only rebuild runs the same script and keeps the lineage it had', () => {
  const created = addObject(
    nodes,
    { ...meta, compiled: { ...compiled, nodeId: 'item_lineage' } },
    context,
  )
  const first = applySceneChanges(nodes, created.changes)
  const edited = { ...compiled, script: 'c'.repeat(64), sha256: 'd'.repeat(64) }
  const second = applySceneChanges(
    first,
    addObject(first, { nodeId: 'item_lineage', compiled: edited }, context).changes,
  )
  const resized = { ...edited, sha256: 'e'.repeat(64), params: { width: 2 } }
  const third = applySceneChanges(
    second,
    addObject(second, { nodeId: 'item_lineage', compiled: resized }, context).changes,
  )
  expect(
    (third.item_lineage as { source?: { meta?: { parent?: string } } }).source?.meta?.parent,
  ).toBe(compiled.script)
})
