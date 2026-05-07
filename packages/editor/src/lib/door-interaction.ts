import {
  type AnyNodeId,
  type DoorInteractiveState,
  isOperationDoorType,
  useInteractive,
  useScene,
} from '@pascal-app/core'

export const DOOR_SWING_OPEN_ANGLE = Math.PI / 2
export const DOOR_TOGGLE_ANIMATION_MS = 520

export { isOperationDoorType }

type DoorOpenAnimationOptions = {
  persist?: boolean
}

function getDisplayedDoorValue(
  doorId: AnyNodeId,
  field: keyof DoorInteractiveState,
  nodeValue: number | undefined,
) {
  const interactive = useInteractive.getState()
  const runtimeValue = interactive.doors[doorId]?.[field]
  if (runtimeValue !== undefined) return runtimeValue

  const queuedValue = interactive.doorAnimations[doorId]?.from
  if (queuedValue !== undefined) return queuedValue

  return nodeValue ?? 0
}

function startDoorOpenAnimation(
  doorId: AnyNodeId,
  field: keyof DoorInteractiveState,
  from: number,
  to: number,
  options?: DoorOpenAnimationOptions,
) {
  useInteractive.getState().startDoorAnimation(doorId, {
    field,
    from,
    to,
    startedAt: null,
    durationMs: DOOR_TOGGLE_ANIMATION_MS,
    persist: options?.persist ?? true,
  })
}

export function toggleDoorOpenState(doorId: AnyNodeId, options?: DoorOpenAnimationOptions) {
  const node = useScene.getState().nodes[doorId]
  if (node?.type !== 'door' || node.openingKind === 'opening') return

  if (isOperationDoorType(node.doorType)) {
    const currentOpenAmount = getDisplayedDoorValue(doorId, 'operationState', node.operationState)
    startDoorOpenAnimation(
      doorId,
      'operationState',
      currentOpenAmount,
      currentOpenAmount >= 0.5 ? 0 : 1,
      options,
    )
    return
  }

  const currentSwingAngle = getDisplayedDoorValue(doorId, 'swingAngle', node.swingAngle)
  startDoorOpenAnimation(
    doorId,
    'swingAngle',
    currentSwingAngle,
    currentSwingAngle >= DOOR_SWING_OPEN_ANGLE / 2 ? 0 : DOOR_SWING_OPEN_ANGLE,
    options,
  )
}

export function closeDoorOpenState(doorId: AnyNodeId, options?: DoorOpenAnimationOptions) {
  const node = useScene.getState().nodes[doorId]
  if (node?.type !== 'door' || node.openingKind === 'opening') return

  if (isOperationDoorType(node.doorType)) {
    const currentOpenAmount = getDisplayedDoorValue(doorId, 'operationState', node.operationState)
    startDoorOpenAnimation(doorId, 'operationState', currentOpenAmount, 0, options)
    return
  }

  const currentSwingAngle = getDisplayedDoorValue(doorId, 'swingAngle', node.swingAngle)
  startDoorOpenAnimation(doorId, 'swingAngle', currentSwingAngle, 0, options)
}
