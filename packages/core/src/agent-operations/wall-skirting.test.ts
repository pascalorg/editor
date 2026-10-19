import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools'
import { setWallGeometry } from '../commands/structure'
import { type AnyNode, LevelNode, WallNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import type { SceneNodes } from './types'
import { type SetWallSkirtingInput, setWallSkirting } from './wall-skirting'

/** A 5 × 4 m room of four walls running anticlockwise, so face a of each is inside. */
function room(): Record<string, AnyNode> {
  const corners: [number, number][] = [
    [0, 0],
    [5, 0],
    [5, 4],
    [0, 4],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_skirting',
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.2,
    }),
  )
  const level = LevelNode.parse({
    id: 'level_skirting',
    level: 0,
    children: walls.map((wall) => wall.id),
  })
  return Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
}

function run(nodes: SceneNodes, input: SetWallSkirtingInput) {
  const outcome = setWallSkirting(nodes, input, { activeLevelId: 'level_skirting' })
  return { ...outcome, nodes: applySceneChanges(nodes, outcome.changes) as Record<string, AnyNode> }
}

function refusal(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  throw new Error('expected a refusal')
}

describe('setWallSkirting', () => {
  test('runs along the face its room stands on, at the size given', () => {
    const { nodes, result } = run(room(), { wallIds: ['wall_0'], height: 0.14, depth: 0.012 })
    expect((nodes.wall_0 as WallNode).skirting).toMatchObject({
      enabled: true,
      sides: 'a',
      height: 0.14,
      proud: 0.012,
    })
    expect(result.walls).toEqual([{ id: 'wall_0', faces: ['a'], height: 0.14, depth: 0.012 }])
  })

  test('paints the skirting slot of each face it runs along, and no other', () => {
    const { nodes } = run(room(), {
      wallIds: ['wall_0', 'wall_1'],
      faces: 'both',
      finish: 'library:preset-white',
    })
    for (const id of ['wall_0', 'wall_1'])
      expect((nodes[id] as WallNode).slots).toEqual({
        aSkirting: 'library:preset-white',
        bSkirting: 'library:preset-white',
      })
    expect((nodes.wall_2 as WallNode).slots).toBeUndefined()
  })

  test('hidden, it keeps its settings, as the panel hides it', () => {
    const shown = run(room(), { wallIds: ['wall_0'], height: 0.2 }).nodes
    const { nodes } = run(shown, { wallIds: ['wall_0'], enabled: false })
    expect((nodes.wall_0 as WallNode).skirting).toMatchObject({ enabled: false, height: 0.2 })
  })

  test('a wall with no room on either face names its faces', () => {
    const nodes = {
      ...room(),
      wall_free: WallNode.parse({
        id: 'wall_free',
        parentId: 'level_skirting',
        start: [10, 0],
        end: [12, 0],
      }),
    }
    expect(refusal(() => run(nodes, { wallIds: ['wall_free'] }))).toBe('side_unknown')
    expect(run(nodes, { wallIds: ['wall_free'], faces: 'b' }).result.walls).toEqual([
      { id: 'wall_free', faces: ['b'], height: 0.12, depth: 0.02 },
    ])
  })

  test('refuses a size that is no length, and a node that is no wall', () => {
    expect(refusal(() => run(room(), { wallIds: ['wall_0'], height: 0 }))).toBe('invalid_size')
    expect(refusal(() => run(room(), { wallIds: ['level_skirting'] }))).toBe('target_not_found')
  })

  test('is a property of the wall: a moved wall keeps it', () => {
    const skirted = run(room(), { wallIds: ['wall_0'], height: 0.15 }).nodes
    const before = (skirted.wall_0 as WallNode).skirting
    const plan = setWallGeometry(skirted, {
      wallId: 'wall_0',
      start: [0, -1],
      end: [5, -1],
      mintId: (kind) => `${kind}_moved`,
    })
    const change = plan.changes.find((entry) => entry.op === 'update' && entry.id === 'wall_0')
    if (change?.op !== 'update') throw new Error('expected the wall to move')
    const moved = { ...skirted.wall_0, ...change.data } as WallNode
    expect(moved.start).toEqual([0, -1])
    expect(moved.skirting).toEqual(before)
  })
})
