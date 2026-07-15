import type { Color, Material, Side, Texture } from 'three'
import { cos, Fn, float, instanceIndex, positionLocal, sin, time, uv } from 'three/tsl'
import { MeshStandardNodeMaterial, type Node, type NodeBuilder } from 'three/webgpu'

/**
 * Always-on wind for the plant kinds, done in TSL so it runs on the editor's
 * WebGPU renderer (which ignores WebGL's `onBeforeCompile`). Two motions:
 *
 * - **Leaf flutter** (`LEAF_FLUTTER`) — ez-tree's own approach: the sway scales
 *   with the leaf card's `uv.y`, so each leaf swings from its attachment while
 *   the trunk and branches stay put. A whole-tree height-based bend, by contrast,
 *   is a rigid rotation about the base and reads as the tree spinning in place.
 *   Multi-frequency for a natural gust; phased per instance + per leaf.
 * - **Stem bend** (`STEM_BEND`) — for the small procedural kinds (flowers,
 *   grass), a gentle whole-plant lean proportional to height reads fine.
 *
 * ez-tree isn't touched: its generated materials are re-created as node materials
 * carrying the texture/tint (`toWindMaterial`) — only the `leaves` material gets
 * the flutter node; bark stays static. `time` is advanced by the renderer.
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
const LEAF_FLUTTER = leafFlutter()

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
const STEM_BEND = stemBend()

/**
 * Standard node material whose wind displacement runs **before** the instance
 * transform. The wind nodes read `positionLocal` expecting raw geometry-local
 * coordinates — leaf phase from the card's position inside its own tree, stem
 * height from the plant's own base — with the per-instance scale/rotation/
 * translation applied on top. three r184 happened to emit `positionNode`
 * statements in exactly that order; r185 fixed the emission order so
 * `positionNode` now runs *after* instancing, which put the wind in level
 * space: sway stopped scaling with the instance, leaf phase followed world
 * placement, and STEM_BEND's height term read the floor elevation, so plants
 * on upper levels slid around rigidly. Assigning `positionLocal` inside
 * `setupPosition` before `super` applies instancing restores the r184
 * (geometry-space) semantics on r185.
 */
class WindNodeMaterial extends MeshStandardNodeMaterial {
  windNode: Node | null = null

  setupPosition(builder: NodeBuilder): Node {
    if (this.windNode !== null) positionLocal.assign(this.windNode)
    return super.setupPosition(builder)
  }

  customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}|wind:${this.windNode ? this.windNode.id : 'none'}`
  }
}

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
 * transferring its texture/tint explicitly (node materials don't pick these up
 * via `Material.copy()`). Only the `leaves` material flutters; bark stays static.
 * Cached per source so shared variant materials convert once. */
export function toWindMaterial(material: Material): MeshStandardNodeMaterial {
  const cached = cache.get(material)
  if (cached) return cached
  const src = material as ClassicMaterial
  const node = new WindNodeMaterial({
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
  if (material.name === 'leaves') node.windNode = LEAF_FLUTTER
  cache.set(material, node)
  return node
}

/** Build a swaying node material for the procedural kinds (flowers/grass). */
export function windStandardMaterial(
  params: ConstructorParameters<typeof MeshStandardNodeMaterial>[0],
): MeshStandardNodeMaterial {
  const material = new WindNodeMaterial(params)
  material.windNode = STEM_BEND
  return material
}

const staticCache = new WeakMap<Material, Material>()

/** Windless twin of a wind material — same look, no wind node. The outline
 * mask pass renders outlined meshes with a shared override material, so an
 * outline can never follow the GPU sway; the selection proxy renders this twin
 * instead, so the outlined silhouette and the visible mesh match exactly (the
 * plant simply holds still while hovered/selected). Built by explicit property
 * transfer, not `.clone()` — node-material clone drops `map`/`color` (same
 * pitfall as `toWindMaterial`). Cached per source. */
export function toStaticMaterial(material: Material): Material {
  const cached = staticCache.get(material)
  if (cached) return cached
  const src = material as MeshStandardNodeMaterial
  const twin = new MeshStandardNodeMaterial({
    map: src.map ?? null,
    alphaMap: src.alphaMap ?? null,
    color: src.color,
    side: src.side,
    alphaTest: src.alphaTest ?? 0,
    transparent: src.transparent ?? false,
    opacity: src.opacity ?? 1,
    depthWrite: src.depthWrite ?? true,
    roughness: src.roughness,
    metalness: src.metalness,
  })
  staticCache.set(material, twin)
  return twin
}
