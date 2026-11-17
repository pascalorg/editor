import {
  color,
  float,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  positionWorld,
  sin,
  smoothstep,
} from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

export type RockLook = { strata: boolean; lichen: number }

const STONE_DARK = color('#6f6a62')
const STONE_LIGHT = color('#a49d90')
const STRATA_TINT = color('#8a7c68')
const LICHEN = color('#7c8a4a')
/** Metres of rock a stone-colour patch spans. */
const PATCH = 0.7
/** Metres between strata bands. */
const BAND = 0.35

/**
 * Stone colour for a rock from where each point is in the world, so it needs no UVs and a rock
 * keeps its look when its outline or height changes: patches of light and dark stone, optional
 * horizontal strata, and lichen on the faces that look up.
 */
export function rockColorNode({ strata, lichen }: RockLook) {
  const patches = mx_fractal_noise_float(positionWorld.div(PATCH), 3, 2, 0.5).mul(0.5).add(0.5)
  let stone = mix(STONE_DARK, STONE_LIGHT, smoothstep(0.25, 0.75, patches))
  if (strata) {
    const wobble = mx_fractal_noise_float(positionWorld.mul(0.9), 2, 2, 0.5).mul(0.12)
    const band = sin(
      positionWorld.y
        .add(wobble)
        .div(BAND)
        .mul(Math.PI * 2),
    )
      .mul(0.5)
      .add(0.5)
    stone = mix(stone, STRATA_TINT, smoothstep(0.55, 0.9, band).mul(0.45))
  }
  if (lichen > 0) {
    const up = smoothstep(0.55, 0.9, normalWorld.y)
    const spots = smoothstep(
      float(1).sub(lichen),
      float(1).sub(lichen).add(0.15),
      mx_fractal_noise_float(positionWorld.mul(1.8), 2, 2, 0.5).mul(0.5).add(0.5),
    )
    stone = mix(stone, LICHEN, up.mul(spots).mul(0.85))
  }
  return stone
}

const cache = new Map<string, MeshStandardNodeMaterial>()

/** One material per look: rocks that look alike share it. */
export function rockMaterial(look: RockLook): MeshStandardNodeMaterial {
  const key = `${look.strata}:${Math.round(look.lichen * 20)}`
  const cached = cache.get(key)
  if (cached) return cached
  const material = new MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 })
  material.colorNode = rockColorNode(look)
  cache.set(key, material)
  return material
}
