import type { LawnNode } from '@pascal-app/core'
import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  type Material,
  MeshStandardMaterial,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import { LAWN_NEAR_POSITIONS } from './blade-shape'

const ownedTextures = new WeakMap<Material, DataTexture>()
const RAMP_VERTICES = [0, 0, 2, 4, 6, 6] as const
const RAMP_ROWS = RAMP_VERTICES.length

function srgbByte(linear: number): number {
  const value = Math.max(0, Math.min(1, linear))
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.round(encoded * 255)
}

function rampPixels(
  node: LawnNode,
  traits: Float32Array,
  start: number,
  count: number,
  width: number,
  height: number,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255
  const tint = new Color(node.color)
  for (let blade = 0; blade < count; blade++) {
    const tone = traits[(start + blade) * 4 + 2] ?? 1
    const column = blade % width
    const row = Math.floor(blade / width) * RAMP_ROWS
    for (const [strip, vertex] of RAMP_VERTICES.entries()) {
      const progress = LAWN_NEAR_POSITIONS[vertex * 3 + 1] ?? 0
      const shade = tone * (0.86 + progress * 0.3)
      const offset = ((row + strip) * width + column) * 4
      pixels[offset] = srgbByte(tint.r * shade)
      pixels[offset + 1] = srgbByte(tint.g * shade)
      pixels[offset + 2] = srgbByte(tint.b * shade)
    }
  }
  return pixels
}

function rampUVs(count: number, width: number, height: number): Float32Array {
  const uv = new Float32Array(count * 7 * 2)
  for (let blade = 0; blade < count; blade++) {
    const column = blade % width
    const row = Math.floor(blade / width) * RAMP_ROWS
    for (let vertex = 0; vertex < 7; vertex++) {
      uv[(blade * 7 + vertex) * 2] = (column + 0.5) / width
      uv[(blade * 7 + vertex) * 2 + 1] = (row + 1.5 + Math.floor(vertex / 2)) / height
    }
  }
  return uv
}

export function buildLawnBladeBakeColors(
  node: LawnNode,
  traits: Float32Array,
  start: number,
  count: number,
) {
  const width = Math.min(1024, count)
  const height = Math.ceil(count / width) * RAMP_ROWS
  const texture = new DataTexture(
    rampPixels(node, traits, start, count, width, height),
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  )
  texture.name = 'lawn-blade-colour-ramp'
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = texture.magFilter = LinearFilter
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = false
  // Unflipped data rows and UV row centres survive both portable exporters' image conventions.
  texture.flipY = false
  texture.needsUpdate = true
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    vertexColors: false,
    roughness: 0.96,
    side: DoubleSide,
  })
  material.name = 'lawn-static-blades'
  ownedTextures.set(material, texture)
  return { material, uv: rampUVs(count, width, height) }
}

export function disposeLawnBakeTexture(material: Material): void {
  const texture = ownedTextures.get(material)
  if (!texture) return
  ownedTextures.delete(material)
  texture.dispose()
}
