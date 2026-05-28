import type { ItemNode } from '@pascal-app/core'

export type HomeAssistantDisplayItemKind = 'computer' | 'television'

const normalizeDisplayCandidate = (value: string | null | undefined) =>
  value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') ?? ''

const matchesTelevisionCandidate = (candidate: string) =>
  candidate === 'tv' || candidate.includes('television') || candidate.includes('flatscreentv')

const matchesComputerDisplayCandidate = (candidate: string) =>
  candidate.includes('computer') ||
  candidate.includes('desktop') ||
  candidate.includes('monitor') ||
  candidate.includes('workstation')

export function getHomeAssistantDisplayItemKind(
  item: ItemNode | null | undefined,
): HomeAssistantDisplayItemKind | null {
  if (!item) {
    return null
  }

  const candidates = [item.asset.id, item.asset.name, item.asset.src, ...(item.asset.tags ?? [])]
    .map(normalizeDisplayCandidate)
    .filter(Boolean)

  if (candidates.some(matchesComputerDisplayCandidate)) {
    return 'computer'
  }
  if (candidates.some(matchesTelevisionCandidate)) {
    return 'television'
  }

  return null
}

export function isHomeAssistantDisplayItem(item: ItemNode | null | undefined) {
  return getHomeAssistantDisplayItemKind(item) !== null
}

export function isHomeAssistantDisplayText(value: string | null | undefined) {
  const candidate = normalizeDisplayCandidate(value)
  return matchesComputerDisplayCandidate(candidate) || matchesTelevisionCandidate(candidate)
}
