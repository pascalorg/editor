import type { SceneLoadContext } from '@pascal-app/core'
import type { Material, Object3D } from 'three'
import { LEAF_FLUTTER, STEM_BEND } from './wind-node'

// A node material carries a `positionNode`; classic materials don't. We only
// ever set it, so a minimal structural type is enough (avoids a three/webgpu
// import here — the effect nodes come from `wind-node.ts`).
type WindTarget = Material & { positionNode?: unknown }

// Materials we've already decorated. The hook re-runs as scene content changes
// (and once per loaded GLB), so this keeps each material's wind attached exactly
// once. WeakSet so disposed materials don't leak.
const decorated = new WeakSet<Material>()

/** The wind node for a material, by the name the geometry builders assign
 * (`leaves` flutter; `flower-*` / `grass-*` whole-plant bend). Trunk/branches
 * and everything else get nothing. */
function windNodeFor(name: string): unknown | null {
  if (name === 'leaves') return LEAF_FLUTTER
  if (name.startsWith('flower') || name.startsWith('grass')) return STEM_BEND
  return null
}

/**
 * `Plugin.onSceneLoad` for the trees plugin. Walks the scene (live editor meshes
 * or a loaded baked GLB — both keep the material names) and attaches the wind
 * `positionNode` to matching materials. Idempotent via `decorated`; a no-op
 * during export so the bake stays a clean rest-pose snapshot.
 */
export default function decoratePlantWind(root: Object3D, ctx: SceneLoadContext): void {
  if (ctx.isExporting) return
  root.traverse((object) => {
    const mesh = object as Object3D & { isMesh?: boolean; material?: Material | Material[] }
    if (!mesh.isMesh || !mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (decorated.has(material)) continue
      const node = windNodeFor(material.name ?? '')
      if (!node) continue
      const target = material as WindTarget
      target.positionNode = node
      target.needsUpdate = true
      decorated.add(material)
    }
  })
}
