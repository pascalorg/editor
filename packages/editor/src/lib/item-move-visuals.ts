import type { ViewerRuntimeItemMoveVisualState } from '@pascal-app/viewer'

export const ITEM_MOVE_VISUAL_METADATA_KEY = 'navigationMoveVisual'

export type ItemMoveVisualState = ViewerRuntimeItemMoveVisualState

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getItemMoveVisualState(metadata: unknown): ItemMoveVisualState | null {
  if (!isMetadataRecord(metadata)) {
    return null
  }

  const value = metadata[ITEM_MOVE_VISUAL_METADATA_KEY]
  if (
    value === 'carried' ||
    value === 'copy-source-pending' ||
    value === 'destination-ghost' ||
    value === 'destination-preview' ||
    value === 'source-pending'
  ) {
    return value
  }

  return null
}

export function setItemMoveVisualState(
  metadata: unknown,
  state: ItemMoveVisualState | null,
): Record<string, unknown> {
  const nextMetadata = isMetadataRecord(metadata) ? { ...metadata } : {}

  if (state) {
    nextMetadata[ITEM_MOVE_VISUAL_METADATA_KEY] = state
    return nextMetadata
  }

  delete nextMetadata[ITEM_MOVE_VISUAL_METADATA_KEY]
  return nextMetadata
}
