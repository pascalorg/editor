import type { AnyNode, AnyNodeId, ElevatorNode } from '../../schema'
import { type ElevatorInteractiveState, useInteractive } from '../../store/use-interactive'
import useScene from '../../store/use-scene'
import { type ElevatorLevelEntry, resolveElevatorLevels } from './elevator-service'

const EPSILON = 0.001

function moveToward(current: number, target: number, maxDelta: number) {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}

export function createElevatorInteractiveState(
  levelId: AnyNodeId,
  carY: number,
): ElevatorInteractiveState {
  return {
    currentLevelId: levelId,
    targetLevelId: null,
    carY,
    doorOpen: 0,
    phase: 'idle',
    phaseStartedAt: null,
    queue: [],
    requestedStops: [],
  }
}

function getInitialElevatorState(
  elevatorId: AnyNodeId,
  nodes: Record<string, AnyNode>,
): ElevatorInteractiveState | null {
  const node = nodes[elevatorId]
  if (node?.type !== 'elevator') return null

  const { defaultEntry } = resolveElevatorLevels(node, nodes)
  if (!defaultEntry) return null

  return createElevatorInteractiveState(defaultEntry.id as AnyNodeId, defaultEntry.baseY)
}

function ensureElevatorState(
  elevatorId: AnyNodeId,
  nodes: Record<string, AnyNode>,
): ElevatorInteractiveState | null {
  const interactive = useInteractive.getState()
  const existing = interactive.elevators[elevatorId]
  if (existing) return existing

  const initial = getInitialElevatorState(elevatorId, nodes)
  if (!initial) return null

  interactive.initElevator(elevatorId, initial.currentLevelId as AnyNodeId, initial.carY)
  return initial
}

export function queueElevatorRequest(
  state: ElevatorInteractiveState,
  levelId: AnyNodeId,
): ElevatorInteractiveState {
  const isAlreadyQueued = state.queue.includes(levelId) || state.targetLevelId === levelId
  if (isAlreadyQueued) return state

  return {
    ...state,
    queue: [...state.queue, levelId],
    requestedStops: state.requestedStops.includes(levelId)
      ? state.requestedStops
      : [...state.requestedStops, levelId],
  }
}

export function openElevatorDoorState(state: ElevatorInteractiveState): ElevatorInteractiveState {
  if (!state.currentLevelId || state.phase === 'moving') return state

  return {
    ...state,
    phase: 'opening',
    phaseStartedAt: null,
  }
}

export function requestElevatorLevel(elevatorId: AnyNodeId, levelId: AnyNodeId) {
  const nodes = useScene.getState().nodes
  const current = ensureElevatorState(elevatorId, nodes)
  if (!current) return

  const next = queueElevatorRequest(current, levelId)
  if (next === current) return

  useInteractive.getState().setElevatorState(elevatorId, next)
}

export function openElevatorDoor(elevatorId: AnyNodeId) {
  const nodes = useScene.getState().nodes
  const current = ensureElevatorState(elevatorId, nodes)
  if (!current) return

  const next = openElevatorDoorState(current)
  if (next === current) return

  useInteractive.getState().setElevatorState(elevatorId, next)
}

export function stepElevatorRuntimeState({
  defaultEntry,
  delta,
  elevator,
  entries,
  now,
  state,
}: {
  defaultEntry: ElevatorLevelEntry
  delta: number
  elevator: ElevatorNode
  entries: ElevatorLevelEntry[]
  now: number
  state: ElevatorInteractiveState
}): ElevatorInteractiveState {
  const currentEntry = entries.find((entry) => entry.id === state.currentLevelId) ?? defaultEntry
  if (currentEntry.id !== state.currentLevelId) {
    return {
      ...state,
      currentLevelId: currentEntry.id as AnyNodeId,
      carY: currentEntry.baseY,
      targetLevelId: null,
      phase: 'idle',
      phaseStartedAt: null,
      queue: [],
      requestedStops: [],
      doorOpen: 0,
    }
  }

  const targetEntry = state.targetLevelId
    ? entries.find((entry) => entry.id === state.targetLevelId)
    : state.queue[0]
      ? entries.find((entry) => entry.id === state.queue[0])
      : null

  const doorDurationMs = Math.max(elevator.doorDurationMs ?? 900, 1)
  const doorStep = (delta * 1000) / doorDurationMs

  switch (state.phase) {
    case 'idle': {
      const nextLevelId = state.queue[0] ?? null
      if (!nextLevelId) {
        if (state.doorOpen > EPSILON) {
          return {
            ...state,
            doorOpen: Math.max(0, state.doorOpen - doorStep),
          }
        }
        if (state.requestedStops.length === 0) return state
        return {
          ...state,
          requestedStops: [],
        }
      }

      return {
        ...state,
        targetLevelId: nextLevelId,
        phase:
          state.doorOpen > EPSILON
            ? 'closing'
            : nextLevelId === state.currentLevelId
              ? 'opening'
              : 'moving',
        phaseStartedAt: now,
      }
    }

    case 'closing': {
      const doorOpen = Math.max(0, state.doorOpen - doorStep)
      return {
        ...state,
        doorOpen,
        phase: doorOpen <= EPSILON ? (state.targetLevelId ? 'moving' : 'idle') : 'closing',
        phaseStartedAt: doorOpen <= EPSILON ? now : state.phaseStartedAt,
      }
    }

    case 'moving': {
      if (!targetEntry) {
        return {
          ...state,
          targetLevelId: null,
          phase: 'idle',
          queue: [],
          requestedStops: [],
        }
      }

      const speed = Math.max(elevator.speed ?? 2.2, 0.1)
      const nextY = moveToward(state.carY, targetEntry.baseY, speed * delta)
      const arrived = Math.abs(nextY - targetEntry.baseY) <= EPSILON
      return {
        ...state,
        carY: nextY,
        currentLevelId: arrived ? (targetEntry.id as AnyNodeId) : state.currentLevelId,
        phase: arrived ? 'opening' : 'moving',
        phaseStartedAt: arrived ? now : state.phaseStartedAt,
      }
    }

    case 'opening': {
      const doorOpen = Math.min(1, state.doorOpen + doorStep)
      return {
        ...state,
        doorOpen,
        phase: doorOpen >= 1 - EPSILON ? 'open' : 'opening',
        phaseStartedAt: doorOpen >= 1 - EPSILON ? now : state.phaseStartedAt,
        targetLevelId: doorOpen >= 1 - EPSILON ? null : state.targetLevelId,
        queue:
          doorOpen >= 1 - EPSILON && state.queue[0] === state.currentLevelId
            ? state.queue.slice(1)
            : state.queue,
      }
    }

    case 'open': {
      const elapsed = now - (state.phaseStartedAt ?? now)
      if (elapsed < Math.max(elevator.dwellMs ?? 1400, 0)) return state

      return {
        ...state,
        phase: 'closing',
        phaseStartedAt: now,
        targetLevelId: state.queue[0] ?? null,
      }
    }
  }
}

export function stepElevatorRuntimes(now: number, delta: number) {
  const nodes = useScene.getState().nodes
  const interactive = useInteractive.getState()

  for (const elevatorId of Object.keys(interactive.elevators)) {
    const typedElevatorId = elevatorId as AnyNodeId
    if (nodes[typedElevatorId]?.type !== 'elevator') {
      interactive.removeElevator(typedElevatorId)
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.type !== 'elevator') continue

    const elevatorId = node.id as AnyNodeId
    const { entries, defaultEntry } = resolveElevatorLevels(node, nodes)
    if (!defaultEntry) continue

    const state = useInteractive.getState().elevators[elevatorId]
    if (!state) {
      useInteractive
        .getState()
        .initElevator(elevatorId, defaultEntry.id as AnyNodeId, defaultEntry.baseY)
      continue
    }

    const next = stepElevatorRuntimeState({
      defaultEntry,
      delta,
      elevator: node,
      entries,
      now,
      state,
    })
    if (next !== state) {
      useInteractive.getState().setElevatorState(elevatorId, next)
    }
  }
}
