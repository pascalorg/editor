export type RoofFeatureIdentity = {
  id: string
  kind?: string
}

export function getActiveRoofFeatureId(
  features: readonly RoofFeatureIdentity[],
  activeTool: string | null | undefined,
): string | null {
  if (!activeTool) return null
  return features.find((feature) => feature.kind === activeTool)?.id ?? null
}
