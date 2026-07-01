import type { Color, Material, Side, Texture } from 'three'
import { cos, Fn, float, instanceIndex, positionLocal, sin, time } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

/**
 * A shared, always-on wind for every plant kind — done in TSL so it runs on the
 * editor's WebGPU renderer (which ignores WebGL's `onBeforeCompile`). It's a
 * per-vertex bend, not a rigid tilt: the offset grows with height above the base
 * (`positionLocal.y`), so roots stay planted and tips travel most. The phase is
 * de-synced per instance (`instanceIndex`) and per vertex (local xz) so a forest
 * doesn't sway in lockstep. `time` is advanced by the renderer each frame.
 *
 * ez-tree isn't touched — every plant renders through a `MeshStandardNodeMaterial`
 * carrying this `positionNode`. For ez-tree's generated materials that means
 * re-creating a node material from the source's texture/tint (`toWindMaterial`)
 * rather than `Material.copy()`, which doesn't transfer the classic `map`/`color`
 * onto a node material and left the textured trees black. The procedural
 * flower/grass kinds build node materials directly (`windStandardMaterial`).
 */
const STRENGTH = 0.06
const FREQUENCY = 1.3

const windPosition = Fn(() => {
  const p = positionLocal.toVar()
  const h = p.y.max(0)
  const phase = float(instanceIndex).mul(0.618).add(p.x.add(p.z).mul(0.4))
  const t = time.mul(FREQUENCY).add(phase)
  p.x.addAssign(h.mul(STRENGTH).mul(sin(t)))
  p.z.addAssign(h.mul(STRENGTH).mul(cos(t.mul(1.15))))
  return p
})

// One shared node instance — nodes are stateless templates, safe to reuse across
// every material.
const WIND_POSITION = windPosition()

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

/** Re-create a generated (ez-tree) material as a swaying `MeshStandardNodeMaterial`,
 * transferring its texture/tint explicitly (node materials don't pick these up
 * via `Material.copy()`). Cached per source so shared variant materials convert
 * once. */
export function toWindMaterial(material: Material): MeshStandardNodeMaterial {
  const cached = cache.get(material)
  if (cached) return cached
  const src = material as ClassicMaterial
  const node = new MeshStandardNodeMaterial({
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
  node.positionNode = WIND_POSITION
  cache.set(material, node)
  return node
}

/** Build a swaying node material for the procedural kinds (flowers/grass). */
export function windStandardMaterial(
  params: ConstructorParameters<typeof MeshStandardNodeMaterial>[0],
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial(params)
  material.positionNode = WIND_POSITION
  return material
}
