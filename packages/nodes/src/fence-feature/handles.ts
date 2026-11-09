import {
  type AnyNodeId,
  canPlaceFenceFeature,
  type FenceFeatureNode,
  type FenceNode,
  fenceFeatureData,
  fenceWithFeatures,
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  type HandleDescriptor,
  projectPointToFence,
  type SceneApi,
} from '@pascal-app/core'
import { fenceBaseElevation } from '../fence/definition'
import { getFenceFeatureDimensions } from '../fence/geometry-parts'

export function featureHost(node: FenceFeatureNode, scene: SceneApi): FenceNode | undefined {
  const parent = node.parentId ? scene.get(node.parentId as AnyNodeId) : undefined
  return parent?.type === 'fence' ? parent : undefined
}
export function featurePatch(
  node: FenceFeatureNode,
  patch: Partial<FenceFeatureNode>,
  scene: SceneApi,
): Partial<FenceFeatureNode> {
  const host = featureHost(node, scene)
  if (!host) return {}
  const fence = fenceWithFeatures(
    host,
    (host.children ?? [])
      .map((id) => scene.get(id as AnyNodeId))
      .filter((n): n is NonNullable<typeof n> => !!n),
  )
  return canPlaceFenceFeature(fence, fenceFeatureData({ ...node, ...patch } as FenceFeatureNode))
    ? patch
    : {}
}
export function fenceFeatureHandles(
  node: FenceFeatureNode,
  scene?: SceneApi,
): HandleDescriptor<FenceFeatureNode>[] {
  if (!scene) return []
  const host = featureHost(node, scene)
  if (!host) return []
  const frame = (n: FenceFeatureNode) =>
    getFenceCenterlineFrameAt(host, n.center / Math.max(getFenceCenterlineLength(host), 0.001))
  const dimensions = (n: FenceFeatureNode) => getFenceFeatureDimensions(host, fenceFeatureData(n))
  const height = (n: FenceFeatureNode) => dimensions(n).height
  const base = (n: FenceFeatureNode) => {
    const p = frame(n).point
    return fenceBaseElevation(host, scene, [p.x, p.y])
  }
  const handles: HandleDescriptor<FenceFeatureNode>[] = [
    {
      kind: 'translate',
      placement: {
        position: (n) => {
          const p = frame(n).point
          return [p.x, base(n) + height(n) / 2, p.y]
        },
      },
      apply: (n, point, api) =>
        featurePatch(n, { center: projectPointToFence(host, [point[0], point[2]]).center }, api),
    },
    {
      kind: 'linear-resize',
      axis: 'x',
      dragAxis: (n) => {
        const tangent = frame(n).tangent
        return [tangent.x, 0, tangent.y]
      },
      anchor: 'center',
      min: 0.35,
      currentValue: (n) => n.width,
      apply: (n, width, api) => featurePatch(n, { width }, api),
      placement: {
        position: (n) => {
          const f = frame(n)
          const d = n.width / 2 + 0.2
          return [f.point.x + f.tangent.x * d, base(n) + 0.5, f.point.y + f.tangent.y * d]
        },
        rotationY: (n) => -Math.atan2(frame(n).tangent.y, frame(n).tangent.x),
      },
    },
  ]
  handles.push({
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: 0.3,
    max: 6,
    currentValue: height,
    apply: (n, value) => ({
      height: value,
      matchFenceHeight: false,
      ...(n.type === 'fence-gate' ? { clearance: dimensions(n).bottom } : {}),
    }),
    placement: {
      position: (n) => {
        const p = frame(n).point
        return [p.x, base(n) + height(n) + dimensions(n).bottom + 0.35, p.y]
      },
    },
  })
  return handles
}
