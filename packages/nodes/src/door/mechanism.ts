import { isOperationDoorType, type MechanismCapability } from '@pascal-app/core'
import { closeDoorOpenState, getDisplayedDoorValue, openDoorOpenState } from '@pascal-app/editor'

/** A door's leaf: Play opens it and Stop closes it, without touching the saved open state. */
export const doorMechanism: MechanismCapability = {
  verb: 'open',
  icon: 'door',
  has: (node) => node.type === 'door' && node.openingKind !== 'opening',
  isOn: (node) => {
    if (node.type !== 'door') return false
    return isOperationDoorType(node.doorType)
      ? getDisplayedDoorValue(node.id, 'operationState', node.operationState) > 0
      : getDisplayedDoorValue(node.id, 'swingAngle', node.swingAngle) > 0
  },
  set: (node, on) => (on ? openDoorOpenState : closeDoorOpenState)(node.id, { persist: false }),
}
