import type { LiveTransform } from '@pascal-app/core'
import type { ArticraftAssetNode } from './schema'

type RootNodeTransform = Pick<ArticraftAssetNode, 'position' | 'rotation' | 'scale'>
type RootTransformOverride = Partial<RootNodeTransform>

export function resolveArticraftRootTransform(
  node: RootNodeTransform,
  liveTransform?: LiveTransform,
  liveOverride?: RootTransformOverride,
): RootNodeTransform {
  const rawRotation = liveOverride?.rotation ?? node.rotation
  const baseRotation: ArticraftAssetNode['rotation'] =
    typeof rawRotation === 'number' ? [0, rawRotation, 0] : rawRotation

  return {
    position: liveTransform?.position ?? liveOverride?.position ?? node.position,
    rotation:
      liveTransform?.rotation === undefined
        ? baseRotation
        : [baseRotation[0], liveTransform.rotation, baseRotation[2]],
    scale: liveOverride?.scale ?? node.scale,
  }
}
