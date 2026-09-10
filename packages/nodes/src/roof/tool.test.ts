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
