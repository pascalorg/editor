export type SelectionModifierKeys = {
  meta: boolean
  ctrl: boolean
  shift: boolean
  /** Alt alone: select one session-group member without expanding. */
  alt: boolean
}

export function selectionModifiersFromEvent(
  event?: {
    metaKey?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    nativeEvent?: {
      metaKey?: boolean
      ctrlKey?: boolean
      shiftKey?: boolean
      altKey?: boolean
    }
  } | null,
  fallback?: Partial<SelectionModifierKeys>,
): SelectionModifierKeys {
  const fromEvent = (
    key: keyof SelectionModifierKeys,
    eventKey: 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey',
  ) => {
    if (typeof event?.[eventKey] === 'boolean') return event[eventKey]
    if (typeof event?.nativeEvent?.[eventKey] === 'boolean') return event.nativeEvent[eventKey]
    return Boolean(fallback?.[key])
  }

  return {
    meta: fromEvent('meta', 'metaKey'),
    ctrl: fromEvent('ctrl', 'ctrlKey'),
    shift: fromEvent('shift', 'shiftKey'),
    alt: fromEvent('alt', 'altKey'),
  }
}
