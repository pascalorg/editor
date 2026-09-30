import type { MechanismCapability } from '@pascal-app/core'
import {
  closeWindowOpenState,
  getDisplayedWindowValue,
  isOperableWindowType,
  openWindowOpenState,
} from '@pascal-app/editor'

/** A window's sash: Open and Close preview it without touching the saved open state. */
export const windowMechanism: MechanismCapability = {
  verb: 'open',
  icon: 'window',
  has: (node) =>
    node.type === 'window' &&
    node.openingKind !== 'opening' &&
    isOperableWindowType(node.windowType),
  isOn: (node) =>
    node.type === 'window' && getDisplayedWindowValue(node.id, node.operationState) > 0,
  set: (node, on) => (on ? openWindowOpenState : closeWindowOpenState)(node.id, { persist: false }),
}
