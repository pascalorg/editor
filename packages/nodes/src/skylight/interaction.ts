import {
  type AnyNodeId,
  type SkylightInteractiveState,
  type SkylightNode,
  useInteractive,
  useScene,
} from '@pascal-app/core'

export const SKYLIGHT_TOGGLE_ANIMATION_MS = 520

type SkylightOpenAnimationOptions = {
  persist?: boolean
}

export function isOperableSkylightType(skylightType: string | undefined) {
  return skylightType === 'opening' || skylightType === 'sliding'
}

export function isOperableSkylightNode(node: SkylightNode): boolean {
  return isOperableSkylightType(node.skylightType)
}

function getDisplayedSkylightValue(skylightId: AnyNodeId, nodeValue: number | undefined) {
  const interactive = useInteractive.getState()
  const runtimeValue = interactive.skylights[skylightId]?.operationState
  if (runtimeValue !== undefined) return runtimeValue

  const queuedValue = interactive.skylightAnimations[skylightId]?.from
  if (queuedValue !== undefined) return queuedValue

  return nodeValue ?? 0
}

function startSkylightOpenAnimation(
  skylightId: AnyNodeId,
  field: keyof SkylightInteractiveState,
  from: number,
  to: number,
  options?: SkylightOpenAnimationOptions,
) {
  useInteractive.getState().startSkylightAnimation(skylightId, {
    field,
    from,
    to,
    startedAt: null,
    durationMs: SKYLIGHT_TOGGLE_ANIMATION_MS,
    persist: options?.persist ?? true,
  })
}

export function toggleSkylightOpenState(
  skylightId: AnyNodeId,
  options?: SkylightOpenAnimationOptions,
) {
  const node = useScene.getState().nodes[skylightId]
  if (node?.type !== 'skylight' || !isOperableSkylightType(node.skylightType)) return

  const currentOpenAmount = getDisplayedSkylightValue(skylightId, node.operationState)
  startSkylightOpenAnimation(
    skylightId,
    'operationState',
    currentOpenAmount,
    currentOpenAmount >= 0.5 ? 0 : 1,
    options,
  )
}

export function closeSkylightOpenState(
  skylightId: AnyNodeId,
  options?: SkylightOpenAnimationOptions,
) {
  const node = useScene.getState().nodes[skylightId]
  if (node?.type !== 'skylight' || !isOperableSkylightType(node.skylightType)) return

  const currentOpenAmount = getDisplayedSkylightValue(skylightId, node.operationState)
  startSkylightOpenAnimation(skylightId, 'operationState', currentOpenAmount, 0, options)
}
