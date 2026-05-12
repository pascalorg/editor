import { ITEM_MOVE_VISUAL_METADATA_KEY } from './item-move-visuals'

const TRANSIENT_METADATA_KEYS = new Set([
  ITEM_MOVE_VISUAL_METADATA_KEY,
  'isTransient',
  'robotCopySourceId',
])

export function stripTransientMetadata<T>(metadata: T): T {
  if (!metadata || typeof metadata !== 'object') {
    return metadata
  }

  const cleaned = { ...(metadata as Record<string, unknown>) }
  for (const key of TRANSIENT_METADATA_KEYS) {
    delete cleaned[key]
  }
  return cleaned as T
}
