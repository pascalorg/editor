import { LAWN_LIMITS, type LawnFlower, type LawnNode } from '../schema/nodes/lawn'
import { linearColor, type Rgb } from './foliage'
import type { LawnCoverage } from './lawn-coverage'
import { sampleLawnStrokes } from './lawn-strokes'
import type { LawnBuild } from './lawn-types'
import { plantingBounds } from './planting-outline'
import type { MultiPolygon } from './polygon-boolean'
import { hash3, valueNoise3 } from './seeded-noise'

type FlowerPlacement = {
  x: number
  y: number
  z: number
  height: number
  yaw: number
  flower: LawnFlower
}
type FlowerWriter = {
  positions: number[]
  normals: number[]
  colors: number[]
  uv: number[]
}
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function triangle(out: FlowerWriter, a: Rgb, b: Rgb, c: Rgb, color: Rgb, atB = color, atC = color) {
  const normal: Rgb = [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ]
  const length = Math.hypot(...normal) || 1
  out.positions.push(...a, ...b, ...c)
  const nx = normal[0] / length,
    ny = normal[1] / length,
    nz = normal[2] / length
  out.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  out.colors.push(...color, ...atB, ...atC)
  out.uv.push(65151, 65151, 65151, 65151, 65151, 65151)
}

function petal(
  out: FlowerWriter,
  center: Rgb,
  angle: number,
  length: number,
  width: number,
  lift: number,
  color: Rgb,
) {
  const [x, y, z] = center
  const dx = Math.cos(angle),
    dz = Math.sin(angle)
  const middle: Rgb = [x + dx * length * 0.55, y + lift, z + dz * length * 0.55]
  const left: Rgb = [middle[0] - (dz * width) / 2, middle[1], middle[2] + (dx * width) / 2]
  const right: Rgb = [middle[0] + (dz * width) / 2, middle[1], middle[2] - (dx * width) / 2]
  const tip: Rgb = [x + dx * length, y + lift * 0.65, z + dz * length]
  triangle(out, center, left, tip, color)
  triangle(out, center, tip, right, color)
}

function stem(out: FlowerWriter, root: Rgb, tip: Rgb, width = 0.0012) {
  for (const angle of [0, Math.PI / 2]) {
    const dx = Math.cos(angle) * width,
      dz = Math.sin(angle) * width
    const a: Rgb = [root[0] - dx, root[1], root[2] - dz]
    const b: Rgb = [root[0] + dx, root[1], root[2] + dz]
    const c: Rgb = [tip[0] + dx * 0.5, tip[1], tip[2] + dz * 0.5]
    const d: Rgb = [tip[0] - dx * 0.5, tip[1], tip[2] - dz * 0.5]
    triangle(out, a, b, c, STEM)
    triangle(out, a, c, d, STEM)
  }
}

const STEM = linearColor('#4d6d3d')
const LEAF = linearColor('#577949')
const POLLEN = linearColor('#f4bd42')
const CLOVER_LEAF = linearColor('#83a16b')
const OCHRE = linearColor('#a96d20')

function tint(color: Rgb, level: number): Rgb {
  return [color[0] * level, color[1] * level, color[2] * level]
}

function radial(origin: Rgb, angle: number, along: number, lift: number, across = 0): Rgb {
  const dx = Math.cos(angle),
    dz = Math.sin(angle)
  return [
    origin[0] + dx * along - dz * across,
    origin[1] + lift,
    origin[2] + dz * along + dx * across,
  ]
}

// The four atlas quadrants hold pollen, clover florets, yarrow and leaf/ray stamps.
// Unmapped stem and leaf vertices sample a plain texel in the top right corner.
function petalUV(out: FlowerWriter, vertex: number, tile: number, u: number, v: number) {
  const inset = (n: number) => 0.008 + Math.min(1, Math.max(0, n)) * 0.984
  out.uv[vertex * 2] = Math.round(((tile % 2) + inset(u)) * 32767.5)
  out.uv[vertex * 2 + 1] = Math.round((Math.floor(tile / 2) + inset(v)) * 32767.5)
}

function discUV(out: FlowerWriter, start: number, tile: number, center: Rgb, radius: number) {
  for (let i = start; i < out.positions.length; i += 3)
    petalUV(
      out,
      i / 3,
      tile,
      0.5 + ((out.positions[i] ?? 0) - center[0]) / (radius * 2),
      0.5 + ((out.positions[i + 2] ?? 0) - center[2]) / (radius * 2),
    )
}

function daisyHead(out: FlowerWriter, tip: Rgb, yaw: number, color: Rgb) {
  const base = tint(color, 0.73)
  for (let ray = 0; ray < 16; ray++) {
    const a = yaw + (ray * Math.PI) / 8
    const length = 0.021 + 0.0025 * Math.sin(ray * 2.7 + yaw)
    const lift = 0.0018 + Math.sin(ray * 1.9 + yaw) * 0.0017
    const root = radial(tip, a, 0.002, -0.001)
    const left = radial(tip, a, length * 0.58, lift, 0.003)
    const right = radial(tip, a, length * 0.58, lift, -0.003)
    const lobe = radial(tip, a, length, lift * 0.6, 0.0024)
    const rightLobe = radial(tip, a, length, lift * 0.6, -0.0024)
    const start = out.positions.length / 3
    triangle(out, root, left, right, base, color, color)
    triangle(out, left, lobe, rightLobe, color)
    triangle(out, left, rightLobe, right, color)
    const coords = [
      [0.5, 0],
      [0, 0.5],
      [1, 0.5],
      [0, 0.5],
      [0, 1],
      [1, 1],
      [0, 0.5],
      [1, 1],
      [1, 0.5],
    ]
    for (let i = 0; i < coords.length; i++) {
      const uv = coords[i]
      if (uv) petalUV(out, start + i, 3, (uv[0] ?? 0) * 0.45, 0.02 + (uv[1] ?? 0) * 0.94)
    }
  }
  const discStart = out.positions.length
  for (let i = 0; i < 8; i++) {
    const a = yaw + (i * Math.PI) / 4
    const top: Rgb = [tip[0], tip[1] + 0.004, tip[2]]
    triangle(
      out,
      radial(tip, a, 0.0063, 0.0008),
      top,
      radial(tip, a + Math.PI / 4, 0.0063, 0.0008),
      tint(POLLEN, 0.76),
      POLLEN,
      i % 3 ? POLLEN : OCHRE,
    )
  }
  for (let i = discStart; i < out.positions.length; i += 3) {
    const nx = ((out.positions[i] ?? 0) - tip[0]) * 65,
      nz = ((out.positions[i + 2] ?? 0) - tip[2]) * 65
    const n = Math.hypot(nx, 1, nz)
    out.normals[i] = nx / n
    out.normals[i + 1] = 1 / n
    out.normals[i + 2] = nz / n
  }
  discUV(out, discStart, 0, tip, 0.0063)
}

function cloverHead(out: FlowerWriter, tip: Rgb, yaw: number, color: Rgb) {
  const sides = 9
  const latitudes = [-Math.PI / 2, -0.58, 0.1, 0.77, Math.PI / 2]
  const surface = (ring: number, k: number): Rgb => {
    const lat = latitudes[ring] ?? 0,
      theta = yaw + ((k + (ring % 2) * 0.23) * Math.PI * 2) / sides
    return radial(
      tip,
      theta,
      0.0162 * Math.cos(lat) * (1 + 0.027 * Math.sin(3 * theta + ring)),
      0.003 + 0.017 * Math.sin(lat) + 0.00065 * Math.sin(theta * 4 + ring) * Math.cos(lat),
    )
  }
  const face = (corners: [number, number][]) => {
    const [a, b, c] = corners.map(([ring, k]) => surface(ring, k))
    if (!a || !b || !c) return
    const start = out.positions.length / 3
    triangle(out, a, b, c, color)
    for (const [index, [ring, k]] of corners.entries()) {
      const offset = (start + index) * 3
      const nx = (out.positions[offset] ?? 0) - tip[0],
        nz = (out.positions[offset + 2] ?? 0) - tip[2]
      const ny = (out.positions[offset + 1] ?? 0) - tip[1] - 0.003
      const length = Math.hypot(nx, ny, nz) || 1
      out.normals[offset] = nx / length
      out.normals[offset + 1] = ny / length
      out.normals[offset + 2] = nz / length
      petalUV(out, start + index, 1, k / sides, (latitudes[ring] ?? 0) / Math.PI + 0.5)
    }
  }
  for (let k = 0; k < sides; k++) {
    face([
      [0, k + 0.5],
      [1, k],
      [1, k + 1],
    ])
    for (let ring = 1; ring <= 2; ring++) {
      face([
        [ring, k],
        [ring + 1, k],
        [ring, k + 1],
      ])
      face([
        [ring, k + 1],
        [ring + 1, k],
        [ring + 1, k + 1],
      ])
    }
    face([
      [3, k],
      [4, k + 0.5],
      [3, k + 1],
    ])
  }
}

function cloverLeaves(out: FlowerWriter, origin: Rgb, yaw: number) {
  for (let i = 0; i < 3; i++) {
    const a = yaw + (i * Math.PI * 2) / 3
    const l = radial(origin, a, 0.003, 0.001, 0.004),
      r = radial(origin, a, 0.003, 0.001, -0.004)
    const ll = radial(origin, a, 0.023, 0.005, 0.01),
      rr = radial(origin, a, 0.023, 0.005, -0.01)
    const start = out.positions.length / 3
    triangle(out, l, ll, rr, CLOVER_LEAF)
    triangle(out, l, rr, r, CLOVER_LEAF)
    const coords = [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
      [1, 1],
      [1, 0],
    ]
    for (let k = 0; k < coords.length; k++) {
      const uv = coords[k]
      if (uv) petalUV(out, start + k, 3, 0.5 + (uv[0] ?? 0) * 0.44, 0.02 + (uv[1] ?? 0) * 0.94)
    }
  }
}

function meadowHead(out: FlowerWriter, tip: Rgb, yaw: number, color: Rgb) {
  for (let branch = 0; branch < 6; branch++) {
    const a = yaw + branch * GOLDEN_ANGLE
    const reach = Math.sqrt((branch + 0.2) / 6) * 0.035
    const joint = radial(tip, a, reach, 0.015 - reach * 0.19)
    const root = radial(tip, a, 0, -0.019)
    triangle(out, radial(root, a, 0, 0, 0.0012), joint, radial(root, a, 0, 0, -0.0012), STEM)
    const radius = 0.011 + 0.002 * Math.sin(a)
    const end = radial(joint, a, 0, 0.0045)
    const start = out.positions.length
    for (let k = 0; k < 7; k++) {
      const angle = a + (k * Math.PI * 2) / 7
      triangle(
        out,
        radial(joint, angle, radius, 0),
        end,
        radial(joint, angle + (Math.PI * 2) / 7, radius, 0),
        color,
      )
    }
    discUV(out, start, 2, joint, radius)
  }
}

function flowerStem(placement: FlowerPlacement) {
  const out: FlowerWriter = { positions: [], normals: [], colors: [], uv: [] }
  const { x, y, z, height, yaw, flower } = placement
  const tip: Rgb = radial([x, y, z], yaw, height * 0.1, height)
  stem(out, [x, y, z], tip)
  const color = linearColor(
    flower.color ??
      (flower.species === 'clover'
        ? '#f0bfd2'
        : flower.species === 'yarrow'
          ? '#ede9c9'
          : '#fff6eb'),
  )
  const leafCenter: Rgb = radial([x, y, z], yaw, height * 0.044, height * 0.44)
  if (flower.species === 'clover') {
    cloverLeaves(out, radial([x, y, z], yaw, (height - 0.034) * 0.1, height - 0.034), yaw)
  } else {
    const leaves = flower.species === 'yarrow' ? 4 : 2
    for (let i = 0; i < leaves; i++) {
      const origin = radial(leafCenter, yaw, i * 0.0007, i * 0.0035)
      petal(out, origin, yaw + i * Math.PI * 0.92, 0.025 - i * 0.0025, 0.006, 0.005, LEAF)
    }
  }
  const start = out.positions.length
  if (flower.species === 'daisy') daisyHead(out, tip, yaw, color)
  else if (flower.species === 'clover') cloverHead(out, tip, yaw, color)
  else meadowHead(out, tip, yaw, color)
  // Individual stems nod differently. Rotate the whole inflorescence about its junction.
  const angle = (flower.species === 'daisy' ? 0.29 : 0.13) * Math.sin(yaw * 2.8)
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  for (let i = start; i < out.positions.length; i += 3) {
    const py = (out.positions[i + 1] ?? 0) - tip[1],
      pz = (out.positions[i + 2] ?? 0) - tip[2]
    out.positions[i + 1] = tip[1] + py * cos - pz * sin
    out.positions[i + 2] = tip[2] + py * sin + pz * cos
    const ny = out.normals[i + 1] ?? 0,
      nz = out.normals[i + 2] ?? 0
    out.normals[i + 1] = ny * cos - nz * sin
    out.normals[i + 2] = ny * sin + nz * cos
  }
  return out
}

function inSeason(flower: LawnFlower, season: LawnNode['season']) {
  return flower.species === 'yarrow'
    ? season === 'summer' || season === 'autumn'
    : season === 'spring' || season === 'summer'
}

function selectFlower(flowers: LawnFlower[], seed: number, x: number, z: number, random: number) {
  let choice =
    ((valueNoise3(seed + 71, x / 2.4, 0, z / 2.4) + 1) * 0.39 + random * 0.22) *
    flowers.reduce((sum, flower) => sum + flower.share, 0)
  for (const flower of flowers) {
    choice -= flower.share
    if (choice <= 0) return flower
  }
  return flowers[flowers.length - 1]
}

function reserveFlowerRoot(
  occupied: Map<string, [number, number][]>,
  x: number,
  z: number,
): boolean {
  const radius = 0.048
  const col = Math.floor(x / radius),
    row = Math.floor(z / radius)
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const neighbors = occupied.get(`${col + dx},${row + dz}`) ?? []
      if (neighbors.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < radius * radius))
        return false
    }
  const key = `${col},${row}`
  const cell = occupied.get(key) ?? []
  cell.push([x, z])
  occupied.set(key, cell)
  return true
}

// Potential colonies have satellites up to 38 cm from their centre. Count the halo
// because a colony just outside the bounding box can send heads back inside.
const HEADS_PER_COLONY = 8
const COLONIES_PER_CELL = 3
const HEADS_PER_CELL = HEADS_PER_COLONY * COLONIES_PER_CELL
export function lawnFlowerProbes(node: LawnNode, width: number, depth: number) {
  return node.flowerDensity && node.flowers.some((flower) => inSeason(flower, node.season))
    ? (width + 2) * (depth + 2) * HEADS_PER_CELL
    : 0
}

function flowerPlacements(
  node: LawnNode,
  polygons: MultiPolygon,
  coverage: LawnCoverage,
  heightAt: (x: number, z: number) => number,
): FlowerPlacement[] {
  const flowers = node.flowers.filter((flower) => inSeason(flower, node.season))
  if (!flowers.length || !node.flowerDensity) return []
  const bounds = plantingBounds(polygons.flatMap((polygon) => polygon.outer))
  const placements: FlowerPlacement[] = []
  const occupied = new Map<string, [number, number][]>()
  for (let row = Math.floor(bounds.minZ) - 1; row < Math.ceil(bounds.maxZ) + 1; row++)
    for (let col = Math.floor(bounds.minX) - 1; col < Math.ceil(bounds.maxX) + 1; col++)
      for (let colony = 0; colony < COLONIES_PER_CELL; colony++) {
        const cx = col + hash3(node.seed + 100, col, row, colony),
          cz = row + hash3(node.seed + 101, col, row, colony)
        const drift = valueNoise3(node.seed + 103, cx / 1.8, 0, cz / 1.8)
        // Near a contour of the moisture field, neighbouring colonies flower together.
        const ribbon = Math.max(0, 1 - Math.abs(drift + 0.04) * 5.8)
        const species = selectFlower(
          flowers,
          node.seed,
          cx,
          cz,
          hash3(node.seed + 105, col, row, colony),
        )
        if (!species) continue
        const spread = 0.15 + hash3(node.seed + 109, col, row, colony) * 0.23
        const axis = drift * 2.1 + 0.87
        for (let k = 0; k < HEADS_PER_COLONY; k++) {
          const index = colony * HEADS_PER_COLONY + k
          const yaw = hash3(node.seed + 107, col, row, index) * Math.PI * 2
          const r = Math.sqrt(hash3(node.seed + 108, col, row, index)) * spread
          const along = Math.cos(yaw) * r,
            across = Math.sin(yaw) * r * 0.78
          const x = cx + Math.cos(axis) * along - Math.sin(axis) * across
          const z = cz + Math.sin(axis) * along + Math.cos(axis) * across
          const strokes = sampleLawnStrokes(node.strokes, x, z)
          // A painted colony can bloom even where the unpainted field has a gap.
          const abundance =
            (0.006 + ribbon * 0.75) * Math.min(1, strokes.flowers * 2) +
            Math.max(0, strokes.flowers * 2 - 1) * 1.8
          if (
            hash3(node.seed + 110, col, row, index) >=
            abundance * node.flowerDensity * 0.5 * strokes.coverage
          )
            continue
          if (!coverage.contains(x, z)) continue
          const baseHeight =
            species.species === 'yarrow'
              ? 0.22 + node.roughness * 0.11
              : species.species === 'clover'
                ? 0.09
                : 0.085
          const height =
            Math.max(baseHeight, node.height * strokes.height * (1.02 + node.roughness * 0.48)) *
            (0.84 + hash3(node.seed + 106, col, row, index) * 0.36)
          const reach = height * 0.1 + (species.species === 'yarrow' ? 0.053 : 0.03)
          if (coverage.distance(x, z, reach) < reach || !reserveFlowerRoot(occupied, x, z)) continue
          placements.push({ x, y: heightAt(x, z), z, height, yaw, flower: species })
        }
      }
  return placements
}

export function lawnFlowers(
  node: LawnNode,
  polygons: MultiPolygon,
  coverage: LawnCoverage,
  heightAt: (x: number, z: number) => number,
): { mesh: LawnBuild['flowers']; requested: number } {
  const placements = flowerPlacements(node, polygons, coverage, heightAt)
  // Hash buckets thin the whole area evenly without making the first corner own the cap.
  const buckets: FlowerPlacement[][] = Array.from({ length: 256 }, () => [])
  for (const [index, placement] of placements.entries())
    buckets[
      Math.floor(
        hash3(
          node.seed + 111,
          Math.floor(placement.x * 10000),
          Math.floor(placement.z * 10000),
          index,
        ) * 256,
      )
    ]?.push(placement)
  const retained = buckets.flat().slice(0, LAWN_LIMITS.maxFlowers)
  // Each species has a fixed topology. Measure one exemplar per species, so the
  // meadow can be packed without keeping its geometry in growing JS arrays.
  const speciesCounts = { daisy: 0, clover: 0, yarrow: 0 }
  const verticesPerStem = { daisy: 0, clover: 0, yarrow: 0 }
  const headIndexEnds = new Uint32Array(retained.length)
  let vertexCount = 0
  for (const [index, placement] of retained.entries()) {
    const species = placement.flower.species
    if (!verticesPerStem[species])
      verticesPerStem[species] = flowerStem(placement).positions.length / 3
    speciesCounts[species]++
    vertexCount += verticesPerStem[species]
    headIndexEnds[index] = vertexCount
  }
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(positions.length)
  const colors = new Float32Array(positions.length)
  const uv = new Uint16Array(vertexCount * 2)
  const indices = new Uint32Array(vertexCount)
  let vertex = 0
  for (const placement of retained) {
    const head = flowerStem(placement)
    positions.set(head.positions, vertex * 3)
    normals.set(head.normals, vertex * 3)
    colors.set(head.colors, vertex * 3)
    uv.set(head.uv, vertex * 2)
    vertex += head.positions.length / 3
  }
  for (let i = 0; i < indices.length; i++) indices[i] = i
  return {
    mesh: {
      positions,
      normals,
      colors,
      indices,
      uv,
      count: retained.length,
      speciesCounts,
      headIndexEnds,
    },
    requested: placements.length,
  }
}
