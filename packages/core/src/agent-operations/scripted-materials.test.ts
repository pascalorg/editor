import { expect, test } from 'bun:test'
import { planWallOpening } from '../building'
import type { CompiledGeometryScript } from '../schema'
import { type AnyNode, ColumnNode, GeometryArtifactManifest, LevelNode, WallNode } from '../schema'
import { addColumn, applySceneChanges, rescriptOpening } from './index'

const compiled: CompiledGeometryScript = {
  sha256: 'a'.repeat(64),
  script: 'b'.repeat(64),
  mount: 'wall',
  params: {},
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.5, 0, -0.1], max: [0.5, 1, 0.1] },
    triangles: 12,
    slots: [
      { id: 'body', color: '#a77440', roughness: 0.7 },
      { id: 'pane', transparent: true },
      { id: 'unknown', color: '#ff00ff' },
    ],
  }),
}

const level = LevelNode.parse({ id: 'level_script_materials' })
const wall = WallNode.parse({
  id: 'wall_script_materials',
  parentId: level.id,
  start: [0, 0],
  end: [5, 0],
})
const nodes = { [level.id]: level, [wall.id]: wall }
const context = { activeLevelId: level.id }
const expected = { body: 'library:wood-finewood27', pane: 'library:preset-glass' }

for (const kind of ['window', 'door'] as const) {
  test(`a scripted ${kind} is matched on creation and keeps paint when rebuilt`, () => {
    const { node } = planWallOpening(nodes, { kind, wallId: wall.id, t: 0.5, compiled })
    expect(node.slots).toEqual(expected)
    const painted = { ...node, slots: { ...node.slots, body: '#123456' } }
    const before = { ...nodes, [node.id]: painted } as Record<string, AnyNode>
    const rebuilt = rescriptOpening(before, { nodeId: node.id, compiled }, context)
    const after = applySceneChanges(before, rebuilt.changes)
    expect(after[node.id]!.slots).toEqual({ ...expected, body: '#123456' })
    expect(before[node.id]!.slots).toEqual(painted.slots)
  })
}

test('a scripted column is matched on creation and keeps paint when rebuilt', () => {
  const input = { x: 0, z: 0, compiled: { ...compiled, mount: 'floor' as const } }
  const added = addColumn(nodes, input, context)
  const after = applySceneChanges(nodes, added.changes)
  const node = ColumnNode.parse(after[added.result.nodeId as string])
  expect(node.slots).toEqual(expected)
  const painted = { ...node, slots: { ...node.slots, body: 'library:preset-white' } }
  const before = { ...after, [node.id]: painted }
  const rebuilt = addColumn(before, { ...input, nodeId: node.id }, context)
  expect(applySceneChanges(before, rebuilt.changes)[node.id]!.slots).toEqual({
    ...expected,
    body: 'library:preset-white',
  })
})
