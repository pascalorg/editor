import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BuildingNode } from '../schema/nodes/building'
import { LevelNode } from '../schema/nodes/level'
import { WallNode } from '../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  runAsSingleSceneHistoryStep,
  type SceneCommit,
  subscribeSceneCommits,
} from './history-control'
import useScene, { clearSceneHistory } from './use-scene'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BUILDING_ID = 'building_changed_ids' as AnyNodeId
const LEVEL_ID = 'level_changed_ids' as AnyNodeId

let unsubscribe = () => {}

describe('scene commit changed node IDs', () => {
  beforeEach(() => {
    const level = LevelNode.parse({
      id: LEVEL_ID,
      parentId: BUILDING_ID,
      children: [],
    })
    const building = BuildingNode.parse({
      id: BUILDING_ID,
      parentId: null,
      children: [LEVEL_ID],
    })
    useScene.setState({
      nodes: { [BUILDING_ID]: building, [LEVEL_ID]: level },
      rootNodeIds: [BUILDING_ID],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    clearSceneHistory()
  })

  afterEach(() => {
    unsubscribe()
    unsubscribe = () => {}
  })

  test('carries local mutation IDs and unions them across a compound history step', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    const first = WallNode.parse({
      id: 'wall_changed_1',
      parentId: LEVEL_ID,
      start: [0, 0],
      end: [4, 0],
    })
    const second = WallNode.parse({
      id: 'wall_changed_2',
      parentId: LEVEL_ID,
      start: [4, 0],
      end: [4, 3],
    })

    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().createNode(first, LEVEL_ID)
      useScene.getState().createNode(second, LEVEL_ID)
      useScene.getState().updateNode(first.id, {
        end: [5, 0],
      } as Partial<AnyNode>)
    })

    expect(commits).toHaveLength(1)
    expect(commits[0]?.changedNodeIds).toEqual(new Set([first.id, second.id]))
  })
})
