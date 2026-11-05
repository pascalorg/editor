import type { MechanismCapability } from '@pascal-app/core'
import {
  closeWindowOpenState,
  getDisplayedWindowShutterValue,
  getDisplayedWindowValue,
  isOperableWindowType,
  openWindowOpenState,
  setWindowShuttersOpenState,
} from '@pascal-app/editor'
import { scriptedOpening } from '../shared/scripted-opening'

/** A window's sash: Open and Close preview it without touching the saved open state. */
export const windowMechanism: MechanismCapability = {
  parts: [
    {
      id: 'shutters',
      label: 'Shutters',
      icon: 'shutters',
      verb: 'open',
      has: (node) =>
        node.type === 'window' &&
        !node.source &&
        ((Boolean(node.shutters) && node.shutters !== 'none') ||
          node.rollerShutter === 'box' ||
          node.rollerShutter === 'concealed'),
      isOn: (node, state) =>
        node.type === 'window' &&
        ((Boolean(node.shutters) &&
          node.shutters !== 'none' &&
          getDisplayedWindowShutterValue(node.id, 'shutterOpen', node.shutterOpen, state) > 0) ||
          ((node.rollerShutter === 'box' || node.rollerShutter === 'concealed') &&
            getDisplayedWindowShutterValue(
              node.id,
              'rollerShutterOpen',
              node.rollerShutterOpen,
              state,
            ) > 0)),
      set: (node, on) => setWindowShuttersOpenState(node.id, on, { persist: false }),
    },
  ],
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
