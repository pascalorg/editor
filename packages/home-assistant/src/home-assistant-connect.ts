import type { ItemNode } from '@pascal-app/core'
import { isHomeAssistantDisplayItem } from './home-assistant-display-items'

export const PASCAL_HA_CONNECT_REQUEST_EVENT = 'pascal:ha-connect-request'

export type PascalHaConnectRequestDetail = {
  itemId: ItemNode['id']
  itemName: ItemNode['asset']['name']
}

export function isHomeAssistantConnectableItem(item: ItemNode | null | undefined) {
  return isHomeAssistantDisplayItem(item)
}

export function requestHomeAssistantConnect(item: ItemNode) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<PascalHaConnectRequestDetail>(PASCAL_HA_CONNECT_REQUEST_EVENT, {
      detail: {
        itemId: item.id,
        itemName: item.asset.name,
      },
    }),
  )
}
