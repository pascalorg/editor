import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  RedFormat,
  RepeatWrapping,
  RGFormat,
} from 'three'

function seededStream(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

// The four silhouettes each occupy a padded square. Red carries the fold and tip light,
// green the coverage. Empty texels have a neutral tone so mip filtering leaves no dark halo.
function makeTufts(): DataTexture {
  const size = 256
  const tile = size / 2
  const pixels = new Uint8Array(size * size * 2)
  const random = seededStream(217)
  for (let i = 0; i < pixels.length; i += 2) pixels[i] = 145
  for (let patch = 0; patch < 4; patch++) {
    const rough = patch >= 2
    const ox = (patch % 2) * tile
    const oy = Math.floor(patch / 2) * tile
    for (let leaf = 0; leaf < 29; leaf++) {
      const root = 0.065 + random() * 0.87
      const side = (root - 0.5) * 0.25 + (random() - 0.5) * 0.36
      const tip = Math.max(0.025, Math.min(0.975, root + side))
      const height = (rough ? 0.32 + random() * 0.65 : 0.53 + random() * 0.39) * tile
      const bow = (random() - 0.5) * 0.14
      const width = (0.014 + random() * 0.019) * tile
      const face = 0.69 + random() * 0.38
      for (let y = 1; y <= height; y++) {
        const t = y / height
        const center = (root + (tip - root) * t * t + bow * t * (1 - t)) * tile
        const half = width * (rough ? 1 - t * t : 1 - t * 0.62)
        for (
          let x = Math.max(1, Math.floor(center - half));
          x <= Math.min(tile - 2, Math.ceil(center + half));
          x++
        ) {
          const cover = Math.min(1, Math.max(0, half + 0.5 - Math.abs(x - center)))
          const i = ((oy + y) * size + ox + x) * 2
          const tone = (74 + 115 * t + (x > center ? 19 : -9)) * face
          pixels[i] = (pixels[i] ?? 0) * (1 - cover) + tone * cover
          pixels[i + 1] = Math.max(pixels[i + 1] ?? 0, Math.round(255 * cover))
        }
      }
    }
  }
  return new DataTexture(pixels, size, size, RGFormat)
}

// A square of overlapping fallen leaves seen from above. Wrap writes, including their
// shadows, across both tile boundaries so the ground has no seams at grazing angles.
function makeSward(): DataTexture {
  const size = 256
  const pixels = new Uint8Array(size * size)
  const random = seededStream(913)
  for (let i = 0; i < pixels.length; i++) pixels[i] = 63 + random() * 64
  for (let tuft = 0; tuft < 1450; tuft++) {
    const x = random() * size,
      z = random() * size,
      yaw = random() * Math.PI * 2
    for (let leaf = 0; leaf < 6; leaf++) {
      const angle = yaw + (random() - 0.5) * 4.2
      const length = 4 + random() * 13,
        width = 0.48 + random() * 0.76
      const dx = Math.cos(angle),
        dz = Math.sin(angle),
        bend = (random() - 0.5) * 4
      const value = 87 + random() * 120
      for (let step = 0; step <= length; step++) {
        const t = step / length
        const cx = x + dx * step - dz * bend * t * t,
          cz = z + dz * step + dx * bend * t * t
        const radius = width * (1 - 0.78 * t)
        const falloff = radius + 0.5
        const limit = falloff * falloff
        const shade = value * (0.67 + 0.5 * t)
        for (let iz = Math.floor(cz - 1); iz <= Math.ceil(cz + 1); iz++)
          for (let ix = Math.floor(cx - 1); ix <= Math.ceil(cx + 1); ix++) {
            const dx = ix - cx,
              dz = iz - cz
            const distanceSq = dx * dx + dz * dz
            if (distanceSq >= limit) continue
            const coverage = Math.min(1, falloff - Math.sqrt(distanceSq))
            const index = (iz & (size - 1)) * size + (ix & (size - 1))
            pixels[index] = (pixels[index] ?? 0) * (1 - coverage) + shade * coverage
          }
      }
    }
  }
  const texture = new DataTexture(pixels, size, size, RedFormat)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.anisotropy = 4
  return texture
}

export function sharedTexture(create: () => DataTexture) {
  let texture: DataTexture | undefined
  let owners = 0
  return (material: Material) => {
    if (!texture) {
      texture = create()
      texture.minFilter = LinearMipmapLinearFilter
      texture.magFilter = LinearFilter
      texture.generateMipmaps = true
      texture.needsUpdate = true
    }
    owners++
    const release = () => {
      material.removeEventListener('dispose', release)
      if (--owners === 0) {
        texture?.dispose()
        texture = undefined
      }
    }
    material.addEventListener('dispose', release)
    return texture
  }
}

export const tuftTexture = sharedTexture(makeTufts)
export const swardTexture = sharedTexture(makeSward)
