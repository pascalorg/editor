import { area, type Polygon } from './polygon-boolean'

export function floorPlateId(
  levelId: string,
  role: string,
  zoneIds: readonly string[],
  component = 0,
): `slab_${string}` {
  let hash = 0xcbf29ce484222325n
  const identity = role === 'platform' || role === 'sunken' ? 'room' : role
  for (const byte of new TextEncoder().encode(
    JSON.stringify([levelId, identity, [...zoneIds].sort(), component]),
  )) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  }
  return `slab_${hash.toString(36).padStart(16, '0')}`
}

export function comparePlateComponents(a: Polygon, b: Polygon): number {
  const byArea = area([b]) - area([a])
  if (byArea) return byArea
  const lowest = (polygon: Polygon) =>
    [...polygon.outer].sort((a, b) => a[0] - b[0] || a[1] - b[1])[0] ?? [0, 0]
  const left = lowest(a),
    right = lowest(b)
  return left[0]! - right[0]! || left[1]! - right[1]!
}

export function keyedFloorPlateId(levelId: string, key: string, component = 0) {
  return floorPlateId(levelId, 'keyed-base', [key], component + 1)
}
