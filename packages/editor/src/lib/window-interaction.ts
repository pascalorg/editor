import {
  type AnyNodeId,
  type InteractiveState,
  useInteractive,
  useScene,
  type WindowInteractiveState,
} from '@pascal-app/core'

export const WINDOW_TOGGLE_ANIMATION_MS = 520

export type WindowOpenAnimationOptions = {
  persist?: boolean
}

export function isOperableWindowType(windowType: string | undefined) {
  return (
    windowType === 'sliding' ||
    windowType === 'casement' ||
    windowType === 'awning' ||
    windowType === 'hopper' ||
    windowType === 'tilt-turn' ||
    windowType === 'single-hung' ||
    windowType === 'double-hung' ||
    windowType === 'louvered'
  )
}

export function getDisplayedWindowValue(
  windowId: AnyNodeId,
  nodeValue: number | undefined,
  field: keyof WindowInteractiveState = 'operationState',
  interactive: InteractiveState = useInteractive.getState(),
) {
  const runtimeValue = interactive.windows[windowId]?.[field]
  if (runtimeValue !== undefined) return runtimeValue

  const queuedValue = interactive.windowAnimations[windowId]?.[field]?.from
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

export function openWindowOpenState(windowId: AnyNodeId, options?: WindowOpenAnimationOptions) {
  const node = useScene.getState().nodes[windowId]
  if (
    node?.type !== 'window' ||
    node.openingKind === 'opening' ||
    !isOperableWindowType(node.windowType)
  ) {
    return
  }

  const currentOpenAmount = getDisplayedWindowValue(windowId, node.operationState)
  startWindowOpenAnimation(windowId, 'operationState', currentOpenAmount, 1, options)
}

export type WindowShutterField = 'shutterOpen' | 'rollerShutterOpen'

export function getDisplayedWindowShutterValue(
  windowId: AnyNodeId,
  field: WindowShutterField,
  nodeValue: number | undefined,
  state: InteractiveState = useInteractive.getState(),
): number {
  return getDisplayedWindowValue(windowId, nodeValue ?? 1, field, state)
}

/** Preview both shutter styles together, independently of the sash. */
export function setWindowShuttersOpenState(
  windowId: AnyNodeId,
  on: boolean,
  options?: WindowOpenAnimationOptions,
): void {
  const node = useScene.getState().nodes[windowId]
  if (node?.type !== 'window' || node.source) return
  const fields: WindowShutterField[] = []
  if (node.shutters && node.shutters !== 'none') fields.push('shutterOpen')
  if (node.rollerShutter === 'box' || node.rollerShutter === 'concealed')
    fields.push('rollerShutterOpen')
  if (!fields.length) return
  useInteractive.getState().setMechanismPart(windowId, 'shutters', on)
  for (const field of fields) {
    startWindowOpenAnimation(
      windowId,
      field,
      getDisplayedWindowShutterValue(windowId, field, node[field]),
      on ? 1 : 0,
      options,
    )
  }
}
