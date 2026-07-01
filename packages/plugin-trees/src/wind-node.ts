import type { Color, Material, Side, Texture } from 'three'
import { cos, Fn, float, instanceIndex, positionLocal, sin, time, uv } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

/**
 * Plant wind as reusable TSL vertex effects, decoupled from the materials.
 *
 * `LEAF_FLUTTER` / `STEM_BEND` are exported and attached at load by the plugin's
 * `onSceneLoad` hook (`scene-hook.ts`), which matches meshes by material name and
 * sets `material.positionNode`. Doing it there — not here at construction — means
 * the SAME effect re-applies to the baked GLB in the viewer, not just the live
 * editor. The material builders below therefore stay wind-free and only carry
 * ez-tree's texture/tint + name (WebGPU ignores WebGL `onBeforeCompile`, so the
 * ez-tree materials are re-created as node materials regardless).
 *
 * - **Leaf flutter** — ez-tree's approach: sway scales with the leaf card's
 *   `uv.y`, so each leaf swings from its attachment while trunk/branches stay put
 *   (a whole-tree height bend reads as a rigid rotation about the base).
 * - **Stem bend** — the small procedural kinds (flowers, grass): a gentle
 *   whole-plant lean proportional to height.
 */

// ── Leaf flutter (tree leaves) ───────────────────────────────────────────────
const LEAF_FREQUENCY = 1.2
const LEAF_STRENGTH = 0.3

const leafFlutter = Fn(() => {
  const p = positionLocal.toVar()
  const offset = float(instanceIndex).mul(0.7).add(p.x.add(p.z).mul(0.3))
  const t = time.mul(LEAF_FREQUENCY)
  const wave = sin(t.add(offset))
    .mul(0.5)
    .add(sin(t.mul(2).add(offset.mul(1.3))).mul(0.3))
    .add(sin(t.mul(5).add(offset.mul(1.5))).mul(0.2))
  const sway = uv().y.mul(LEAF_STRENGTH).mul(wave)
  p.x.addAssign(sway)
  p.z.addAssign(sway)
  return p
})
export const LEAF_FLUTTER = leafFlutter()

// ── Stem bend (flowers, grass) ───────────────────────────────────────────────
const STEM_FREQUENCY = 1.3
const STEM_STRENGTH = 0.05

const stemBend = Fn(() => {
  const p = positionLocal.toVar()
  const h = p.y.max(0)
  const phase = float(instanceIndex).mul(0.618)
  const t = time.mul(STEM_FREQUENCY).add(phase)
  p.x.addAssign(h.mul(STEM_STRENGTH).mul(sin(t)))
  p.z.addAssign(h.mul(STEM_STRENGTH).mul(cos(t.mul(1.1))))
  return p
})
export const STEM_BEND = stemBend()

/** The classic-material fields we carry over — enough to reproduce ez-tree's
 * bark/leaf look (textured, tinted, alpha-cut billboards). */
type ClassicMaterial = Material & {
  map?: Texture | null
  alphaMap?: Texture | null
  color?: Color
  side?: Side
  alphaTest?: number
  opacity?: number
  transparent?: boolean
  depthWrite?: boolean
}

const cache = new WeakMap<Material, MeshStandardNodeMaterial>()

/** Re-create a generated (ez-tree) material as a `MeshStandardNodeMaterial`,
 * transferring its texture/tint and **name** (the wind hook matches on the name,
 * so `leaves` must survive the conversion). No wind attached here — see the
 * module doc. Cached per source so shared variant materials convert once. */
export function toNodeMaterial(material: Material): MeshStandardNodeMaterial {
  const cached = cache.get(material)
  if (cached) return cached
  const src = material as ClassicMaterial
  const node = new MeshStandardNodeMaterial({
    name: material.name,
    map: src.map ?? null,
    alphaMap: src.alphaMap ?? null,
    color: src.color,
    side: src.side,
    alphaTest: src.alphaTest ?? 0,
    transparent: src.transparent ?? false,
    opacity: src.opacity ?? 1,
    depthWrite: src.depthWrite ?? true,
    roughness: 1,
    metalness: 0,
  })
  cache.set(material, node)
  return node
}

/** Build a node material for the procedural kinds (flowers/grass). Pass a `name`
 * so the wind hook can match it; no wind is attached here. Centralises the
 * `three/webgpu` import so the geometry builders stay renderer-material-free. */
export function standardNodeMaterial(
  params: ConstructorParameters<typeof MeshStandardNodeMaterial>[0],
): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial(params)
}
