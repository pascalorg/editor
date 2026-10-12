import {
  resolveWallFeaturePlacement,
  type SceneApi,
  sceneRegistry,
  type WallFeatureNode,
} from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'

const previews = new Map<string, Mesh<BoxGeometry, MeshBasicMaterial>>()

export function clearWallFeatureEditPreview(id: string): void {
  const preview = previews.get(id)
  if (!preview) return
  preview.removeFromParent()
  preview.geometry.dispose()
  preview.material.dispose()
  previews.delete(id)
}

export function showWallFeatureEditPreview(node: WallFeatureNode, scene: SceneApi): void {
  const root = sceneRegistry.nodes.get(node.id)
  if (!root) {
    clearWallFeatureEditPreview(node.id)
    return
  }
  const placement = resolveWallFeaturePlacement(scene.nodes(), node)
  let preview = previews.get(node.id)
  if (!preview) {
    preview = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({
        wireframe: true,
        color: '#8b5cf6',
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    )
    preview.layers.set(EDITOR_LAYER)
    preview.userData.pascalExport = 'strip'
    preview.raycast = () => {}
    previews.set(node.id, preview)
  }
  if (preview.parent !== root) root.add(preview)
  preview.position.set(
    node.width / 2,
    node.height / 2,
    ((node.mode === 'niche' ? 1 : -1) * (placement.face === 'b' ? -1 : 1) * node.depth) / 2,
  )
  preview.scale.set(node.width, node.height, node.depth)
}
