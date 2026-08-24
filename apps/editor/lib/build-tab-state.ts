export type RoofFeatureIdentity = {
  id: string
  kind?: string
  roofType?: string
}

export function getActiveRoofFeatureId(
  features: readonly RoofFeatureIdentity[],
  activeTool: string | null | undefined,
  activeRoofType: unknown,
): string | null {
  if (activeTool === 'roof') {
    if (typeof activeRoofType !== 'string' || activeRoofType.length === 0) return null
    return features.find((feature) => feature.roofType === activeRoofType)?.id ?? null
  }

  if (!activeTool) return null
  return features.find((feature) => feature.kind === activeTool)?.id ?? null
}
