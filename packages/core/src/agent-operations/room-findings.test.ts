import { expect, test } from 'bun:test'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import { type AnyNode, generateId, WallNode } from '../schema'
import { building, level, ROOM, scene } from './__fixtures__/verify-scene-cases'
import { AGENT_OPERATIONS } from './index'

const reconcile = (nodes: Record<string, AnyNode>, previousNodes?: Record<string, AnyNode>) =>
  reconcileSceneStructure({ nodes, previousNodes, mintId: (kind) => generateId(kind) })
    .nodes as Record<string, AnyNode>

const issues = (nodes: Record<string, AnyNode>) =>
  (
    AGENT_OPERATIONS.verify_scene(nodes, {}, { activeLevelId: null }).result as {
      issues: { type: string; zoneId?: string }[]
    }
  ).issues

// The life of a room as the editor and both agent surfaces run it: the reconciler derives the room
// from its walls, and marks it open when a wall goes. verify_scene reads that, as check_rooms did.
test('a room the reconciler derived, then opened when a wall went, is reported not enclosed', () => {
  const walls = ROOM.map((start, i) =>
    WallNode.parse({
      id: `wall_life_${i}`,
      parentId: 'level_0',
      start,
      end: ROOM[(i + 1) % ROOM.length],
      height: 2.5,
    }),
  )
  const built = reconcile(scene(building(), level('level_0', 0), ...walls).nodes as never)
  const room = Object.values(built).find((node) => node.type === 'zone')
  expect(room).toMatchObject({ spaceRole: 'room', autoFromWalls: true })
  expect(issues(built).map((issue) => issue.type)).not.toContain('room_not_enclosed')

  const { wall_life_2: _gone, ...rest } = built
  const level0 = rest.level_0 as AnyNode & { children: string[] }
  const opened = reconcile(
    { ...rest, level_0: { ...level0, children: level0.children.filter((id) => id !== _gone!.id) } },
    built,
  )
  expect(opened[room!.id]).toMatchObject({ enclosureStatus: 'open' })
  expect(issues(opened)).toContainEqual(
    expect.objectContaining({ type: 'room_not_enclosed', zoneId: room!.id }),
  )
})
