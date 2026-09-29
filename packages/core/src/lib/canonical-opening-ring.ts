import type { Ring } from './polygon-boolean'

export function canonicalOpeningRing(polygon: Ring): Ring {
  const ring = polygon.map(([x, z]): [number, number] => [
    Math.round(x * 10_000) / 10_000,
    Math.round(z * 10_000) / 10_000,
  ])
  if (
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1]
  )
    ring.pop()
  if (ring.length < 3) return ring
  const rotations = [ring, [...ring].reverse()].flatMap((points) =>
    points.map((_, index) => [...points.slice(index), ...points.slice(0, index)]),
  )
  return rotations.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )[0]!
}
