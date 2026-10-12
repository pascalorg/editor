import {
  createSceneApi,
  type HandleDescriptor,
  planSlabFeaturePlacement,
  type SceneApi,
  type SlabFeatureNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { clearSlabFeatureEditPreview, showSlabFeatureEditPreview } from './preview'

export function slabFeatureEdit(
  scene: SceneApi,
  node: SlabFeatureNode,
  patch: Partial<SlabFeatureNode>,
) {
  planSlabFeaturePlacement(scene.nodes(), { ...node, ...patch })
  return patch
}
export function slabFeatureHandles(node: SlabFeatureNode): HandleDescriptor<SlabFeatureNode>[] {
  const commit = (n: SlabFeatureNode, patch: Partial<SlabFeatureNode>, scene: SceneApi) => {
    const latest = scene.get(n.id)
    if (latest?.type !== 'slab-feature') return
    try {
      scene.update(n.id, slabFeatureEdit(scene, latest, patch))
    } catch {
      /* Host changed during the gesture. */
    }
  }
  return (['width', 'length', 'depth'] as const).flatMap((key) =>
    (key === 'depth' ? [1] : [1, -1]).map(
      (sign): HandleDescriptor<SlabFeatureNode> => ({
        kind: 'linear-resize',
        axis: key === 'width' ? 'x' : key === 'length' ? 'z' : 'y',
        anchor: sign === 1 ? 'min' : 'max',
        direction: sign as 1 | -1,
        min: Number.MIN_VALUE,
        gridSnap: true,
        dragAxis: key === 'depth' ? () => [0, node.mode === 'niche' ? -1 : 1, 0] : undefined,
        currentValue: (n) => n[key],
        placement: {
          position: (n) =>
            key === 'width'
              ? [(sign * n.width) / 2, 0, 0]
              : key === 'length'
                ? [0, 0, (sign * n.length) / 2]
                : [0, n.mode === 'bump' ? n.depth : -n.depth, 0],
        },
        apply(n, value, scene) {
          const patch =
            key === 'width'
              ? { width: value, x: n.x + (sign * (value - n.width)) / 2 }
              : key === 'length'
                ? { length: value, z: n.z + (sign * (value - n.length)) / 2 }
                : { depth: value }
          try {
            return slabFeatureEdit(scene, n, patch)
          } catch {
            const live = useLiveNodeOverrides.getState().get(n.id)
            return Object.fromEntries(
              Object.keys(patch).map((key) => [
                key,
                live?.[key] ?? n[key as keyof SlabFeatureNode],
              ]),
            )
          }
        },
        commit,
        onDrag: showSlabFeatureEditPreview,
        onDragEnd: (n) => clearSlabFeatureEditPreview(n.id),
      }),
    ),
  )
}
export function createSlabFeaturePropertyPreview(id: SlabFeatureNode['id']) {
  let pending: Partial<SlabFeatureNode> = {}
  const clear = () => {
    useLiveNodeOverrides.getState().clearFields(id, Object.keys(pending))
    pending = {}
    clearSlabFeatureEditPreview(id)
  }
  return {
    preview(patch: Partial<SlabFeatureNode>) {
      const node = useScene.getState().nodes[id]
      if (node?.type !== 'slab-feature') return
      const scene = createSceneApi(useScene)
      const next = { ...pending, ...patch }
      slabFeatureEdit(scene, node, next)
      pending = next
      useLiveNodeOverrides.getState().set(id, patch)
      showSlabFeatureEditPreview({ ...node, ...next }, scene)
    },
    commit(patch: Partial<SlabFeatureNode> = {}) {
      try {
        const scene = createSceneApi(useScene),
          node = scene.get(id)
        if (node?.type === 'slab-feature')
          scene.update(id, slabFeatureEdit(scene, node, { ...pending, ...patch }))
      } finally {
        clear()
      }
    },
    cancel: clear,
  }
}
