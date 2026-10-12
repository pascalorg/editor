import {
  resolveSlabFeaturePlacement,
  type SceneApi,
  type SlabFeatureNode,
  sceneRegistry,
} from '@pascal-app/core'
import { createFeaturePreviewBox } from '../shared/feature-preview-box'

const previews = new Map<string, ReturnType<typeof createFeaturePreviewBox>>()
export function clearSlabFeatureEditPreview(id: string) {
  const mesh = previews.get(id)
  if (!mesh) return
  mesh.dispose()
  previews.delete(id)
}
export function showSlabFeatureEditPreview(node: SlabFeatureNode, scene: SceneApi) {
  const root = sceneRegistry.nodes.get(node.id)
  const original = scene.get(node.id)
  if (!root || original?.type !== 'slab-feature') return
  const p = resolveSlabFeaturePlacement(scene.nodes(), node),
    base = resolveSlabFeaturePlacement(scene.nodes(), original)
  let entry = previews.get(node.id)
  if (!entry) {
    entry = createFeaturePreviewBox()
    previews.set(node.id, entry)
  }
  const mesh = entry.mesh
  root.add(mesh)
  mesh.position.set(p.x - base.x, (p.mount + p.surface) / 2 - base.mount, p.z - base.z)
  mesh.scale.set(node.width, node.depth, node.length)
}
