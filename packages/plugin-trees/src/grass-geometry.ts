import { type BufferGeometry, ConeGeometry, DoubleSide, Group, Mesh } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GRASS_PRESETS } from './grass-presets'
import type { GrassNode, GrassPreset } from './grass-schema'
import type { SubMesh, VariantData } from './instanced'
import { mulberry32, naturalHeight } from './variant-utils'
import { windStandardMaterial } from './wind-node'

export function grassVariantKey(preset: GrassPreset, seed: number, bladeColor: string): string {
  return `${preset}:${seed}:${bladeColor}`
}

const variantCache = new Map<string, VariantData>()

/** Cached procedural grass geometry for a (preset, seed, bladeColor). One
 * generation per variant is shared across every instance — a whole lawn of the
 * same tuft is a single InstancedMesh. */
export function getGrassVariant(node: GrassNode): VariantData {
  const key = grassVariantKey(node.preset, node.seed, node.bladeColor)
  const cached = variantCache.get(key)
  if (cached) return cached
  const group = buildGrass(node.preset, node.seed, node.bladeColor)
  const subMeshes: SubMesh[] = group.children
    .filter((c): c is Mesh => (c as Mesh).isMesh)
    .map((mesh) => ({ geometry: mesh.geometry, material: mesh.material }))
  const data: VariantData = { subMeshes, naturalHeight: naturalHeight(group) }
  variantCache.set(key, data)
  return data
}

/** A tuft of flattened, leaning blades merged into one geometry (one draw per
 * instance). Deterministic in `seed` so the same variant renders identically. */
function buildGrass(preset: GrassPreset, seed: number, bladeColor: string): Group {
  const spec = GRASS_PRESETS[preset] ?? GRASS_PRESETS.meadow
  const rng = mulberry32(seed >>> 0)
  const group = new Group()
  const mat = windStandardMaterial({ color: bladeColor, roughness: 0.9, side: DoubleSide })
  const h = spec.defaultHeight

  const blades: BufferGeometry[] = []
  for (let i = 0; i < spec.blades; i++) {
    const bh = h * (0.6 + rng() * 0.6)
    const blade = new ConeGeometry(0.02, bh, 3)
    blade.scale(1, 1, 0.3) // flatten the cone into a blade
    blade.translate(0, bh / 2, 0)
    blade.rotateZ((rng() - 0.5) * 0.7) // lean
    const angle = rng() * Math.PI * 2
    blade.rotateY(angle)
    const r = rng() * 0.07
    blade.translate(Math.cos(angle) * r, 0, Math.sin(angle) * r)
    blades.push(blade)
  }
  group.add(new Mesh(mergeGeometries(blades, false) ?? blades[0], mat))
  return group
}
