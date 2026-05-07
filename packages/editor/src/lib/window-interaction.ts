import {
  type AnyNodeId,
  useInteractive,
  useScene,
  type WindowInteractiveState,
} from '@pascal-app/core'

export const WINDOW_TOGGLE_ANIMATION_MS = 520

type WindowOpenAnimationOptions = {
  persist?: boolean
}

export function isOperableWindowType(windowType: string | undefined) {
  return (
    windowType === 'sliding' ||
    windowType === 'casement' ||
    windowType === 'awning' ||
    windowType === 'hopper' ||
    windowType === 'single-hung' ||
    windowType === 'double-hung' ||
    windowType === 'louvered'
  )
}

function getDisplayedWindowValue(windowId: AnyNodeId, nodeValue: number | undefined) {
  const interactive = useInteractive.getState()
  const runtimeValue = interactive.windows[windowId]?.operationState
  if (runtimeValue !== undefined) return runtimeValue

  const queuedValue = interactive.windowAnimations[windowId]?.from
  if (queuedValue !== undefined) return queuedValue

  return nodeValue ?? 0
}

function startWindowOpenAnimation(
  windowId: AnyNodeId,
  field: keyof WindowInteractiveState,
  from: number,
  to: number,
  options?: WindowOpenAnimationOptions,
) {
  useInteractive.getState().startWindowAnimation(windowId, {
    field,
    from,
    to,
    startedAt: null,
    durationMs: WINDOW_TOGGLE_ANIMATION_MS,
    persist: options?.persist ?? true,
  })
}

export function toggleWindowOpenState(windowId: AnyNodeId, options?: WindowOpenAnimationOptions) {
  const node = useScene.getState().nodes[windowId]
  if (
    node?.type !== 'window' ||
    node.openingKind === 'opening' ||
    !isOperableWindowType(node.windowType)
  ) {
    return
  }

  const currentOpenAmount = getDisplayedWindowValue(windowId, node.operationState)
  startWindowOpenAnimation(
    windowId,
    'operationState',
    currentOpenAmount,
    currentOpenAmount >= 0.5 ? 0 : 1,
    options,
  )
}

export function closeWindowOpenState(windowId: AnyNodeId, options?: WindowOpenAnimationOptions) {
  const node = useScene.getState().nodes[windowId]
  if (
    node?.type !== 'window' ||
    node.openingKind === 'opening' ||
    !isOperableWindowType(node.windowType)
  ) {
    return
  }

  const currentOpenAmount = getDisplayedWindowValue(windowId, node.operationState)
  startWindowOpenAnimation(windowId, 'operationState', currentOpenAmount, 0, options)
}
