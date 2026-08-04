export type SlabCompletionTrigger = 'grid' | 'keyboard'

export function shouldRegistryCommitSlab(
  viewMode: '2d' | '3d' | 'split',
  trigger: SlabCompletionTrigger,
): boolean {
  return trigger === 'keyboard' || viewMode !== '2d'
}
