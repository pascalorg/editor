import { describe, expect, test } from 'bun:test'
import type { AnyNodeId } from '../../schema'
import { ElevatorNode } from '../../schema'
import {
  createElevatorInteractiveState,
  openElevatorDoorState,
  queueElevatorRequest,
  stepElevatorRuntimeState,
} from './elevator-runtime'
import type { ElevatorLevelEntry } from './elevator-service'

const groundLevelId = 'level_ground' as AnyNodeId
const upperLevelId = 'level_upper' as AnyNodeId

const entries: ElevatorLevelEntry[] = [
  { id: groundLevelId as ElevatorLevelEntry['id'], label: '0', baseY: 0 },
  { id: upperLevelId as ElevatorLevelEntry['id'], label: '1', baseY: 2.5 },
]

const [defaultEntry] = entries
if (!defaultEntry) throw new Error('entries fixture must be non-empty')

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
      defaultEntry,
      delta: 0.016,
      elevator,
      entries,
      now: 0,
      state: queued,
    })

    const arrived = stepElevatorRuntimeState({
      defaultEntry,
      delta: 1,
      elevator,
      entries,
      now: 100,
      state: moving,
    })

    const open = stepElevatorRuntimeState({
      defaultEntry,
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
