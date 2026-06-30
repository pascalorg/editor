import { Tree } from '@dgreenheck/ez-tree'
import { Box3, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three'
import { TREE_PRESETS } from './presets'
import type { TreePreset } from './schema'

/**
 * Generate an ez-tree for a (preset, seed). ez-tree's `Tree` is a `THREE.Group`
 * whose children are the bark + leaf meshes; textures are inlined in the
 * library (no asset hosting). Pure given its inputs — same (preset, seed) ⇒ the
 * same tree — which is what lets the renderer cache one generation per variant
 * and instance it across every placed tree.
 */
export function generateTree(preset: TreePreset, seed: number): Tree {
  const spec = TREE_PRESETS[preset] ?? TREE_PRESETS.oak
  const tree = new Tree()
  tree.loadPreset(spec.ezPreset)
  // Set the seed AFTER the preset (the preset carries its own seed) and
  // regenerate — ez-tree requires generate() after any option change.
  tree.options.seed = seed
  tree.generate()
  return tree
}

/** A renderable sub-mesh of a tree: geometry (baked into tree-local space) +
 * its material. The instanced renderer builds one InstancedMesh per sub-mesh
 * per variant. */
export type TreeSubMesh = { geometry: BufferGeometry; material: Material | Material[] }

/** Geometry + height for one tree variant, generated once and shared across
 * every instance of that (preset, seed). */
export type TreeVariantData = { subMeshes: TreeSubMesh[]; naturalHeight: number }

/** Stable variant id. Trees with the same key share one set of InstancedMeshes. */
export function variantKey(preset: TreePreset, seed: number): string {
  return `${preset}:${seed}`
}

const variantCache = new Map<string, TreeVariantData>()

/**
 * Cached geometry for a variant. ez-tree's `generate()` is heavy, so it runs
 * once per (preset, seed); the resulting geometries/materials are retained here
 * and shared by every instance. The renderer must NOT dispose them (it sets
 * `dispose={null}` on the InstancedMesh).
 */
export function getVariantData(preset: TreePreset, seed: number): TreeVariantData {
  const key = variantKey(preset, seed)
  const cached = variantCache.get(key)
  if (cached) return cached
  const tree = generateTree(preset, seed)
  const data: TreeVariantData = {
    subMeshes: extractSubMeshes(tree),
    naturalHeight: naturalHeight(tree),
  }
  variantCache.set(key, data)
  return data
}

/** Extract the leaf/bark sub-meshes, baking each mesh's local transform into a
 * cloned geometry so instance matrices only carry the node's own transform. */
export function extractSubMeshes(tree: Object3D): TreeSubMesh[] {
  const out: TreeSubMesh[] = []
  tree.traverse((child) => {
    const mesh = child as Partial<Mesh>
    if (mesh.isMesh && mesh.geometry && mesh.material) {
      const geometry = mesh.geometry.clone()
      ;(child as Mesh).updateMatrix()
      geometry.applyMatrix4((child as Mesh).matrix)
      out.push({ geometry, material: mesh.material })
    }
  })
  return out
}

/** Natural (unscaled) height of a generated tree, so the renderer can scale
 * each instance to the node's `height`. */
export function naturalHeight(obj: Object3D): number {
  const box = new Box3().setFromObject(obj)
  return Math.max(0.001, box.max.y - box.min.y)
}
