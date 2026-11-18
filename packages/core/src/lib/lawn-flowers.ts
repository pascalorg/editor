import { LAWN_LIMITS, type LawnFlower, type LawnNode } from '../schema/nodes/lawn'
import { linearColor, type Rgb } from './foliage'
import { sampleLawnStrokes } from './lawn-strokes'
import type { LawnBuild } from './lawn-types'
import { plantingBounds } from './planting-outline'
import type { MultiPolygon } from './polygon-boolean'
import { containsPoint, distanceToBoundary } from './polygon-boolean'
import { hash3, valueNoise3 } from './seeded-noise'

type FlowerPlacement = {
  x: number
  y: number
  z: number
  height: number
  yaw: number
  flower: LawnFlower
}
type FlowerWriter = { positions: number[]; normals: number[]; colors: number[]; indices: number[] }
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function triangle(out: FlowerWriter, a: Rgb, b: Rgb, c: Rgb, color: Rgb) {
  const normal: Rgb = [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ]
  const length = Math.hypot(...normal) || 1
  const start = out.positions.length / 3
  for (const vertex of [a, b, c]) {
    out.positions.push(...vertex)
    out.normals.push(...normal.map((value) => value / length))
    out.colors.push(...color)
  }
  out.indices.push(start, start + 1, start + 2)
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
  const green = linearColor('#59763a')
  for (const angle of [0, Math.PI / 2]) {
    const dx = Math.cos(angle) * width,
      dz = Math.sin(angle) * width
    const a: Rgb = [root[0] - dx, root[1], root[2] - dz]
    const b: Rgb = [root[0] + dx, root[1], root[2] + dz]
    const c: Rgb = [tip[0] + dx * 0.5, tip[1], tip[2] + dz * 0.5]
    const d: Rgb = [tip[0] - dx * 0.5, tip[1], tip[2] - dz * 0.5]
    triangle(out, a, b, c, green)
    triangle(out, a, c, d, green)
  }
}

function roundedPetal(
  out: FlowerWriter,
  center: Rgb,
  angle: number,
  length: number,
  width: number,
  color: Rgb,
) {
  const dx = Math.cos(angle),
    dz = Math.sin(angle)
  const point = (along: number, across: number, lift: number): Rgb => [
    center[0] + dx * along * length - dz * across * width,
    center[1] + lift,
    center[2] + dz * along * length + dx * across * width,
  ]
  const root = point(0, 0, 0)
  const rim = [
    point(0.5, 0.5, -0.0007),
    point(0.9, 0.32, -0.0006),
    point(1, 0, -0.0005),
    point(0.9, -0.32, -0.0006),
    point(0.5, -0.5, -0.0007),
  ]
  for (let index = 0; index + 1 < rim.length; index++) {
    const left = rim[index],
      right = rim[index + 1]
    if (left && right) triangle(out, root, left, right, color)
  }
}

function flowerDisc(out: FlowerWriter, center: Rgb, radius: number, color: Rgb) {
  const top: Rgb = [center[0], center[1] + radius * 0.05, center[2]]
  for (let side = 0; side < 8; side++) {
    const angle = (side * Math.PI) / 4,
      next = angle + Math.PI / 4
    triangle(
      out,
      [center[0] + Math.cos(angle) * radius, center[1], center[2] + Math.sin(angle) * radius],
      top,
      [center[0] + Math.cos(next) * radius, center[1], center[2] + Math.sin(next) * radius],
      color,
    )
  }
}

function floret(out: FlowerWriter, center: Rgb, radius: number, color: Rgb) {
  const top: Rgb = [center[0], center[1] + radius * 0.2, center[2]]
  for (let side = 0; side < 4; side++) {
    const angle = (side * Math.PI) / 2,
      next = angle + Math.PI / 2
    triangle(
      out,
      [center[0] + Math.cos(angle) * radius, center[1], center[2] + Math.sin(angle) * radius],
      top,
      [center[0] + Math.cos(next) * radius, center[1], center[2] + Math.sin(next) * radius],
      color,
    )
  }
}

function flowerGeometry(out: FlowerWriter, placement: FlowerPlacement) {
  const { x, y, z, height, yaw, flower } = placement
  const tip: Rgb = [
    x + Math.cos(yaw) * height * 0.08,
    y + height,
    z + Math.sin(yaw) * height * 0.08,
  ]
  stem(out, [x, y, z], tip)
  const leaf = linearColor('#57743b')
  const color = linearColor(flower.color ?? (flower.species === 'clover' ? '#e5c4d0' : '#f1ead5'))
  const leafCenter: Rgb = [x, y + height * 0.25, z]
  if (flower.species === 'daisy') {
    for (let index = 0; index < 10; index++)
      roundedPetal(out, tip, yaw + (index * Math.PI) / 5, 0.013, 0.005, color)
    const yellow = linearColor('#dcad35')
    for (let index = 0; index < 8; index++) {
      const angle = (index * Math.PI) / 4,
        next = angle + Math.PI / 4
      triangle(
        out,
        [tip[0], tip[1] + 0.0025, tip[2]],
        [tip[0] + Math.cos(angle) * 0.004, tip[1] + 0.001, tip[2] + Math.sin(angle) * 0.004],
        [tip[0] + Math.cos(next) * 0.004, tip[1] + 0.001, tip[2] + Math.sin(next) * 0.004],
        yellow,
      )
    }
    for (let index = 0; index < 2; index++)
      petal(out, leafCenter, yaw + index * Math.PI, 0.022, 0.005, 0.003, leaf)
  } else if (flower.species === 'clover') {
    for (let index = 0; index < 12; index++) {
      const fraction = (index + 0.5) / 12,
        angle = index * GOLDEN_ANGLE + yaw
      const radius = Math.sqrt(fraction) * 0.008
      floret(
        out,
        [
          tip[0] + Math.cos(angle) * radius,
          tip[1] + Math.sqrt(1 - fraction) * 0.006,
          tip[2] + Math.sin(angle) * radius,
        ],
        0.003,
        color,
      )
    }
    for (let index = 0; index < 3; index++)
      petal(out, leafCenter, yaw + (index * Math.PI * 2) / 3, 0.016, 0.012, 0.001, leaf)
  } else {
    for (let index = 0; index < 6; index++) {
      const angle = yaw + index * GOLDEN_ANGLE,
        radius = Math.sqrt((index + 1) / 6) * 0.022
      const head: Rgb = [
        tip[0] + Math.cos(angle) * radius,
        tip[1] + 0.004 * Math.sin(angle),
        tip[2] + Math.sin(angle) * radius,
      ]
      const branchRoot: Rgb = [tip[0], tip[1] - height * 0.15, tip[2]]
      triangle(
        out,
        [branchRoot[0] - 0.0006, branchRoot[1], branchRoot[2]],
        head,
        [branchRoot[0] + 0.0006, branchRoot[1], branchRoot[2]],
        leaf,
      )
      flowerDisc(out, head, 0.006, color)
    }
    for (let index = 0; index < 2; index++)
      petal(out, leafCenter, yaw + index * Math.PI, 0.025, 0.006, 0.003, leaf)
  }
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
  const radius = 0.06
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

function flowerPlacements(
  node: LawnNode,
  polygons: MultiPolygon,
  heightAt: (x: number, z: number) => number,
): FlowerPlacement[] {
  const flowers = node.flowers.filter((flower) => inSeason(flower, node.season))
  if (!flowers.length || !node.flowerDensity) return []
  const bounds = plantingBounds(polygons.flatMap((polygon) => polygon.outer))
  const placements: FlowerPlacement[] = []
  const occupied = new Map<string, [number, number][]>()
  for (let row = Math.floor(bounds.minZ); row < Math.ceil(bounds.maxZ); row++)
    for (let col = Math.floor(bounds.minX); col < Math.ceil(bounds.maxX); col++)
      for (let candidate = 0; candidate < 2; candidate++) {
        const x = col + hash3(node.seed + 100, col, row, candidate),
          z = row + hash3(node.seed + 101, col, row, candidate)
        if (!containsPoint(polygons, [x, z]) || distanceToBoundary(polygons, [x, z]) < 0.035)
          continue
        const strokes = sampleLawnStrokes(node.strokes, x, z)
        const drift = 0.45 + (0.55 * (valueNoise3(node.seed + 103, x / 2.7, 0, z / 2.7) + 1)) / 2
        const probability =
          (node.flowerDensity / 2) *
          drift *
          (0.7 + node.roughness * 0.3) *
          strokes.flowers *
          strokes.coverage
        if (hash3(node.seed + 104, col, row, candidate) >= probability) continue
        const flower = selectFlower(
          flowers,
          node.seed,
          x,
          z,
          hash3(node.seed + 105, col, row, candidate),
        )
        if (!flower) continue
        if (!reserveFlowerRoot(occupied, x, z)) continue
        const baseHeight =
          flower.species === 'yarrow'
            ? 0.16 + node.roughness * 0.15
            : flower.species === 'clover'
              ? 0.06 + node.roughness * 0.08
              : 0.045 + node.roughness * 0.06
        const height = Math.max(
          node.height * strokes.height * (1.1 + node.roughness * 0.75),
          baseHeight * (0.85 + hash3(node.seed + 106, col, row, candidate) * 0.3),
        )
        placements.push({
          x,
          y: heightAt(x, z),
          z,
          height,
          yaw: hash3(node.seed + 107, col, row, candidate) * Math.PI * 2,
          flower,
        })
      }
  return placements
}

export function lawnFlowers(
  node: LawnNode,
  polygons: MultiPolygon,
  heightAt: (x: number, z: number) => number,
): { mesh: LawnBuild['flowers']; requested: number } {
  const placements = flowerPlacements(node, polygons, heightAt)
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
  const out: FlowerWriter = { positions: [], normals: [], colors: [], indices: [] }
  const speciesCounts = { daisy: 0, clover: 0, yarrow: 0 }
  const headIndexEnds = new Uint32Array(retained.length)
  for (const [index, placement] of retained.entries()) {
    flowerGeometry(out, placement)
    speciesCounts[placement.flower.species]++
    headIndexEnds[index] = out.indices.length
  }
  return {
    mesh: {
      positions: new Float32Array(out.positions),
      normals: new Float32Array(out.normals),
      colors: new Float32Array(out.colors),
      indices: new Uint32Array(out.indices),
      count: retained.length,
      speciesCounts,
      headIndexEnds,
    },
    requested: placements.length,
  }
}
