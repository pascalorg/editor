import type { ItemNode } from '@pascal-app/core'

export const PASCAL_HA_CONNECT_REQUEST_EVENT = 'pascal:ha-connect-request'

export type PascalHaConnectRequestDetail = {
  itemId: ItemNode['id']
  itemName: ItemNode['asset']['name']
}

function normalizeConnectCandidate(value: string | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

export function isHomeAssistantConnectableItem(item: ItemNode | null | undefined) {
  if (!item) {
    return false
  }

  const { asset } = item
  const candidates = [asset.id, asset.name, asset.src, ...(asset.tags ?? [])]
    .map(normalizeConnectCandidate)
    .filter(Boolean)

  return candidates.some((candidate) => candidate.includes('television') || candidate === 'tv')
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
