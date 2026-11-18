import type { LawnNode } from '@pascal-app/core'
import { Color, FrontSide, MeshStandardMaterial } from 'three'
import {
  cutoutAlpha,
  disposeLawnBakeTexture,
  lawnBakeMaterial,
  smoothstep,
  srgbByte,
} from './bake-textures'
import { tuftTexture } from './turf-textures'

const TILE = 128
const COLUMNS = 8
const TONES = 32
const TONES_PER_PAGE = 16
const SIZE = 1024

type Tones = { minimum: number; range: number }

function toneRange(traits: Float32Array): Tones {
  let minimum = Infinity,
    maximum = -Infinity
  for (let i = 2; i < traits.length; i += 4) {
    minimum = Math.min(minimum, traits[i] ?? 1)
    maximum = Math.max(maximum, traits[i] ?? 1)
  }
  return { minimum, range: maximum - minimum }
}

function paintPage(node: LawnNode, tones: Tones, source: ArrayLike<number>, page: number) {
  const tint = new Color(node.color)
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  for (let localBin = 0; localBin < TONES_PER_PAGE; localBin++) {
    const tone = tones.minimum + (tones.range * (page * TONES_PER_PAGE + localBin)) / (TONES - 1)
    for (let patch = 0; patch < 4; patch++) {
      const tile = localBin * 4 + patch
      const left = (tile % COLUMNS) * TILE,
        bottom = Math.floor(tile / COLUMNS) * TILE
      for (let y = 0; y < TILE; y++) {
        const progress = (y + 0.5) / TILE
        const ripe =
          (patch >= 2 ? 1 : 0) * smoothstep(0.36, 1, progress) * smoothstep(0.88, 1.14, tone)
        for (let x = 0; x < TILE; x++) {
          const input = ((Math.floor(patch / 2) * TILE + y) * 256 + (patch % 2) * TILE + x) * 2
          const output = ((bottom + y) * SIZE + left + x) * 4
          const shade = tone * ((Number(source[input]) / 255) * 1.48 + 0.22)
          pixels[output] = srgbByte(tint.r * (0.64 + 0.48 * ripe) * shade)
          pixels[output + 1] = srgbByte(tint.g * (0.81 + 0.17 * ripe) * shade)
          pixels[output + 2] = srgbByte(tint.b * (1.22 - 0.14 * ripe) * shade)
          pixels[output + 3] = cutoutAlpha(Number(source[input + 1]) / 255)
        }
      }
    }
  }
  return pixels
}

function tuftUV(node: LawnNode, traits: Float32Array, binFor: (blade: number) => number) {
  return (blade: number, plane: number, x: number, progress: number): [number, number] => {
    const yaw = traits[blade * 4] ?? 0
    const pick = yaw * 2.37 + plane * 0.47
    const fract = (value: number) => value - Math.floor(value)
    const column = fract(pick) >= 0.5 ? 1 : 0
    const row = node.roughness * node.roughness >= fract(pick * 1.71) ? 1 : 0
    const tile = (binFor(blade) % TONES_PER_PAGE) * 4 + row * 2 + column
    return [
      ((tile % COLUMNS) * TILE + (x + 0.5) * TILE) / SIZE,
      (Math.floor(tile / COLUMNS) * TILE + progress * TILE) / SIZE,
    ]
  }
}

/** Bounded 1K atlases also retain their full resolution in the USDZ serializer. */
export function buildLawnBladeBakeColors(node: LawnNode, traits: Float32Array) {
  const tones = toneRange(traits)
  const lease = new MeshStandardMaterial()
  const materials: MeshStandardMaterial[] = []
  try {
    const source = tuftTexture(lease).image.data
    if (!source) throw new Error('The live lawn tuft picture has no readable pixels.')
    for (let page = 0; page < (tones.range ? 2 : 1); page++) {
      const pixels = paintPage(node, tones, source, page)
      const material = lawnBakeMaterial(
        'lawn-tuft-colours-and-silhouettes',
        pixels,
        SIZE,
        SIZE,
        0.9,
        0.32,
      )
      material.side = FrontSide
      materials.push(material)
    }
  } catch (error) {
    for (const material of materials) {
      disposeLawnBakeTexture(material)
      material.dispose()
    }
    throw error
  } finally {
    lease.dispose()
  }
  const binFor = (blade: number) =>
    tones.range
      ? Math.round((((traits[blade * 4 + 2] ?? 1) - tones.minimum) / tones.range) * (TONES - 1))
      : 0
  return {
    materials,
    pageFor: (blade: number) => Math.floor(binFor(blade) / TONES_PER_PAGE),
    uv: tuftUV(node, traits, binFor),
  }
}
