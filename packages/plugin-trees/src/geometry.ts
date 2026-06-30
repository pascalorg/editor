import { Tree } from '@dgreenheck/ez-tree'
import { Box3, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three'
import { TREE_PRESETS } from './presets'
import type { TreeNode } from './schema'

/** The geometry-affecting fields of a tree. Two trees with the same spec share
 * one generated variant (and thus one InstancedMesh set). Per-instance fields
 * (position/rotation/height) are deliberately NOT here — they're cheap matrix
 * work, not geometry. */
export type TreeSpec = Pick<
  TreeNode,
  'preset' | 'seed' | 'foliageDensity' | 'trunkThickness' | 'leafless'
>

export function treeSpecOf(node: TreeNode): TreeSpec {
  return {
    preset: node.preset,
    seed: node.seed,
    foliageDensity: node.foliageDensity,
    trunkThickness: node.trunkThickness,
    leafless: node.leafless,
  }
}

/** Stable variant id. Trees with the same key share one set of InstancedMeshes. */
export function treeVariantKey(spec: TreeSpec): string {
  return `${spec.preset}:${spec.seed}:${spec.foliageDensity}:${spec.trunkThickness}:${spec.leafless}`
}

/**
 * Generate an ez-tree for a spec. ez-tree's `Tree` is a `THREE.Group`; textures
 * are inlined in the library (no asset hosting). The curated inspector params
 * map onto ez-tree options after the preset loads: trunk thickness scales every
 * branch radius, foliage density scales the leaf count, and `leafless` zeroes
 * it. Pure given its inputs — same spec ⇒ same tree — which is what lets the
 * renderer cache one generation per variant and instance it everywhere.
 */
export function generateTree(spec: TreeSpec): Tree {
  const preset = TREE_PRESETS[spec.preset] ?? TREE_PRESETS.oak
  const tree = new Tree()
  tree.loadPreset(preset.ezPreset)
  tree.options.seed = spec.seed

  const radius = tree.options.branch.radius as unknown as Record<string, number>
  for (const level of Object.keys(radius)) {
    const value = radius[level]
    if (value !== undefined) radius[level] = value * spec.trunkThickness
  }

  const leaves = tree.options.leaves as { count: number }
  leaves.count = spec.leafless ? 0 : Math.round(leaves.count * spec.foliageDensity)

  tree.generate()
  return tree
}

/** A renderable sub-mesh of a tree: geometry (baked into tree-local space) +
 * its material. The instanced renderer builds one InstancedMesh per sub-mesh
 * per variant. */
export type TreeSubMesh = { geometry: BufferGeometry; material: Material | Material[] }

/** Geometry + height for one tree variant, generated once and shared across
 * every instance of that spec. */
export type TreeVariantData = { subMeshes: TreeSubMesh[]; naturalHeight: number }

const variantCache = new Map<string, TreeVariantData>()

/**
 * Cached geometry for a spec. ez-tree's `generate()` is heavy, so it runs once
 * per variant; the resulting geometries/materials are retained here and shared
 * by every instance. The renderer must NOT dispose them (it sets `dispose={null}`
 * on the InstancedMesh).
 */
export function getVariantData(spec: TreeSpec): TreeVariantData {
  const key = treeVariantKey(spec)
  const cached = variantCache.get(key)
  if (cached) return cached
  const tree = generateTree(spec)
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
