import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { verifySceneModelResult } from '../agent-tools/verify-scene'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { setSdfChecks } from '../spatial/usage-field/flag'
import './index'
import type { SceneNodes } from './types'
import { verifyScene, verifySceneSteps } from './verify-scene'

type Pt = [number, number]
type Report = { issues: { type: string }[] }
type Answer = { issueCount: number; issues: unknown[] }

const wall = (id: string, start: Pt, end: Pt, children: string[] = []) =>
  WallNode.parse({ id, parentId: 'level_1', start, end, thickness: 0.1, children })

const door = (id: string, wallId: string, x: number) =>
  DoorNode.parse({
    id,
    parentId: wallId,
    wallId,
    position: [x, 1.05, 0],
    width: 0.9,
    height: 2.1,
    frameDepth: 0.07,
  })

const room = (id: string, name: string, x0: number, x1: number) =>
  ZoneNode.parse({
    id,
    parentId: 'level_1',
    name,
    polygon: [
      [x0, 0],
      [x1, 0],
      [x1, 4],
      [x0, 4],
    ],
  })

const piece = (id: string, x: number, z: number, width: number, depth: number) =>
  ItemNode.parse({
    id,
    parentId: 'level_1',
    position: [x, 0, z],
    name: id,
    asset: {
      id,
      name: id,
      category: 'storage',
      thumbnail: '/t.webp',
      src: `/items/${id}/model.glb`,
      dimensions: [width, 1.0, depth],
    },
  })

// A 6 x 4 m shell of two rooms, entered from the street into the west one. Its pieces leave a
// narrow way to the inner door, stand in that door's swing, overlap each other and fence off a
// corner, so the report holds findings of several usage types beside the ordinary ones.
const nodes = Object.fromEntries(
  (
    [
      BuildingNode.parse({ id: 'building_1', children: ['level_1'] }),
      LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] }),
      SlabNode.parse({
        id: 'slab_1',
        parentId: 'level_1',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 4],
          [0, 4],
        ],
      }),
      wall('wall_s', [0, 0], [6, 0], ['door_front']),
      wall('wall_e', [6, 0], [6, 4]),
      wall('wall_n', [6, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      wall('wall_p', [3, 0], [3, 4], ['door_inner']),
      door('door_front', 'wall_s', 1.5),
      door('door_inner', 'wall_p', 2),
      room('zone_west', 'West room', 0, 3),
      room('zone_east', 'East room', 3, 6),
      piece('item_a', 1.2, 1.0, 0.4, 1.4),
      piece('item_b', 2.0, 1.4, 0.6, 0.4),
      piece('item_c', 2.2, 1.5, 0.6, 0.6),
      piece('item_d', 3.6, 2.0, 0.5, 0.9),
      piece('item_e', 4.6, 2.0, 0.4, 3.6),
    ] as AnyNode[]
  ).map((node) => [node.id, node]),
) as SceneNodes

const context = { activeLevelId: 'level_1' }
const report = (input: Record<string, unknown>) => verifyScene(nodes, input, context).result
const answer = (from: Record<string, unknown>, input: Record<string, unknown>) =>
  verifySceneModelResult(from, input) as Answer

describe('verify_scene asked for one finding type, with the usage checks on', () => {
  beforeAll(() => setSdfChecks(true))
  afterAll(() => setSdfChecks(false))

  test('answers the findings of that type the whole report holds, for every type', () => {
    const whole = report({})
    const found = [...new Set((whole as Report).issues.map((issue) => issue.type))]
    expect(found.filter((type) => type.startsWith('usage_')).length).toBeGreaterThan(2)
    expect(found.some((type) => !type.startsWith('usage_'))).toBe(true)
    const asked = [...found, 'usage_room', 'usage_bed_clearance', 'room_unnamed', 'no_such_type']
    for (const type of asked) {
      const typed = answer(report({ type }), { type })
      const before = answer(whole, { type })
      expect({ type, issues: typed.issues }).toEqual({ type, issues: before.issues })
      expect(typed.issueCount).toBe(before.issueCount)
    }
  })

  test('a room and a type together answer as the whole report does', () => {
    const input = { room: 'West room', type: 'usage_room' }
    expect(answer(report(input), input)).toEqual(answer(report({ room: 'West room' }), input))
  })

  test('a misspelt usage type answers with every type the whole report holds', () => {
    const input = { type: 'usage_passage_narow' }
    expect(answer(report(input), input)).toEqual(answer(report({}), input))
  })

  test('taken a step at a time, it stops between its checks and answers the same report', () => {
    const steps = verifySceneSteps(nodes, {}, context)
    let stops = 0
    let step = steps.next()
    for (; !step.done; step = steps.next()) stops++
    // More stops than checks: the circulation measurement stops after each floor.
    expect(stops).toBeGreaterThan(5)
    expect(step.value.result).toEqual(report({}))
  })

  test('the report for a type that is not a usage finding holds no usage findings', () => {
    const typed = report({ type: 'door_blocked' }) as Report
    expect(typed.issues.filter((issue) => issue.type.startsWith('usage_'))).toEqual([])
    expect((report({}) as Report).issues.some((issue) => issue.type.startsWith('usage_'))).toBe(
      true,
    )
  })
})
