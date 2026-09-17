import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  type RoofNode,
  resolveRoomRoofFootprint,
  type SceneApi,
  WallNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { commitRoofFootprint, commitRoofPlacement } from './tool'

const originalDefaults = useEditor.getState().toolDefaults

afterEach(() => useEditor.setState({ toolDefaults: originalDefaults }))

function setup() {
  const level = LevelNode.parse({ level: 0, height: 3 })
  const upper = LevelNode.parse({ level: 1, height: 3 })
  const polygon: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      parentId: level.id,
      start,
      end: polygon[(index + 1) % polygon.length],
      height: 2.5,
    }),
  )
  level.children = walls.map((wall) => wall.id)
  const nodes = Object.fromEntries([level, upper, ...walls].map((node) => [node.id, node]))
  const created: Array<{ node: AnyNode; parentId?: AnyNodeId }> = []
  const sceneApi = { nodes: () => nodes, createMany: (ops) => created.push(...ops) } as SceneApi
  return { upper, nodes, created, sceneApi }
}

test('room creation follows walls and retains the computed initial Y', () => {
  const { upper, nodes, created, sceneApi } = setup()
  useEditor.getState().setToolDefaults('roof', { roofType: 'gable', support: { kind: 'level' } })
  const target = resolveRoomRoofFootprint(upper.id, nodes, [2, 1])!
  commitRoofFootprint(sceneApi, upper.id, target, false)
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(upper.id)
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
})

test('free-drawn rectangles stay custom at Y zero even with following preset defaults', () => {
  const { upper, created, sceneApi } = setup()
  useEditor.getState().setToolDefaults('roof', { roofType: 'gable', support: { kind: 'walls' } })
  commitRoofPlacement(sceneApi, upper.id, [0, 9, 0], [4, 9, 3], [], false, 'ground')
  const roof = created.find(({ node }) => node.type === 'roof')?.node as RoofNode
  expect(roof).toMatchObject({ support: { kind: 'level' }, position: [2, 0, 1.5] })
})

test("room creation from the walls' own level still parents the roof to the level above", () => {
  const { upper, nodes, created, sceneApi } = setup()
  const level = Object.values(nodes).find((node) => node.type === 'level' && node.id !== upper.id)!
  const target = resolveRoomRoofFootprint(level.id as LevelNode['id'], nodes, [2, 1])!
  commitRoofFootprint(sceneApi, level.id as LevelNode['id'], target, false)
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(upper.id)
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
})

test("room creation on the top floor keeps the roof on the walls' level at their top", () => {
  const { upper, nodes, created, sceneApi } = setup()
  delete nodes[upper.id]
  const level = Object.values(nodes).find((node) => node.type === 'level')!
  const target = resolveRoomRoofFootprint(level.id as LevelNode['id'], nodes, [2, 1])!
  commitRoofFootprint(sceneApi, level.id as LevelNode['id'], target, false)
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(level.id)
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, 2.5, 1.5] })
})
