import clipping from 'polygon-clipping'

export type Ring = [number, number][]
export type Polygon = { outer: Ring; holes: Ring[] }
export type MultiPolygon = Polygon[]
export type PolygonInput = Ring | Polygon | MultiPolygon

const SCALE = 10_000
const MIN_AREA = 1e-6

// Relative to the first vertex: absolute products at large coordinates (1e9 m
// offsets) cancel catastrophically and turn a zero-area sliver into square metres.
function signedArea(ring: Ring): number {
  const origin = ring[0]
  if (!origin) return 0
  const [ox, oz] = origin
  return (
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]!
      return sum + (p[0] - ox) * (q[1] - oz) - (q[0] - ox) * (p[1] - oz)
    }, 0) / 2
  )
}

function comparePoints(a: [number, number], b: [number, number]) {
  return a[0] - b[0] || a[1] - b[1]
}

function dedupeRing(points: Ring): Ring {
  return points.filter((p, i) => comparePoints(p, points[(i + 1) % points.length]!) !== 0)
}

function cleanRing(points: Ring, ccw: boolean): Ring {
  let ring = dedupeRing(points)
  let changed = true
  while (changed && ring.length >= 3) {
    changed = false
    ring = ring.filter((b, i) => {
      const a = ring[(i + ring.length - 1) % ring.length]!
      const c = ring[(i + 1) % ring.length]!
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
      const between = (b[0] - a[0]) * (b[0] - c[0]) + (b[1] - a[1]) * (b[1] - c[1]) < 0
      if (Math.abs(cross) > 1e-12 || !between) return true
      changed = true
      return false
    })
  }
  if (ring.length < 3) return []
  if (signedArea(ring) > 0 !== ccw) ring.reverse()
  let first = 0
  for (let i = 1; i < ring.length; i++) {
    if (comparePoints(ring[i]!, ring[first]!) < 0) first = i
  }
  return [...ring.slice(first), ...ring.slice(0, first)]
}

function compareRings(a: Ring, b: Ring) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = comparePoints(a[i]!, b[i]!)
    if (order) return order
  }
  return a.length - b.length
}

function polygons(input: PolygonInput): MultiPolygon {
  if (!Array.isArray(input)) return [input]
  if (!input.length) return []
  return Array.isArray(input[0]) ? [{ outer: input as Ring, holes: [] }] : (input as MultiPolygon)
}

function quantised(input: PolygonInput): clipping.MultiPolygon {
  return polygons(input).flatMap(({ outer, holes }) => {
    const rings = [outer, ...holes].map((ring) =>
      dedupeRing(
        ring.map(([x, z]) => {
          const point: [number, number] = [
            Math.round(x * SCALE) / SCALE,
            Math.round(z * SCALE) / SCALE,
          ]
          if (![x, z, ...point].every(Number.isFinite))
            throw new Error('Non-finite polygon coordinate')
          return point.map((value) => (value === 0 ? 0 : value)) as [number, number]
        }),
      ),
    )
    if (rings[0]!.length < 3) return []
    return [rings.filter((ring) => ring.length >= 3)]
  })
}

function normalise(result: clipping.MultiPolygon): MultiPolygon {
  return result
    .flatMap(([shell, ...voids]) => {
      const outer = cleanRing(shell!, true)
      const holes = voids
        .map((ring) => cleanRing(ring, false))
        .filter((ring) => Math.abs(signedArea(ring)) >= MIN_AREA)
        .sort(compareRings)
      const polygon = { outer, holes }
      return area([polygon]) >= MIN_AREA ? [polygon] : []
    })
    .sort((a, b) => compareRings(a.outer, b.outer))
}

const warnedCallSites = new Set<string>()

function clip(
  operation: 'union' | 'difference' | 'intersection',
  inputs: readonly PolygonInput[],
  run: (inputs: clipping.MultiPolygon[]) => clipping.MultiPolygon,
  throwOnError = false,
): MultiPolygon {
  try {
    return normalise(run(inputs.map(quantised)))
  } catch (error) {
    if (throwOnError) throw error
    if (process.env.NODE_ENV !== 'production') {
      const caller = new Error('Polygon clipping caller').stack
        ?.split('\n')
        .slice(1)
        .find(
          (line) =>
            !(line.includes('/polygon-boolean.ts:') || line.includes('/polygon-boolean.js:')),
        )
      const site = `${operation}:${caller ?? 'unknown'}`
      if (!warnedCallSites.has(site)) {
        warnedCallSites.add(site)
        console.warn(
          `[polygon-boolean] ${operation} failed at ${caller?.trim() ?? 'unknown caller'}`,
          error,
        )
      }
    }
    return []
  }
}

export function union(inputs: readonly PolygonInput[]): MultiPolygon {
  return clip('union', inputs, (polygons) => {
    const valid = polygons.filter((multi) => multi.length)
    return valid.length ? clipping.union(valid[0]!, ...valid.slice(1)) : []
  })
}

export function difference(
  a: PolygonInput,
  b: PolygonInput,
  options: { throwOnError?: boolean } = {},
): MultiPolygon {
  return clip(
    'difference',
    [a, b],
    ([left, right]) => {
      if (!left!.length) return []
      return right!.length ? clipping.difference(left!, right!) : clipping.union(left!)
    },
    options.throwOnError,
  )
}

export function intersection(a: PolygonInput, b: PolygonInput): MultiPolygon {
  const bounds = (input: PolygonInput) => {
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity
    for (const { outer } of polygons(input))
      for (const [x, z] of outer) {
        minX = Math.min(minX, x)
        minZ = Math.min(minZ, z)
        maxX = Math.max(maxX, x)
        maxZ = Math.max(maxZ, z)
      }
    return [minX, minZ, maxX, maxZ] as const
  }
  const ab = bounds(a),
    bb = bounds(b)
  if (
    ab[2] + 1 / SCALE < bb[0] ||
    bb[2] + 1 / SCALE < ab[0] ||
    ab[3] + 1 / SCALE < bb[1] ||
    bb[3] + 1 / SCALE < ab[1]
  )
    return []
  return clip('intersection', [a, b], ([left, right]) =>
    left!.length && right!.length ? clipping.intersection(left!, right!) : [],
  )
}

export function area(multi: MultiPolygon): number {
  return multi.reduce(
    (sum, polygon) =>
      sum +
      Math.abs(signedArea(polygon.outer)) -
      polygon.holes.reduce((holes, ring) => holes + Math.abs(signedArea(ring)), 0),
    0,
  )
}

function ringDistance(ring: Ring, p: [number, number]): number {
  let distance = Number.POSITIVE_INFINITY
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!
    const dx = b[0] - a[0],
      dz = b[1] - a[1]
    const lengthSq = dx * dx + dz * dz
    const t = lengthSq
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq))
      : 0
    distance = Math.min(distance, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz))
  }
  return distance
}

function insideRing(ring: Ring, p: [number, number]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}

/** Polygon boundaries, including hole rims, belong to the polygon. */
export function containsPoint(multi: MultiPolygon, p: [number, number]): boolean {
  for (const { outer, holes } of multi) {
    if (ringDistance(outer, p) <= 1e-10) return true
    let insideHole = false
    for (const hole of holes) {
      if (ringDistance(hole, p) <= 1e-10) return true
      if (insideRing(hole, p)) insideHole = true
    }
    if (!insideHole && insideRing(outer, p)) return true
  }
  return false
}

export function distanceToBoundary(multi: MultiPolygon, p: [number, number]): number {
  return multi.reduce(
    (distance, { outer, holes }) =>
      Math.min(distance, ...[outer, ...holes].map((ring) => ringDistance(ring, p))),
    Number.POSITIVE_INFINITY,
  )
}
