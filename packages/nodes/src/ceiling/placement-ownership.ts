export function shouldRegistryCommitCeiling(viewMode: '2d' | '3d' | 'split'): boolean {
  return viewMode !== '2d'
}
