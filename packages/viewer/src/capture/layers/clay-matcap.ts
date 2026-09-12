import { DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace } from 'three'

export function createClayMatcap(): DataTexture {
  const size = 128
  const pixels = new Uint8Array(size * size * 4)
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = (column / (size - 1)) * 2 - 1
      const y = (row / (size - 1)) * 2 - 1
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
      const gloss = Math.exp(-((x + 0.34) ** 2 / 0.045 + (y - 0.42) ** 2 / 0.075))
      const rim = Math.exp(-((x - 0.65) ** 2 / 0.025 + (y + 0.15) ** 2 / 0.5)) * 0.3
      const base = [0.3 + (1 - z) * 0.22, 0.35 + (x + 1) * 0.16 + z * 0.12, 0.64 + z * 0.2]
      const offset = (row * size + column) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          Math.min(1, base[channel]! + gloss * 0.58 + rim) * 255,
        )
      }
      pixels[offset + 3] = 255
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}
