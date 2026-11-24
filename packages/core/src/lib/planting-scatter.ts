import type { PlantingNode, PlantingSpecies } from '../schema/nodes/planting'
import { PLANTING_LIMITS } from '../schema/nodes/planting-limits'
import type { GroundRead } from './ground-read'
import { plantingSurfaceHeight } from './planting-ground'
import {
  type PlantingPoint,
  plantingBounds,
  plantingContains,
  plantingEdgeDistance,
} from './planting-outline'
import { hashSeed, randomStream, valueNoise3 } from './seeded-noise'

/** Additional scene clearance; radius encloses the mature crown as well as its spacing disk. */
export type PlantingAccept = (x: number, z: number, radius: number) => boolean
export type PlantingPlacement = {
  x: number
  z: number
  y: number
  species: number
  layer: PlantingSpecies['layer']
  /** Exclusion radius: half the species spacing. Pair separation is the sum of both radii. */
  radius: number
  scale: number
  seed: number
}

/** Depth from the visible (+Z) side along this point's interior interval, including concavities. */
export function plantingSeenDepth(outline: readonly PlantingPoint[], x: number, z: number): number {
  let front = Infinity
  let back = -Infinity
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as PlantingPoint
    const b = outline[(i + 1) % outline.length] as PlantingPoint
    if (a[0] > x === b[0] > x) continue
    const at = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])
    if (at >= z) front = Math.min(front, at)
    if (at <= z) back = Math.max(back, at)
  }
  return Number.isFinite(front - back) && front > back ? (front - z) / (front - back) : 0.5
}

function layerAt(
  outline: readonly PlantingPoint[],
  x: number,
  z: number,
  seed: number,
): PlantingSpecies['layer'] {
  // The layer order survives, but drifts interlock instead of ending on ruler-straight bands.
  const depth =
    plantingSeenDepth(outline, x, z) + 0.09 * valueNoise3(seed + 29, x * 0.65, 0, z * 0.65)
  if (depth < 0.22 || (depth < 0.6 && plantingEdgeDistance(outline, x, z) < 0.24)) return 'edge'
  return depth > 0.6 ? 'back' : 'mid'
}

const layerNumber = { edge: 0, mid: 1, back: 2 } as const

function speciesAt(
  node: PlantingNode,
  layer: PlantingSpecies['layer'],
  population: readonly number[],
  accentAttempts: number[],
  x: number,
  z: number,
  random: () => number,
): number {
  // Give a sparse grass accent a bounded head start before larger woody crowns occupy
  // its layer. An oversized/refused accent must not starve the species that do fit.
  if (node.pattern === 'drifts') {
    const accent = node.plants.findIndex(
      (plant, i) =>
        plant.layer === layer &&
        plant.habit === 'tuft' &&
        !population[i] &&
        (accentAttempts[i] ?? 0) < 32,
    )
    if (accent >= 0) {
      accentAttempts[accent] = (accentAttempts[accent] ?? 0) + 1
      return accent
    }
  }
  let chosen = 0
  let best = -Infinity
  let leafyPopulation = 0
  let leafyShare = 0
  for (let i = 0; i < node.plants.length; i++) {
    const plant = node.plants[i] as PlantingSpecies
    if (plant.layer === layer && plant.habit !== 'tuft') {
      leafyPopulation += population[i] ?? 0
      leafyShare += plant.share
    }
  }
  for (let i = 0; i < node.plants.length; i++) {
    const species = node.plants[i] as PlantingSpecies
    if (species.layer !== layer) continue
    // Small grasses fit residual slots after woody crowns stop fitting. Strongly prefer
    // the intended leafy share, but never exclude a feasible grass behind an oversized shrub.
    const accentWeight =
      node.pattern === 'drifts' &&
      species.habit === 'tuft' &&
      leafyShare > 0 &&
      (population[i] ?? 0) >= Math.max(1, (leafyPopulation * species.share) / leafyShare)
        ? 0.002
        : 1
    // Choose a drift, not each plant, by share. Completed clumps leave room for the other
    // species instead of one unusually high noise field monopolising a small bed.
    const field =
      node.pattern === 'drifts'
        ? 1 + 0.4 * valueNoise3(node.seed + i * 101, x * 0.58, i * 3.3, z * 0.58)
        : 1
    const weight =
      (species.share * field * accentWeight) /
      (node.pattern === 'drifts' ? 1 + (population[i] ?? 0) : 1)
    const score = Math.log(Math.max(0.0001, random())) / weight
    if (score > best) {
      best = score
      chosen = i
    }
  }
  return chosen
}

/**
 * Variable-radius Poisson rejection with touching clumps and global restarts. Sparse buckets avoid
 * allocating a grid proportional to area/minSpacing². Attempts and accepted plants are bounded,
 * even if every candidate is refused or the polygon has very narrow disconnected accepted zones.
 */
export function scatterPlanting(
  node: PlantingNode,
  outline: readonly PlantingPoint[],
  ground: GroundRead,
  accept?: PlantingAccept,
): PlantingPlacement[] {
  const random = randomStream(hashSeed(node.seed, 17, 0, 0))
  const bounds = plantingBounds(outline)
  const rootHeight = plantingSurfaceHeight(node, outline, ground)
  const placements: PlantingPlacement[] = []
  const population = node.plants.map(() => 0)
  const accentAttempts = node.plants.map(() => 0)
  const layers = (['back', 'mid', 'edge'] as const).filter((layer) =>
    node.plants.some((plant) => plant.layer === layer),
  )
  let phase = 0
  let phaseAttempts = 0
  let phasePlants = 0
  let clump: PlantingPlacement[] = []
  let clumpTarget = 0
  let clumpFailures = 0
  let maxRadius = 0
  let minSpacing = Infinity
  for (const species of node.plants) {
    maxRadius = Math.max(maxRadius, species.spacing / 2)
    minSpacing = Math.min(minSpacing, species.spacing)
  }
  const cell = 2 * maxRadius
  const buckets = new Map<string, PlantingPlacement[]>()
  const columns = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / minSpacing))
  const rows = Math.max(1, Math.floor((bounds.maxZ - bounds.minZ) / minSpacing))
  let failures = 0
  for (
    let attempt = 0;
    attempt < PLANTING_LIMITS.maxAttempts && placements.length < PLANTING_LIMITS.maxPlants;
    attempt++
  ) {
    // Establish the large back crowns first; smaller foreground plants cannot steal their
    // room. Saturated layers advance, and all layers share the same hard attempt budget.
    if (
      failures >= Math.max(1024, Math.min(4096, placements.length * 12)) ||
      phaseAttempts >= Math.floor(PLANTING_LIMITS.maxAttempts / layers.length) ||
      phasePlants >= Math.floor(PLANTING_LIMITS.maxPlants / layers.length)
    ) {
      phase++
      if (phase >= layers.length) break
      failures = 0
      phaseAttempts = 0
      phasePlants = 0
      clump = []
    }
    failures++
    phaseAttempts++
    const layer = layers[phase] as PlantingSpecies['layer']
    let x: number
    let z: number
    let origin: PlantingPlacement | undefined
    if (clump.length >= clumpTarget || clumpFailures >= 96) clump = []
    if (node.pattern === 'rows') {
      x =
        bounds.minX +
        ((Math.floor(random() * columns) + 0.5) * (bounds.maxX - bounds.minX)) / columns
      z = bounds.minZ + ((Math.floor(random() * rows) + 0.5) * (bounds.maxZ - bounds.minZ)) / rows
    } else if (node.pattern === 'drifts' && clump.length) {
      origin = clump[Math.floor(random() * clump.length)] as PlantingPlacement
      const angle = random() * Math.PI * 2
      const species = node.plants[origin.species] as PlantingSpecies
      const spread = species.spread * origin.scale
      // Groundcover grows into a mat; its growing tips merge more deeply than shrub crowns.
      const distance =
        species.habit === 'carpet'
          ? origin.radius * 2 * (1.01 + 0.12 * random())
          : Math.max(origin.radius * 2 * 1.005, spread * (0.78 + 0.08 * random()))
      x = origin.x + Math.cos(angle) * distance
      z = origin.z + Math.sin(angle) * distance
      clumpFailures++
    } else {
      x = bounds.minX + random() * (bounds.maxX - bounds.minX)
      z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ)
    }
    if (!plantingContains(outline, x, z)) continue
    const wantedLayer = layerAt(outline, x, z, node.seed)
    const nearestLayer = layers.reduce((nearest, candidate) =>
      Math.abs(layerNumber[candidate] - layerNumber[wantedLayer]) <
      Math.abs(layerNumber[nearest] - layerNumber[wantedLayer])
        ? candidate
        : nearest,
    )
    if (nearestLayer !== layer) continue
    const species =
      origin?.species ?? speciesAt(node, layer, population, accentAttempts, x, z, random)
    const plant = node.plants[species] as PlantingSpecies
    const radius = plant.spacing / 2
    if (
      node.pattern === 'drifts' &&
      plant.habit === 'tuft' &&
      plant.layer === 'back' &&
      !population[species] &&
      (accentAttempts[species] ?? 0) < 32 &&
      plantingSeenDepth(outline, x, z) > 0.78
    )
      continue
    const edgeInset =
      plant.habit === 'carpet'
        ? plant.spread * 0.35
        : plant.layer === 'back'
          ? Math.min(radius * 0.55, plant.spread * 0.25)
          : plant.spread * 0.35
    if (plantingEdgeDistance(outline, x, z) < edgeInset) continue
    const sideInset = plant.spread * (plant.habit === 'carpet' ? 0.4 : 0.5)
    if (x < bounds.minX + sideInset || x > bounds.maxX - sideInset) continue
    const gx = Math.floor(x / cell)
    const gz = Math.floor(z / cell)
    let clear = true
    for (let dz = -1; dz <= 1 && clear; dz++) {
      for (let dx = -1; dx <= 1 && clear; dx++) {
        const bucket = buckets.get(`${gx + dx},${gz + dz}`)
        if (!bucket) continue
        for (const other of bucket) {
          if ((other.x - x) ** 2 + (other.z - z) ** 2 < (other.radius + radius) ** 2) {
            clear = false
            break
          }
        }
      }
    }
    // Includes the widest lobe, leaf tips and flower lift at the maximum seeded scale.
    // Crown overlap is allowed between plants, never across paving or a ground break.
    const crownRadius = Math.max(radius, plant.spread * 1.15 * 0.8)
    if (!clear || (accept && !accept(x, z, crownRadius))) continue
    const scale = origin
      ? Math.max(0.85, Math.min(1.15, origin.scale * (0.94 + random() * 0.12)))
      : 0.85 + random() * 0.3
    if (ground.regionAt) {
      const home = ground.regionAt(x, z)
      const reach = Math.max(radius, plant.spread * scale * 0.8)
      for (let side = 0; side < 8; side++) {
        const angle = (side * Math.PI) / 4
        if (ground.regionAt(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach) !== home) {
          clear = false
          break
        }
      }
      if (!clear) continue
    }
    const y = rootHeight(x, z)
    if (!Number.isFinite(y)) continue
    const placement: PlantingPlacement = {
      x,
      z,
      y,
      species,
      layer: plant.layer,
      radius,
      scale,
      seed: hashSeed(node.seed, placements.length, species, 53),
    }
    const key = `${gx},${gz}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(placement)
    else buckets.set(key, [placement])
    if (!clump.length) {
      clumpTarget = plant.habit === 'tuft' ? 1 : 3 + Math.floor(random() * 3)
      clumpFailures = 0
    }
    clump.push(placement)
    population[species] = (population[species] ?? 0) + 1
    placements.push(placement)
    phasePlants++
    failures = 0
  }
  return placements
}
