const TRANSIENT_METADATA_KEYS = new Set(['robotCopySourceId'])

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
