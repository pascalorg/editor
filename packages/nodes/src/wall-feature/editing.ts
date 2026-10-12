import {
  type AnyNode,
  createSceneApi,
  type HandleDescriptor,
  planWallFeaturePlacement,
  resolveWallFeaturePlacement,
  type SceneApi,
  useLiveNodeOverrides,
  useScene,
  type WallFeatureNode,
} from '@pascal-app/core'
import { clearWallFeatureEditPreview, showWallFeatureEditPreview } from './preview'
import { deferWallFeatureGeometry } from './runtime'

export function wallFeatureEdit(
  nodes: Readonly<Record<string, AnyNode>>,
  node: WallFeatureNode,
  patch: Partial<WallFeatureNode>,
): Partial<WallFeatureNode> {
  planWallFeaturePlacement(nodes, { ...node, ...patch })
  return patch
}

export function wallFeatureHandles(
  node: WallFeatureNode,
  sceneApi?: SceneApi,
): HandleDescriptor<WallFeatureNode>[] {
  const apply = (current: WallFeatureNode, patch: Partial<WallFeatureNode>, scene: SceneApi) => {
    try {
      return wallFeatureEdit(scene.nodes(), current, patch)
    } catch {
      const live = useLiveNodeOverrides.getState().get(current.id)
      return Object.fromEntries(
        Object.keys(patch).map((key) => [
          key,
          live?.[key] ?? current[key as keyof WallFeatureNode],
        ]),
      )
    }
  }
  const commit = (current: WallFeatureNode, patch: Partial<WallFeatureNode>, scene: SceneApi) => {
    const latest = scene.get(current.id)
    if (latest?.type !== 'wall-feature') return
    try {
      scene.update(current.id, wallFeatureEdit(scene.nodes(), latest, patch))
    } catch {
      /* The host may have changed during the gesture; leave the document intact. */
    }
  }
  if (!sceneApi) return []
  let face: 'a' | 'b'
  try {
    face = resolveWallFeaturePlacement(sceneApi.nodes(), node).face
  } catch {
    return []
  }
  const side = face === 'b' ? -1 : 1
  return [
    ...(['width', 'height', 'depth'] as const).map(
      (key): HandleDescriptor<WallFeatureNode> => ({
        kind: 'linear-resize',
        commit,
        onDrag: (n, scene) => {
          deferWallFeatureGeometry(n.id, true)
          showWallFeatureEditPreview(n, scene)
        },
        onDragEnd: (n) => {
          deferWallFeatureGeometry(n.id, false)
          clearWallFeatureEditPreview(n.id)
        },
        axis: key === 'width' ? 'x' : key === 'height' ? 'y' : 'z',
        anchor: 'min',
        min: Number.MIN_VALUE,
        gridSnap: true,
        faceNormal: key === 'width',
        dragAxis:
          key === 'depth' ? () => [0, 0, side * (node.mode === 'niche' ? -1 : 1)] : undefined,
        currentValue: (n) => n[key],
        apply: (n, value, scene) =>
          apply(
            n,
            key === 'width' ? { width: value, u: n.u + (value - n.width) / 2 } : { [key]: value },
            scene,
          ),
        placement: {
          position: (n) =>
            key === 'width'
              ? [n.width, n.height / 2, 0]
              : key === 'height'
                ? [n.width / 2, n.height, 0]
                : [n.width / 2, n.height / 2, 0],
        },
      }),
    ),
    ...(['width', 'height'] as const).map(
      (key): HandleDescriptor<WallFeatureNode> => ({
        kind: 'linear-resize',
        commit,
        onDrag: (n, scene) => {
          deferWallFeatureGeometry(n.id, true)
          showWallFeatureEditPreview(n, scene)
        },
        onDragEnd: (n) => {
          deferWallFeatureGeometry(n.id, false)
          clearWallFeatureEditPreview(n.id)
        },
        axis: key === 'width' ? 'x' : 'y',
        anchor: 'max',
        direction: -1,
        min: Number.MIN_VALUE,
        gridSnap: true,
        faceNormal: key === 'width',
        currentValue: (n) => n[key],
        apply: (n, value, scene) =>
          apply(
            n,
            key === 'width'
              ? { width: value, u: n.u - (value - n.width) / 2 }
              : { height: value, bottom: n.bottom - (value - n.height) },
            scene,
          ),
        placement: {
          position: (n) => (key === 'width' ? [0, n.height / 2, 0] : [n.width / 2, 0, 0]),
        },
      }),
    ),
  ]
}

export function createWallFeaturePropertyPreview(id: WallFeatureNode['id']) {
  let pending: Partial<WallFeatureNode> = {}
  const clear = () => {
    useLiveNodeOverrides.getState().clearFields(id, Object.keys(pending))
    pending = {}
    clearWallFeatureEditPreview(id)
    deferWallFeatureGeometry(id, false)
  }
  return {
    preview(patch: Partial<WallFeatureNode>) {
      const node = useScene.getState().nodes[id]
      if (node?.type !== 'wall-feature') return
      const next = { ...pending, ...patch }
      wallFeatureEdit(useScene.getState().nodes, node, next)
      deferWallFeatureGeometry(id, true)
      pending = next
      useLiveNodeOverrides.getState().set(id, patch)
      showWallFeatureEditPreview({ ...node, ...next }, createSceneApi(useScene))
    },
    commit(patch: Partial<WallFeatureNode> = {}) {
      const node = useScene.getState().nodes[id]
      try {
        if (node?.type === 'wall-feature') {
          const next = { ...pending, ...patch }
          if (Object.keys(next).length)
            useScene
              .getState()
              .updateNode(id, wallFeatureEdit(useScene.getState().nodes, node, next))
        }
      } finally {
        clear()
      }
    },
    cancel: clear,
  }
}
