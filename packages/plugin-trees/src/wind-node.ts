import type { Material } from 'three'
import { cos, Fn, float, instanceIndex, positionLocal, sin, time } from 'three/tsl'
import {
  MeshLambertNodeMaterial,
  MeshPhongNodeMaterial,
  MeshStandardNodeMaterial,
  type NodeMaterial,
} from 'three/webgpu'

/**
 * A shared, always-on wind for every plant kind — done in TSL so it runs on the
 * editor's WebGPU renderer (which ignores WebGL's `onBeforeCompile`). It's a
 * per-vertex bend, not a rigid tilt: the offset grows with height above the base
 * (`positionLocal.y`), so roots stay planted and tips travel most. The phase is
 * de-synced per instance (`instanceIndex`) and per vertex (local xz) so a forest
 * doesn't sway in lockstep. `time` is advanced by the renderer each frame.
 *
 * ez-tree isn't touched — its generated materials are copied into the *matching*
 * node material (ez-tree bark/leaves are `MeshPhongMaterial`, so Phong→Phong;
 * copying into a Standard node material would swap the shading model and render
 * black) and given this `positionNode`. The procedural flower/grass kinds build
 * node materials directly (`windStandardMaterial`).
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

const cache = new WeakMap<Material, NodeMaterial>()

/** The node-material class that mirrors a classic material's shading model, so
 * copying preserves appearance (map/color/specular/alphaTest/side/…). */
function nodeMaterialFor(type: string): NodeMaterial {
  if (type === 'MeshPhongMaterial') return new MeshPhongNodeMaterial()
  if (type === 'MeshLambertMaterial') return new MeshLambertNodeMaterial()
  return new MeshStandardNodeMaterial()
}

/** Copy a generated (ez-tree) material into a swaying node material of the
 * matching shading model. Cached per source material so shared variant materials
 * convert once. */
export function toWindMaterial(material: Material): NodeMaterial {
  const cached = cache.get(material)
  if (cached) return cached
  const node = nodeMaterialFor(material.type)
  node.copy(material as unknown as NodeMaterial)
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
