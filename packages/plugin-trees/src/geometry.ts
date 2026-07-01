import { Tree } from '@dgreenheck/ez-tree'
import { Box3, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three'
import { ezPresetOf } from './presets'
import type { TreeNode } from './schema'
import { toWindMaterial } from './wind-node'

/** The geometry-affecting fields of a tree. Two trees with the same spec share
 * one generated variant (and thus one InstancedMesh set). Per-instance fields
 * (position/rotation/height) are deliberately NOT here — they're cheap matrix
 * work, not geometry. */
export type TreeSpec = Pick<
  TreeNode,
  | 'preset'
  | 'size'
  | 'treeType'
  | 'seed'
  | 'foliageDensity'
  | 'trunkThickness'
  | 'leafless'
  | 'leafColor'
  | 'branchColor'
>

export function treeSpecOf(node: TreeNode): TreeSpec {
  // Default every field — nodes persisted before a field existed load without
  // it, so the renderer must tolerate partial trees (no runtime schema re-parse).
  return {
    preset: node.preset ?? 'oak',
    size: node.size ?? 'medium',
    treeType: node.treeType ?? 'deciduous',
    seed: node.seed ?? 1,
    foliageDensity: node.foliageDensity ?? 1,
    trunkThickness: node.trunkThickness ?? 1,
    leafless: node.leafless ?? false,
    leafColor: node.leafColor ?? '#ffffff',
    branchColor: node.branchColor ?? '#ffffff',
  }
}

/** Stable variant id. Trees with the same key share one set of InstancedMeshes. */
export function treeVariantKey(spec: TreeSpec): string {
  return [
    spec.preset,
    spec.size,
    spec.treeType,
    spec.seed,
    spec.foliageDensity,
    spec.trunkThickness,
    spec.leafless,
    spec.leafColor,
    spec.branchColor,
  ].join(':')
}

/** `#rrggbb` → 0xrrggbb, defaulting to white on anything missing/unparseable. */
function hexToInt(hex: string | undefined): number {
  const n = Number.parseInt((hex ?? '').replace('#', ''), 16)
  return Number.isFinite(n) ? n : 0xffffff
}

/**
 * Generate an ez-tree for a spec. ez-tree's `Tree` is a `THREE.Group`; textures
 * are inlined in the library (no asset hosting). The curated inspector params
 * map onto ez-tree options after the preset loads: size picks the preset family
 * member, `treeType` swaps the growth model, trunk thickness scales every branch
 * radius, foliage density scales the leaf count (`leafless` zeroes it), and the
 * colours drive the bark/leaf tints. Pure given its inputs — same spec ⇒ same
 * tree — which is what lets the renderer cache one generation per variant.
 */
export function generateTree(spec: TreeSpec): Tree {
  const tree = new Tree()
  tree.loadPreset(ezPresetOf(spec.preset, spec.size))
  tree.options.seed = spec.seed
  ;(tree.options as { type: string }).type = spec.treeType

  const radius = tree.options.branch.radius as unknown as Record<string, number>
  for (const level of Object.keys(radius)) {
    const value = radius[level]
    if (value !== undefined) radius[level] = value * spec.trunkThickness
  }

  const leaves = tree.options.leaves as { count: number; tint: number }
  leaves.count = spec.leafless ? 0 : Math.round(leaves.count * spec.foliageDensity)
  leaves.tint = hexToInt(spec.leafColor)
  ;(tree.options.bark as { tint: number }).tint = hexToInt(spec.branchColor)

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
      // Swap ez-tree's plain materials for swaying node materials (WebGPU/TSL).
      const material = Array.isArray(mesh.material)
        ? mesh.material.map(toWindMaterial)
        : toWindMaterial(mesh.material)
      out.push({ geometry, material })
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

/** Deterministic 32-bit RNG (mulberry32) — same seed ⇒ same geometry. Shared by
 * the procedural flower/grass builders so a variant is stable across instances. */
export function mulberry32(seed: number): () => number {
  let a = seed || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
