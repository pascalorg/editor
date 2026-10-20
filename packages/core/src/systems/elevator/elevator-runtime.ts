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

  const { entries, defaultEntry: configuredDefault } = resolveElevatorLevels(node, nodes)
  const defaultEntry =
    entries.find(
      (entry) => entry.id === configuredDefault?.id && !node.disabledLevelIds.includes(entry.id),
    ) ??
    entries.find((entry) => !node.disabledLevelIds.includes(entry.id)) ??
    configuredDefault
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
  const node = nodes[elevatorId]
  if (node?.type !== 'elevator' || node.disabledLevelIds.includes(levelId)) return
  if (!resolveElevatorLevels(node, nodes).entries.some((entry) => entry.id === levelId)) return
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

  const node = nodes[elevatorId]
  if (
    node?.type !== 'elevator' ||
    !current.currentLevelId ||
    node.disabledLevelIds.includes(current.currentLevelId)
  )
    return
  if (
    !resolveElevatorLevels(node, nodes).entries.some((entry) => entry.id === current.currentLevelId)
  )
    return
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
  const stationaryEntry = entries.find((entry) => entry.id === state.currentLevelId)
  if (
    state.phase === 'idle' &&
    !state.queue.length &&
    !state.requestedStops.length &&
    !state.targetLevelId &&
    state.doorOpen === 0 &&
    stationaryEntry?.baseY === state.carY
  )
    return state
  const available = entries.filter((entry) => !elevator.disabledLevelIds.includes(entry.id))
  const fallback =
    available.find((entry) => entry.id === defaultEntry.id) ?? available[0] ?? defaultEntry
  const currentEntry = entries.find((entry) => entry.id === state.currentLevelId)
  if (!currentEntry) {
    return createElevatorInteractiveState(fallback.id as AnyNodeId, fallback.baseY)
  }
  const canServe = (id: AnyNodeId) => available.some((entry) => entry.id === id)
  const queue = state.queue.filter(canServe)
  const requestedStops = state.requestedStops.filter(canServe)
  if (
    queue.length !== state.queue.length ||
    requestedStops.length !== state.requestedStops.length
  ) {
    state = { ...state, queue, requestedStops }
  }
  if (state.targetLevelId && !canServe(state.targetLevelId)) {
    const destination =
      state.phase === 'moving'
        ? available.reduce<ElevatorLevelEntry | null>(
            (nearest, entry) =>
              !nearest || Math.abs(entry.baseY - state.carY) < Math.abs(nearest.baseY - state.carY)
                ? entry
                : nearest,
            null,
          )
        : null
    state = {
      ...state,
      targetLevelId: (destination?.id as AnyNodeId) ?? null,
      ...(destination
        ? {
            queue: [
              destination.id as AnyNodeId,
              ...state.queue.filter((id) => id !== destination.id),
            ],
          }
        : {}),
    }
    if (state.phase === 'moving' && !destination) {
      return {
        ...createElevatorInteractiveState(currentEntry.id as AnyNodeId, currentEntry.baseY),
        doorOpen: 0,
      }
    }
  }
  if (state.phase !== 'moving' && Math.abs(state.carY - currentEntry.baseY) > EPSILON) {
    state = { ...state, carY: currentEntry.baseY }
  }
  if (
    elevator.disabledLevelIds.includes(currentEntry.id) &&
    (state.phase === 'open' || state.phase === 'opening')
  ) {
    state = { ...state, phase: 'closing', phaseStartedAt: now }
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

const runtimeConfigurations = new WeakMap<
  Record<string, AnyNode>,
  Array<{ node: ElevatorNode; levels: ReturnType<typeof resolveElevatorLevels> }>
>()

function elevatorConfigurations(nodes: Record<string, AnyNode>) {
  let configurations = runtimeConfigurations.get(nodes)
  if (!configurations) {
    configurations = Object.values(nodes)
      .filter((node): node is ElevatorNode => node.type === 'elevator')
      .map((node) => ({ node, levels: resolveElevatorLevels(node, nodes) }))
    runtimeConfigurations.set(nodes, configurations)
  }
  return configurations
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

  for (const { node, levels } of elevatorConfigurations(nodes)) {
    const elevatorId = node.id as AnyNodeId
    const { entries, defaultEntry } = levels
    if (!defaultEntry) {
      if (useInteractive.getState().elevators[elevatorId]) interactive.removeElevator(elevatorId)
      continue
    }

    const state = useInteractive.getState().elevators[elevatorId]
    if (!state) {
      const initialEntry =
        entries.find(
          (entry) => entry.id === defaultEntry.id && !node.disabledLevelIds.includes(entry.id),
        ) ??
        entries.find((entry) => !node.disabledLevelIds.includes(entry.id)) ??
        defaultEntry
      useInteractive
        .getState()
        .initElevator(elevatorId, initialEntry.id as AnyNodeId, initialEntry.baseY)
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
