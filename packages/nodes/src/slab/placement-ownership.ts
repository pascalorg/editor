import type { VisibleScene } from '@pascal-app/editor'

export type SlabCompletionTrigger = 'grid' | 'keyboard'

export function shouldRegistryCommitSlab(
  scene: VisibleScene | null,
  trigger: SlabCompletionTrigger,
): boolean {
  return trigger === 'keyboard' || scene !== '2d'
}
