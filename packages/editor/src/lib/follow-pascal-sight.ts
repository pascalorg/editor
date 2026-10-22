import {
  type AnyNodeId,
  type CameraPose,
  findLevelAncestorId,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { BATCHED_LAYER, SCENE_LAYER, setSurfaceRaycastLayers, useViewer } from '@pascal-app/viewer'
import { type Intersection, type Mesh, type Object3D, Raycaster, Vector3 } from 'three'
import type { FollowWant } from './follow-pascal'

const DRAWN_LAYERS = (1 << SCENE_LAYER) | (1 << BATCHED_LAYER)

/** Query modeled surfaces, including batch sources, but not editor overlays or shadow-only floors. */
export class FollowSight {
  private readonly ray = new Raycaster()
  private readonly eye = new Vector3()
  private readonly direction = new Vector3()
  private readonly hits: Intersection[] = []
  private meshes: Mesh[] = []

  constructor(private scene: Object3D) {
    setSurfaceRaycastLayers(this.ray.layers)
  }

  refresh(want: FollowWant): void {
    this.meshes = []
    const root = this.scene.getObjectByName('scene-renderer')
    if (!root) return
    const targets = new Set(
      want.nodeIds?.flatMap((id) => {
        const object = sceneRegistry.nodes.get(id)
        return object ? [object] : []
      }),
    )
    const owners = new Map([...sceneRegistry.nodes].map(([id, object]) => [object, id]))
    const { nodes } = useScene.getState()
    const viewer = useViewer.getState()
    const selected = viewer.selection.levelId ? nodes[viewer.selection.levelId] : undefined
    root.updateWorldMatrix(true, true)
    root.traverseVisible((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || (mesh.layers.mask & DRAWN_LAYERS) === 0) return
      for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) {
        if (targets.has(ancestor)) return
        const id = owners.get(ancestor)
        if (!id) continue
        if (nodes[id as AnyNodeId]?.visible === false) return
        // A batched source can retain its batch layer while its floor is shadow-only.
        if (
          mesh.layers.isEnabled(BATCHED_LAYER) &&
          viewer.hideLevelsAboveSelection &&
          selected?.type === 'level'
        ) {
          const levelId = findLevelAncestorId(id as AnyNodeId, nodes)
          const level = levelId ? nodes[levelId as AnyNodeId] : undefined
          if (
            level?.type === 'level' &&
            level.level > selected.level &&
            !viewer.levelsRevealing.includes(level.id)
          )
            return
        }
      }
      this.meshes.push(mesh)
    })
  }

  clear(pose: CameraPose): boolean {
    this.eye.set(...pose.position)
    this.direction.set(...pose.target).sub(this.eye)
    this.ray.far = this.direction.length() - 0.02
    this.ray.set(this.eye, this.direction.normalize())
    this.hits.length = 0
    this.ray.intersectObjects(this.meshes, false, this.hits)
    return !this.hits.some((hit) => {
      const mesh = hit.object as Mesh
      const material = Array.isArray(mesh.material)
        ? mesh.material[hit.face?.materialIndex ?? 0]
        : mesh.material
      return material?.visible && material.opacity > 0.1 && material.colorWrite
    })
  }
}
