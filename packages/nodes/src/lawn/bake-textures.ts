import {
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  MeshStandardMaterial,
  RGBAFormat,
  SRGBColorSpace,
} from 'three'

const ownedTextures = new WeakMap<Material, DataTexture>()
export const LAWN_CUTOUT_ALPHA_FLOOR = 128 / 255

export function srgbByte(linear: number): number {
  const value = Math.max(0, Math.min(1, linear))
  return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055))
}

/** Sample the live, linear procedural pictures with the GPU's repeat/bilinear convention. */
export function pictureSampler(texture: DataTexture, channels: number) {
  const { data, width, height } = texture.image
  if (!data) throw new Error(`Lawn picture "${texture.name}" has no readable pixels.`)
  const wrap = (n: number, size: number) => ((n % size) + size) % size
  return (u: number, v: number, channel = 0) => {
    const x = u * width - 0.5,
      y = v * height - 0.5
    const left = Math.floor(x),
      bottom = Math.floor(y)
    const fx = x - left,
      fy = y - bottom
    const x0 = wrap(left, width),
      x1 = wrap(left + 1, width),
      y0 = wrap(bottom, height) * width,
      y1 = wrap(bottom + 1, height) * width
    return (
      ((Number(data[(y0 + x0) * channels + channel]) * (1 - fx) +
        Number(data[(y0 + x1) * channels + channel]) * fx) *
        (1 - fy) +
        (Number(data[(y1 + x0) * channels + channel]) * (1 - fx) +
          Number(data[(y1 + x1) * channels + channel]) * fx) *
          fy) /
      255
    )
  }
}

/** Map-only materials also survive USDZ's normalization, which cannot compose map × COLOR_0. */
export function lawnBakeMaterial(
  name: string,
  pixels: Uint8Array,
  width: number,
  height: number,
  roughness: number,
  alphaTest = 0,
) {
  // Canvas PNGs premultiply RGB. An affine alpha remap keeps pigment precision
  // without changing the filtered mask: filter(f + (1-f)*a) >= f + (1-f)*cutoff.
  // Raising only zero alpha would instead make distant tufts thicker.
  if (alphaTest > 0)
    for (let i = 3; i < pixels.length; i += 4)
      pixels[i] = 128 + Math.round(((pixels[i] ?? 0) * 127) / 255)
  const map = new DataTexture(pixels, width, height, RGBAFormat)
  map.name = name
  map.colorSpace = SRGBColorSpace
  map.minFilter = LinearMipmapLinearFilter
  map.magFilter = LinearFilter
  map.generateMipmaps = true
  map.flipY = false
  map.needsUpdate = true
  const material = new MeshStandardMaterial({
    color: new Color(1, 1, 1),
    map,
    roughness,
    side: DoubleSide,
    alphaTest:
      alphaTest > 0 ? LAWN_CUTOUT_ALPHA_FLOOR + (1 - LAWN_CUTOUT_ALPHA_FLOOR) * alphaTest : 0,
  })
  material.name = name
  ownedTextures.set(material, map)
  return material
}

export function disposeLawnBakeTexture(material: Material): void {
  const texture = ownedTextures.get(material)
  if (!texture) return
  ownedTextures.delete(material)
  texture.dispose()
}

export function cutoutAlpha(alpha: number): number {
  return Math.round(Math.max(0, Math.min(1, alpha)) * 255)
}

export function smoothstep(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}
