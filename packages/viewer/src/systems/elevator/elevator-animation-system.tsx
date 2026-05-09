import {
  type AnyNodeId,
  type ElevatorNode,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { resolveElevatorLevels } from './elevator-utils'

const EPSILON = 0.001

function moveToward(current: number, target: number, maxDelta: number) {
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}

export function ElevatorAnimationSystem() {
  useFrame(({ clock }, delta) => {
    const interactive = useInteractive.getState()
    const nodes = useScene.getState().nodes
    const now = clock.getElapsedTime() * 1000

    for (const elevatorId of sceneRegistry.byType.elevator) {
      const typedElevatorId = elevatorId as AnyNodeId
      const node = nodes[typedElevatorId]
      if (node?.type !== 'elevator') {
        interactive.removeElevator(typedElevatorId)
        continue
      }

      const elevator = node as ElevatorNode
      const { entries, defaultEntry } = resolveElevatorLevels(elevator, nodes)
      if (!defaultEntry) continue

      const state = interactive.elevators[typedElevatorId]
      if (!state) {
        interactive.initElevator(typedElevatorId, defaultEntry.id as AnyNodeId, defaultEntry.baseY)
        continue
      }

      const currentEntry =
        entries.find((entry) => entry.id === state.currentLevelId) ?? defaultEntry
      if (currentEntry.id !== state.currentLevelId) {
        interactive.setElevatorState(typedElevatorId, {
          currentLevelId: currentEntry.id as AnyNodeId,
          carY: currentEntry.baseY,
          targetLevelId: null,
          phase: 'idle',
          phaseStartedAt: null,
          queue: [],
          doorOpen: 0,
        })
        continue
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
              interactive.setElevatorState(typedElevatorId, {
                doorOpen: Math.max(0, state.doorOpen - doorStep),
              })
            }
            break
          }

          interactive.setElevatorState(typedElevatorId, {
            targetLevelId: nextLevelId,
            phase:
              state.doorOpen > EPSILON
                ? 'closing'
                : nextLevelId === state.currentLevelId
                  ? 'opening'
                  : 'moving',
            phaseStartedAt: now,
          })
          break
        }

        case 'closing': {
          const doorOpen = Math.max(0, state.doorOpen - doorStep)
          interactive.setElevatorState(typedElevatorId, {
            doorOpen,
            phase: doorOpen <= EPSILON ? (state.targetLevelId ? 'moving' : 'idle') : 'closing',
            phaseStartedAt: doorOpen <= EPSILON ? now : state.phaseStartedAt,
          })
          break
        }

        case 'moving': {
          if (!targetEntry) {
            interactive.setElevatorState(typedElevatorId, {
              targetLevelId: null,
              phase: 'idle',
              queue: [],
            })
            break
          }

          const speed = Math.max(elevator.speed ?? 2.2, 0.1)
          const nextY = moveToward(state.carY, targetEntry.baseY, speed * delta)
          const arrived = Math.abs(nextY - targetEntry.baseY) <= EPSILON
          interactive.setElevatorState(typedElevatorId, {
            carY: nextY,
            currentLevelId: arrived ? (targetEntry.id as AnyNodeId) : state.currentLevelId,
            phase: arrived ? 'opening' : 'moving',
            phaseStartedAt: arrived ? now : state.phaseStartedAt,
          })
          break
        }

        case 'opening': {
          const doorOpen = Math.min(1, state.doorOpen + doorStep)
          interactive.setElevatorState(typedElevatorId, {
            doorOpen,
            phase: doorOpen >= 1 - EPSILON ? 'open' : 'opening',
            phaseStartedAt: doorOpen >= 1 - EPSILON ? now : state.phaseStartedAt,
            targetLevelId: doorOpen >= 1 - EPSILON ? null : state.targetLevelId,
            queue:
              doorOpen >= 1 - EPSILON && state.queue[0] === state.currentLevelId
                ? state.queue.slice(1)
                : state.queue,
          })
          break
        }

        case 'open': {
          const elapsed = now - (state.phaseStartedAt ?? now)
          if (elapsed < Math.max(elevator.dwellMs ?? 1400, 0)) break

          interactive.setElevatorState(typedElevatorId, {
            phase: 'closing',
            phaseStartedAt: now,
            targetLevelId: state.queue[0] ?? null,
          })
          break
        }
      }
    }
  }, 2)

  return null
}
