import {
  resolveWallFeaturePlacement,
  type SceneApi,
  sceneRegistry,
  type WallFeatureNode,
} from '@pascal-app/core'
import { createFeaturePreviewBox } from '../shared/feature-preview-box'

const previews = new Map<string, ReturnType<typeof createFeaturePreviewBox>>()

export function clearWallFeatureEditPreview(id: string): void {
  const preview = previews.get(id)
  if (!preview) return
  preview.dispose()
  previews.delete(id)
}

export function showWallFeatureEditPreview(node: WallFeatureNode, scene: SceneApi): void {
  const root = sceneRegistry.nodes.get(node.id)
  if (!root) {
    clearWallFeatureEditPreview(node.id)
    return
  }
  const placement = resolveWallFeaturePlacement(scene.nodes(), node)
  let entry = previews.get(node.id)
  if (!entry) {
    entry = createFeaturePreviewBox()
    previews.set(node.id, entry)
  }
  const preview = entry.mesh
  if (preview.parent !== root) root.add(preview)
  preview.position.set(
    node.width / 2,
    node.height / 2,
    ((node.mode === 'niche' ? 1 : -1) * (placement.face === 'b' ? -1 : 1) * node.depth) / 2,
  )
  preview.scale.set(node.width, node.height, node.depth)
}
