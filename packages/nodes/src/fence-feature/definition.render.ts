import { FenceGateNode, FenceOpeningNode } from '@pascal-app/core'

import { AnimationClip, type Object3D, QuaternionKeyframeTrack } from 'three'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildFenceFeatureFloorplan } from './floorplan'
import { buildFenceFeatureGeometry } from './geometry'

function bakeFenceGateClip(id: string, object: Object3D): AnimationClip | null {
  const tracks: QuaternionKeyframeTrack[] = []
  object.traverse((part) => {
    const marker = part.userData.pascalFenceGateLeaf as { openRotationY?: number } | undefined
    if (typeof marker?.openRotationY !== 'number' || Math.abs(marker.openRotationY) < 1e-5) return
    part.rotation.y = 0
    const closed = part.quaternion.clone()
    part.rotation.y = marker.openRotationY
    const open = part.quaternion.clone()
    part.rotation.y = 0
    tracks.push(
      new QuaternionKeyframeTrack(
        `${part.uuid}.quaternion`,
        [0, 1],
        [...closed.toArray(), ...open.toArray()],
      ),
    )
  })
  if (tracks.length === 0) return null
  const clip = new AnimationClip(`${id}: open`, 1, tracks)
  clip.userData = { loop: false }
  return clip
}

export const fenceGateRenderDefinition: NodeRenderDefinition<
  typeof FenceGateNode | typeof FenceOpeningNode
> & { kind: 'fence-gate' } = {
  schemaVersion: 1,
  category: 'structure' as const,
  capabilities: {
    exterior: true,
    selectable: { hitVolume: 'bbox' as const },
    deletable: true,
  },
  geometry: buildFenceFeatureGeometry,
  kind: 'fence-gate',
  schema: FenceGateNode,
  exportAnimation: ({ node, object }) =>
    node.type === 'fence-gate' ? bakeFenceGateClip(node.id, object) : null,
  defaults: () => {
    const { id, type, ...rest } = FenceGateNode.parse({})
    return rest
  },
  floorplan: buildFenceFeatureFloorplan,
  presentation: {
    label: 'Gate',
    description: 'A gate hosted by a fence.',
    icon: { kind: 'url', src: '/icons/fence.webp' },
    paletteSection: 'structure',
    hidden: true,
  },
}

export const fenceOpeningRenderDefinition: NodeRenderDefinition<
  typeof FenceGateNode | typeof FenceOpeningNode
> & { kind: 'fence-opening' } = {
  schemaVersion: 1,
  category: 'structure' as const,
  capabilities: {
    exterior: true,
    selectable: { hitVolume: 'bbox' as const },
    deletable: true,
  },
  geometry: buildFenceFeatureGeometry,
  kind: 'fence-opening',
  schema: FenceOpeningNode,
  defaults: () => {
    const { id, type, ...rest } = FenceOpeningNode.parse({})
    return rest
  },
  floorplan: buildFenceFeatureFloorplan,
  presentation: {
    label: 'Open Passage',
    description: 'An intentional opening in a fence.',
    icon: { kind: 'url', src: '/icons/door.webp' },
    paletteSection: 'structure',
    hidden: true,
  },
}
