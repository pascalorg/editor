import { describe, expect, test } from 'bun:test'
import type { AnyNodeId } from '../../schema'
import { BuildingNode, ElevatorNode, LevelNode } from '../../schema'
import { useInteractive } from '../../store/use-interactive'
import useScene from '../../store/use-scene'
import {
  createElevatorInteractiveState,
  openElevatorDoorState,
  queueElevatorRequest,
  requestElevatorLevel,
  stepElevatorRuntimeState,
} from './elevator-runtime'
import type { ElevatorLevelEntry } from './elevator-service'

const groundLevelId = 'level_ground' as AnyNodeId
const upperLevelId = 'level_upper' as AnyNodeId

const entries: ElevatorLevelEntry[] = [
  { id: groundLevelId as ElevatorLevelEntry['id'], label: '0', baseY: 0 },
  { id: upperLevelId as ElevatorLevelEntry['id'], label: '1', baseY: 2.5 },
]

const elevator = ElevatorNode.parse({
  speed: 10,
  doorDurationMs: 100,
  dwellMs: 0,
})

describe('elevator runtime helpers', () => {
  test('queues level requests without duplicating the target', () => {
    const state = createElevatorInteractiveState(groundLevelId, 0)
    const queued = queueElevatorRequest(state, upperLevelId)
    const duplicated = queueElevatorRequest(queued, upperLevelId)

    expect(queued.queue).toEqual([upperLevelId])
    expect(queued.requestedStops).toEqual([upperLevelId])
    expect(duplicated.queue).toEqual([upperLevelId])
    expect(duplicated.requestedStops).toEqual([upperLevelId])
  })

  test('opens doors only when the elevator is not moving', () => {
    const idle = createElevatorInteractiveState(groundLevelId, 0)
    const moving = { ...idle, phase: 'moving' as const }

    expect(openElevatorDoorState(idle).phase).toBe('opening')
    expect(openElevatorDoorState(moving)).toBe(moving)
  })

  test('moves to a queued level and clears the served request on arrival', () => {
    const queued = queueElevatorRequest(
      createElevatorInteractiveState(groundLevelId, 0),
      upperLevelId,
    )
    const moving = stepElevatorRuntimeState({
      defaultEntry: entries[0]!,
      delta: 0.016,
      elevator,
      entries,
      now: 0,
      state: queued,
    })

    const arrived = stepElevatorRuntimeState({
      defaultEntry: entries[0]!,
      delta: 1,
      elevator,
      entries,
      now: 100,
      state: moving,
    })

    const open = stepElevatorRuntimeState({
      defaultEntry: entries[0]!,
      delta: 1,
      elevator,
      entries,
      now: 200,
      state: arrived,
    })

    expect(moving.phase).toBe('moving')
    expect(arrived.currentLevelId).toBe(upperLevelId)
    expect(arrived.phase).toBe('opening')
    expect(open.phase).toBe('open')
    expect(open.queue).toEqual([])
    expect(open.requestedStops).toEqual([upperLevelId])
  })
})

test('stationary cab follows edits to its level elevation', () => {
  const state = createElevatorInteractiveState(groundLevelId, 0)
  const changedEntries = entries.map((entry) => ({ ...entry, baseY: entry.baseY + 1 }))
  const next = stepElevatorRuntimeState({
    defaultEntry: changedEntries[0]!,
    entries: changedEntries,
    elevator,
    now: 1,
    delta: 0.016,
    state,
  })
  expect(next.carY).toBe(1)
  expect(next.phase).toBe('idle')
})

test('a disabled destination is removed and a moving cab returns to an available landing', () => {
  const state = {
    ...createElevatorInteractiveState(groundLevelId, 0),
    carY: 1,
    phase: 'moving' as const,
    targetLevelId: upperLevelId,
    queue: [upperLevelId],
    requestedStops: [upperLevelId],
  }
  const next = stepElevatorRuntimeState({
    defaultEntry: entries[0]!,
    entries,
    elevator: { ...elevator, disabledLevelIds: [upperLevelId] },
    now: 1,
    delta: 0.01,
    state,
  })
  expect(next.targetLevelId).toBe(groundLevelId)
  expect(next.carY).toBeLessThan(1)
  expect(next.queue).not.toContain(upperLevelId)
  expect(next.requestedStops).not.toContain(upperLevelId)
})

test('removing the current landing reconciles the cab to a served landing', () => {
  const next = stepElevatorRuntimeState({
    defaultEntry: entries[1]!,
    entries: [entries[1]!],
    elevator,
    now: 1,
    delta: 0.016,
    state: createElevatorInteractiveState(groundLevelId, 0),
  })
  expect(next.currentLevelId).toBe(upperLevelId)
  expect(next.carY).toBe(entries[1]!.baseY)
  expect(next.queue).toEqual([])
  expect(next.doorOpen).toBe(0)
})

test('requests reject disabled and unserved stops but permit service-only cab stops', () => {
  const before = useScene.getState().nodes
  const interactiveBefore = useInteractive.getState().elevators
  try {
    const building = BuildingNode.parse({})
    const levels = [0, 1, 2].map((level) => LevelNode.parse({ parentId: building.id, level }))
    const node = ElevatorNode.parse({
      parentId: building.id,
      fromLevelId: levels[0]!.id,
      toLevelId: levels[1]!.id,
      disabledLevelIds: [levels[1]!.id],
    })
    building.children = [...levels.map((level) => level.id), node.id]
    useScene.setState({
      nodes: Object.fromEntries([building, ...levels, node].map((n) => [n.id, n])),
    })
    requestElevatorLevel(node.id, levels[1]!.id)
    requestElevatorLevel(node.id, levels[2]!.id)
    expect(useInteractive.getState().elevators[node.id]?.queue ?? []).toEqual([])
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        [node.id]: { ...node, disabledLevelIds: [], serviceOnlyLevelIds: [levels[1]!.id] },
      },
    })
    requestElevatorLevel(node.id, levels[1]!.id)
    expect(useInteractive.getState().elevators[node.id]?.queue).toEqual([levels[1]!.id])
  } finally {
    useScene.setState({ nodes: before })
    useInteractive.setState({ elevators: interactiveBefore })
  }
})
