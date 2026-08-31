import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  ElevatorNode,
  LevelNode,
  SlabNode,
} from '../../schema'
import { type SceneCommit, subscribeSceneCommits } from '../../store/history-control'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { initializeElevatorOpeningSync } from './elevator-opening-system'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BUILDING_ID = 'building_elevator_opening_commit' as AnyNodeId
const ELEVATOR_ID = 'elevator_opening_commit' as AnyNodeId
const GROUND_LEVEL_ID = 'level_elevator_opening_ground' as AnyNodeId
const UPPER_LEVEL_ID = 'level_elevator_opening_upper' as AnyNodeId
const UPPER_SLAB_ID = 'slab_elevator_opening_upper' as AnyNodeId

let stopOpeningSync = () => {}
let stopCommitSubscription = () => {}

function resetScene() {
  const ground = LevelNode.parse({
    id: GROUND_LEVEL_ID,
    children: [],
    level: 0,
    parentId: BUILDING_ID,
  })
  const upper = LevelNode.parse({
    id: UPPER_LEVEL_ID,
    children: [UPPER_SLAB_ID],
    level: 1,
    parentId: BUILDING_ID,
  })
  const elevator = ElevatorNode.parse({
    id: ELEVATOR_ID,
    depth: 1.6,
    fromLevelId: GROUND_LEVEL_ID,
    parentId: BUILDING_ID,
    position: [2, 0, 1.5],
    toLevelId: UPPER_LEVEL_ID,
    visible: false,
    width: 1.6,
  })
  const upperSlab = SlabNode.parse({
    id: UPPER_SLAB_ID,
    holes: [],
    parentId: UPPER_LEVEL_ID,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  })
  const building = BuildingNode.parse({
    id: BUILDING_ID,
    children: [GROUND_LEVEL_ID, UPPER_LEVEL_ID, ELEVATOR_ID],
  })

  useScene.setState({
    collections: {},
    dirtyNodes: new Set<AnyNodeId>(),
    materials: {},
    nodes: Object.fromEntries(
      [building, ground, upper, elevator, upperSlab].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>,
    readOnly: false,
    rootNodeIds: [BUILDING_ID],
  } as never)
  clearSceneHistory()
}

function getOpeningCenter(nodes: Record<AnyNodeId, AnyNode>): [number, number] | null {
  const slab = nodes[UPPER_SLAB_ID] as { holes?: [number, number][][] }
  const opening = slab.holes?.[0]
  if (!opening || opening.length === 0) return null

  const [x, z] = opening.reduce(([sumX, sumZ], point) => [sumX + point[0], sumZ + point[1]], [0, 0])
  return [x / opening.length, z / opening.length]
}

function getElevatorPosition(nodes: Record<AnyNodeId, AnyNode>) {
  return (nodes[ELEVATOR_ID] as { position?: [number, number, number] }).position
}

describe('ElevatorOpeningSystem scene commit boundary', () => {
  beforeEach(() => {
    stopOpeningSync()
    stopCommitSubscription()
    stopOpeningSync = () => {}
    stopCommitSubscription = () => {}
    resetScene()
  })

  afterEach(() => {
    stopOpeningSync()
    stopCommitSubscription()
    stopOpeningSync = () => {}
    stopCommitSubscription = () => {}
  })

  test('includes the elevator edit and derived slab opening in one commit and undo step', () => {
    const commits: SceneCommit[] = []
    stopOpeningSync = initializeElevatorOpeningSync()
    stopCommitSubscription = subscribeSceneCommits((commit) => commits.push(commit))

    useScene.getState().updateNode(ELEVATOR_ID, { visible: true } as Partial<AnyNode>)

    expect(commits).toHaveLength(1)
    expect(commits[0]?.origin).toBe('local')
    expect(commits[0]?.before.nodes[ELEVATOR_ID]?.visible).toBe(false)
    expect(commits[0]?.current.nodes[ELEVATOR_ID]?.visible).toBe(true)
    expect((commits[0]?.before.nodes[UPPER_SLAB_ID] as { holes?: unknown[] }).holes).toEqual([])
    expect((commits[0]?.current.nodes[UPPER_SLAB_ID] as { holes?: unknown[] }).holes).toHaveLength(
      1,
    )
    expect(
      (commits[0]?.current.nodes[UPPER_SLAB_ID] as { holeMetadata?: unknown[] }).holeMetadata,
    ).toEqual([{ elevatorId: ELEVATOR_ID, source: 'elevator' }])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()

    expect(useScene.getState().nodes[ELEVATOR_ID]?.visible).toBe(false)
    expect((useScene.getState().nodes[UPPER_SLAB_ID] as { holes?: unknown[] }).holes).toEqual([])
  })

  test('processes a second relevant elevator mutation in the same turn', () => {
    const commits: SceneCommit[] = []
    stopOpeningSync = initializeElevatorOpeningSync()
    stopCommitSubscription = subscribeSceneCommits((commit) => commits.push(commit))

    useScene.getState().updateNode(ELEVATOR_ID, { visible: true } as Partial<AnyNode>)
    useScene.getState().updateNode(ELEVATOR_ID, { position: [3, 0, 1.5] } as Partial<AnyNode>)

    expect(commits).toHaveLength(2)
    expect(getOpeningCenter(commits[0]!.current.nodes)).toEqual([2, 1.5])
    expect(getElevatorPosition(commits[1]!.before.nodes)).toEqual([2, 0, 1.5])
    expect(getOpeningCenter(commits[1]!.before.nodes)).toEqual([2, 1.5])
    expect(getElevatorPosition(commits[1]!.current.nodes)).toEqual([3, 0, 1.5])
    expect(getOpeningCenter(commits[1]!.current.nodes)).toEqual([3, 1.5])
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)

    useScene.temporal.getState().undo()

    expect(getElevatorPosition(useScene.getState().nodes)).toEqual([2, 0, 1.5])
    expect(getOpeningCenter(useScene.getState().nodes)).toEqual([2, 1.5])

    useScene.temporal.getState().undo()

    expect(useScene.getState().nodes[ELEVATOR_ID]?.visible).toBe(false)
    expect((useScene.getState().nodes[UPPER_SLAB_ID] as { holes?: unknown[] }).holes).toEqual([])
  })
})
