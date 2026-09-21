import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  UnitNode,
  ZoneNode,
} from '../../schema'
import { type SceneCommit, subscribeSceneCommits } from '../history-control'
import useScene, { clearSceneHistory } from '../use-scene'

let unsubscribe = () => {}

beforeEach(() => {
  useScene.getState().unloadScene()
  useScene.setState({ readOnly: false })
  clearSceneHistory()
})

afterEach(() => {
  unsubscribe()
  useScene.getState().unloadScene()
  clearSceneHistory()
})

function setup() {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id })
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  const first = ZoneNode.parse({ name: 'First', parentId: level.id, polygon: [] })
  const second = ZoneNode.parse({ name: 'Second', parentId: upper.id, polygon: [] })
  const unit = UnitNode.parse({ parentId: building.id, members: [first.id, second.id] })
  const shared = UnitNode.parse({ parentId: building.id, members: [first.id] })
  building.children = [level.id, upper.id, unit.id, shared.id]
  level.children = [first.id]
  upper.children = [second.id]
  const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
    [building, level, upper, first, second, unit, shared].map((node) => [node.id, node]),
  )
  useScene.setState({
    nodes,
    rootNodeIds: [building.id],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
  })
  clearSceneHistory()
  return { building, level, first, second, unit, shared }
}

describe('unit membership on deletion', () => {
  for (const cascade of [false, true]) {
    test(`${cascade ? 'level cascade' : 'zone deletion'} strips every surviving unit in one undo commit`, () => {
      const { level, first, second, unit, shared } = setup()
      const commits: SceneCommit[] = []
      unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
      useScene.getState().deleteNodes([cascade ? level.id : first.id])

      expect(useScene.getState().nodes[first.id]).toBeUndefined()
      expect((useScene.getState().nodes[unit.id] as UnitNode).members).toEqual([second.id])
      expect((useScene.getState().nodes[shared.id] as UnitNode).members).toEqual([])
      expect(useScene.getState().dirtyNodes.has(unit.id)).toBe(true)
      expect(commits).toHaveLength(1)
      expect(commits[0]!.changedNodeIds).toContain(unit.id)
      expect(commits[0]!.changedNodeIds).toContain(shared.id)
      expect((commits[0]!.current.nodes[unit.id] as UnitNode).members).toEqual([second.id])
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)

      useScene.temporal.getState().undo()
      expect((useScene.getState().nodes[unit.id] as UnitNode).members).toEqual(unit.members)
      expect(useScene.getState().nodes[first.id]).toEqual(first)
      useScene.temporal.getState().redo()
      expect((useScene.getState().nodes[unit.id] as UnitNode).members).toEqual([second.id])
    })
  }

  test('deleting a unit leaves its zones and other units intact', () => {
    const { first, second, unit, shared } = setup()
    useScene.getState().deleteNode(unit.id)
    expect(useScene.getState().nodes[unit.id]).toBeUndefined()
    expect(useScene.getState().nodes[first.id]).toEqual(first)
    expect(useScene.getState().nodes[second.id]).toEqual(second)
    expect(useScene.getState().nodes[shared.id]).toEqual(shared)
  })
})
