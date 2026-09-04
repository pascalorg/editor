import {
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FLOWER_PRESETS } from './flower-presets'
import type { FlowerNode, FlowerPreset } from './flower-schema'
import type { SubMesh, VariantData } from './instanced'
import { mulberry32, naturalHeight } from './variant-utils'
import { windStandardMaterial } from './wind-node'

export function flowerVariantKey(preset: FlowerPreset, seed: number, petalColor: string): string {
  return `${preset}:${seed}:${petalColor}`
}

/** Petal colour with fallbacks — nodes persisted before the field existed load
 * without it, so fall back to the preset colour rather than crash/blank. */
export function flowerPetalColor(node: FlowerNode): string {
  return node.petalColor ?? FLOWER_PRESETS[node.preset]?.petalColor ?? '#fcfcf2'
}

const variantCache = new Map<string, VariantData>()

/** Cached procedural flower geometry for a (preset, seed, petalColor). Like the
 * trees, one generation per variant is shared across every instance. Built
 * merged per material so each variant is ~3 InstancedMeshes (stem/petals/center). */
export function getFlowerVariant(node: FlowerNode): VariantData {
  const petalColor = flowerPetalColor(node)
  const key = flowerVariantKey(node.preset, node.seed, petalColor)
  const cached = variantCache.get(key)
  if (cached) return cached
  const group = buildFlower(node.preset, node.seed, petalColor)
  const subMeshes: SubMesh[] = group.children
    .filter((c): c is Mesh => (c as Mesh).isMesh)
    .map((mesh) => ({ geometry: mesh.geometry, material: mesh.material }))
  const data: VariantData = { subMeshes, naturalHeight: naturalHeight(group) }
  variantCache.set(key, data)
  return data
}

function buildFlower(preset: FlowerPreset, seed: number, petalColor: string): Group {
  const spec = FLOWER_PRESETS[preset] ?? FLOWER_PRESETS.daisy
  const rng = mulberry32(seed >>> 0)
  const group = new Group()
  const stemMat = windStandardMaterial({ color: spec.stemColor, roughness: 0.85 })
  const petalMat = windStandardMaterial({ color: petalColor, roughness: 0.7 })
  const centerMat = windStandardMaterial({ color: spec.centerColor, roughness: 0.6 })
  const stemH = spec.defaultHeight

  const stem = new CylinderGeometry(0.008, 0.015, stemH, 5)
  stem.translate(0, stemH / 2, 0)
  group.add(new Mesh(stem, stemMat))

  if (preset === 'lavender') {
    // A spike of small florets along the top ~45% of the stem.
    const florets: BufferGeometry[] = []
    const count = 26
    const spikeBase = stemH * 0.55
    for (let i = 0; i < count; i++) {
      const t = i / count
      const y = spikeBase + t * (stemH - spikeBase)
      const angle = i * 2.4 + rng() * 0.5
      const r = (1 - t) * 0.035 + 0.008
      const f = new SphereGeometry(0.016 * (1 - t * 0.4), 5, 4)
      f.translate(Math.cos(angle) * r, y, Math.sin(angle) * r)
      florets.push(f)
    }
    group.add(new Mesh(mergeGeometries(florets, false) ?? florets[0], petalMat))
    return group
  }

  if (preset === 'tulip') {
    // Six petals forming an upward cup.
    const petals: BufferGeometry[] = []
    const n = 6
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + rng() * 0.1
      const p = new ConeGeometry(0.045, 0.16, 4)
      p.translate(0, 0.08, 0)
      p.rotateZ(0.45)
      p.rotateY(-angle)
      p.translate(Math.cos(angle) * 0.03, stemH, Math.sin(angle) * 0.03)
      petals.push(p)
    }
    group.add(new Mesh(mergeGeometries(petals, false) ?? petals[0], petalMat))
    const core = new ConeGeometry(0.02, 0.1, 4)
    core.translate(0, stemH + 0.06, 0)
    group.add(new Mesh(core, centerMat))
    return group
  }

  // daisy — a yellow disc with a ring of white petals.
  const center = new SphereGeometry(0.035, 8, 6)
  center.scale(1, 0.6, 1)
  center.translate(0, stemH, 0)
  group.add(new Mesh(center, centerMat))

  const petals: BufferGeometry[] = []
  const n = 12
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + rng() * 0.08
    const p = new ConeGeometry(0.02, 0.08, 3)
    p.rotateZ(Math.PI / 2)
    p.translate(0.07, 0, 0)
    p.rotateY(-angle)
    p.translate(0, stemH + 0.005, 0)
    petals.push(p)
  }
  group.add(new Mesh(mergeGeometries(petals, false) ?? petals[0], petalMat))
  return group
}
