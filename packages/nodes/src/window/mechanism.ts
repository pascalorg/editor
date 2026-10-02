import type { MechanismCapability } from '@pascal-app/core'
import {
  closeWindowOpenState,
  getDisplayedWindowValue,
  isOperableWindowType,
  openWindowOpenState,
} from '@pascal-app/editor'
import { scriptedOpening } from '../shared/scripted-opening'

/** A window's sash: Open and Close preview it without touching the saved open state. */
export const windowMechanism: MechanismCapability = {
  verb: 'open',
  icon: 'window',
  has: (node) =>
    node.type === 'window' &&
    (node.source
      ? scriptedOpening.has(node)
      : node.openingKind !== 'opening' && isOperableWindowType(node.windowType)),
  isOn: (node) =>
    node.type === 'window' &&
    (node.source
      ? scriptedOpening.isOn(node)
      : getDisplayedWindowValue(node.id, node.operationState) > 0),
  set: (node, on) => {
    if (node.type === 'window' && node.source) return scriptedOpening.set(node, on)
    return (on ? openWindowOpenState : closeWindowOpenState)(node.id, { persist: false })
  },
}
