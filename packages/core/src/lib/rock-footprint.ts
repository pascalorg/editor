import type { RockPoint } from './rock-form'
import { rockNoise } from './rock-form-v2'

export function rockFootprint(at: RockPoint, size: number | RockPoint, seed: number): RockPoint[] {
  const [width, depth] = typeof size === 'number' ? [size, size] : size
  // Bounded jitter keeps a 0.6 m diameter above the existing 0.25 m² area minimum.
  const ring = Array.from({ length: 12 }, (_, i): RockPoint => {
    const angle = (i / 12) * 2 * Math.PI + (rockNoise(seed, i, 101) - 0.5) * 0.2
    const radius = 0.98 + 0.02 * rockNoise(seed, i, 102)
    return [Math.cos(angle) * radius, Math.sin(angle) * radius]
  })
  const xs = ring.map(([x]) => x)
  const zs = ring.map(([, z]) => z)
  const minX = Math.min(...xs)
  const minZ = Math.min(...zs)
  const spanX = Math.max(...xs) - minX
  const spanZ = Math.max(...zs) - minZ
  return ring.map(([x, z]) => [
    at[0] + ((x - minX) / spanX - 0.5) * width,
    at[1] + ((z - minZ) / spanZ - 0.5) * depth,
  ])
}
