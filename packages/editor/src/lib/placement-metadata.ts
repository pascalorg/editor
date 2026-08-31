export function getPlacementMetadataRecord(metadata: unknown): Record<string, unknown> {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return {}
  }

  return metadata as Record<string, unknown>
}

export function addFreshPlacementMetadata(metadata: unknown): Record<string, unknown> {
  return {
    ...getPlacementMetadataRecord(metadata),
    isNew: true,
  }
}

export function isFreshPlacementMetadata(metadata: unknown): boolean {
  return getPlacementMetadataRecord(metadata).isNew === true
}

export function stripPlacementMetadataFlags(metadata: unknown): unknown {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return metadata
  }

  const nextMeta = { ...(metadata as Record<string, unknown>) }
  delete nextMeta.isNew
  delete nextMeta.isTransient
  return nextMeta
}
