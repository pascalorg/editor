export function canRegisterItemLight(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.isNew !== true
}
