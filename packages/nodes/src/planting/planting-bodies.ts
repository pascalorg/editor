import {
  type PlantingPlacement,
  type PlantingSpecies,
  type Rgb,
  randomStream,
  valueNoise3,
} from '@pascal-app/core'
import {
  foliagePalette,
  foliageTone,
  type LeafLook,
  linearColor,
  type MeshWriter,
  writeLeaf,
  writeTriangle,
  writeVertex,
} from '../shared/foliage'

const SIDES = 12
const RINGS = 6
const STEMS = 18
const BLADES = 28
const SEGMENTS = 4

function unit(x: number, y: number, z: number): Rgb {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function shell(
  plant: PlantingSpecies,
  placement: PlantingPlacement,
  angle: number,
  t: number,
): { point: Rgb; normal: Rgb } {
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  // Spread names the mature crown, not an exclusion disk around a shrunken body.
  // Leave a small allowance for the cards that finish the approximately half-spread shell.
  const radius = plant.spread * placement.scale * (plant.habit === 'carpet' ? 0.48 : 0.46)
  // Neighbouring crowns share a spread scale to touch, not a uniform top elevation.
  const stature =
    plant.layer === 'back' && plant.habit === 'mound'
      ? 0.8 + 0.4 * ((placement.seed >>> 8) / 0xffffff)
      : placement.scale
  const height = plant.height * stature * (plant.habit === 'spike' ? 0.38 : 1)
  const ball = plant.habit === 'ball'
  const vertical = ball ? -0.82 + t * 1.82 : t
  // A carpet keeps a broad, low shoulder instead of reading as a scaled shrub.
  const radial =
    plant.habit === 'carpet'
      ? Math.sqrt(Math.max(0, 1 - t * t * t * t))
      : Math.sqrt(Math.max(0, 1 - vertical * vertical))
  const noise = valueNoise3(placement.seed, dx * 1.7, t * 2.4, dz * 1.7)
  const carpet = plant.habit === 'carpet'
  const phase = placement.seed % 31
  const lobe = carpet ? 0.11 * Math.sin(angle * 2 + phase) + 0.07 * Math.sin(angle * 3 - phase) : 0
  const lump = 1 + ((ball ? 0.08 : 0.22) * noise + lobe) * (1 - t * 0.65)
  const r = radius * radial * lump
  // The root and the apex stay fixed while the middle of the crown has gentle seeded lobes.
  const y = height * t * (1 + (carpet ? 0.4 : 0.18) * noise * (1 - t))
  return {
    point: [placement.x + dx * r, placement.y + y, placement.z + dz * r],
    normal: unit(
      (dx * radial) / radius,
      (plant.habit === 'carpet' ? 2 * t * t * t : vertical) / (ball ? height / 1.82 : height),
      (dz * radial) / radius,
    ),
  }
}

function shellBody(out: MeshWriter, plant: PlantingSpecies, placement: PlantingPlacement) {
  const palette = foliagePalette(plant.leafColor)
  const tone = 0.9 + 0.2 * valueNoise3(placement.seed, 3, 7, 1)
  const base = out.vertices
  for (let row = 0; row < RINGS; row++) {
    const t = row / RINGS
    for (let column = 0; column < SIDES; column++) {
      const { point, normal } = shell(plant, placement, (column * 2 * Math.PI) / SIDES, t)
      // A dark leafy interior beneath the cards, not a smooth sage-coloured stone.
      const color: Rgb = [
        palette.mid[0] * (0.23 + t * 0.09) * tone,
        palette.mid[1] * (0.23 + t * 0.09) * tone,
        palette.mid[2] * (0.23 + t * 0.09) * tone,
      ]
      writeVertex(out, ...point, ...normal, ...color)
    }
  }
  const { point } = shell(plant, placement, 0, 1)
  const top = writeVertex(
    out,
    ...point,
    0,
    1,
    0,
    palette.mid[0] * 0.32 * tone,
    palette.mid[1] * 0.32 * tone,
    palette.mid[2] * 0.32 * tone,
  )
  for (let row = 0; row + 1 < RINGS; row++) {
    for (let column = 0; column < SIDES; column++) {
      const a = base + row * SIDES + column
      const b = base + row * SIDES + ((column + 1) % SIDES)
      const c = b + SIDES
      const d = a + SIDES
      writeTriangle(out, a, d, c)
      writeTriangle(out, a, c, b)
    }
  }
  for (let column = 0; column < SIDES; column++)
    writeTriangle(
      out,
      base + (RINGS - 1) * SIDES + column,
      top,
      base + (RINGS - 1) * SIDES + ((column + 1) % SIDES),
    )
}

function spikeStem(plant: PlantingSpecies, placement: PlantingPlacement, random: () => number) {
  const angle = random() * 2 * Math.PI
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  const h = plant.height * placement.scale
  const reach = plant.spread * placement.scale * (0.08 + 0.2 * random())
  const high = h * (0.6 + 0.4 * random())
  return {
    bottom: [
      placement.x + dx * reach * 0.3,
      placement.y + h * 0.18,
      placement.z + dz * reach * 0.3,
    ] as Rgb,
    top: [placement.x + dx * reach, placement.y + high, placement.z + dz * reach] as Rgb,
    side: [-dz, 0, dx] as Rgb,
    normal: unit(dx, 0.12, dz),
  }
}

function spikeBody(out: MeshWriter, plant: PlantingSpecies, placement: PlantingPlacement) {
  const random = randomStream(placement.seed + 37)
  const color = foliageTone(foliagePalette(plant.leafColor), 0.35, 0.85)
  for (let stem = 0; stem < STEMS; stem++) {
    const { bottom, top, side, normal } = spikeStem(plant, placement, random)
    const width = Math.min(0.006, plant.spread * 0.012)
    const first = out.vertices
    for (const [point, sign] of [
      [bottom, -1],
      [bottom, 1],
      [top, 1],
      [top, -1],
    ] as const)
      writeVertex(
        out,
        point[0] + side[0] * width * sign,
        point[1],
        point[2] + side[2] * width * sign,
        ...normal,
        ...color,
      )
    writeTriangle(out, first, first + 1, first + 2)
    writeTriangle(out, first, first + 2, first + 3)
  }
}

function tuftBody(out: MeshWriter, plant: PlantingSpecies, placement: PlantingPlacement) {
  const random = randomStream(placement.seed + 73)
  const palette = foliagePalette(plant.leafColor)
  const radius = plant.spread * placement.scale * 0.62
  for (let blade = 0; blade < BLADES; blade++) {
    const angle = random() * Math.PI * 2
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    const height = plant.height * placement.scale * (0.7 + 0.3 * random())
    const reach = radius * (0.65 + 0.35 * random())
    const droop = 0.42 + 0.16 * random()
    const width = Math.min(0.022, Math.max(0.004, plant.spread * 0.024)) * (0.7 + 0.6 * random())
    const first = out.vertices
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const t = segment / SEGMENTS
      const r = reach * (0.07 + 0.93 * t * t)
      const y = height * 1.6 * (t - droop * t * t * t)
      const normal = unit(
        -dx * height * 1.6 * (1 - 3 * droop * t * t),
        1.86 * reach * t,
        -dz * height * 1.6 * (1 - 3 * droop * t * t),
      )
      const tone = foliageTone(palette, 0.25 + 0.6 * t, 0.7 + 0.3 * t)
      const w = width * (1 - 0.97 * t)
      for (const sign of [-1, 1])
        writeVertex(
          out,
          placement.x + dx * r - dz * w * sign,
          placement.y + y,
          placement.z + dz * r + dx * w * sign,
          ...normal,
          ...tone,
        )
      if (segment) {
        const a = first + (segment - 1) * 2
        writeTriangle(out, a, a + 1, a + 3)
        writeTriangle(out, a, a + 3, a + 2)
      }
    }
  }
}

export function writePlantingBody(
  out: MeshWriter,
  plant: PlantingSpecies,
  placement: PlantingPlacement,
) {
  if (plant.habit === 'tuft') tuftBody(out, plant, placement)
  else {
    shellBody(out, plant, placement)
    if (plant.habit === 'spike') spikeBody(out, plant, placement)
  }
}

/** The shared leaf writer brightens its tip by 10%; retain linear RGB in the agreed 0..1 range. */
function leafColor(color: Rgb): Rgb {
  return [Math.min(1 / 1.1, color[0]), Math.min(1 / 1.1, color[1]), Math.min(1 / 1.1, color[2])]
}

/** Four kite-shaped faces: the same 16 vertices/eight triangles as four budgeted detail cards. */
function flowerSpindle(
  out: MeshWriter,
  stem: ReturnType<typeof spikeStem>,
  length: number,
  radius: number,
  color: Rgb,
) {
  const direction = unit(
    stem.top[0] - stem.bottom[0],
    stem.top[1] - stem.bottom[1],
    stem.top[2] - stem.bottom[2],
  )
  const u = stem.side
  const v = unit(
    direction[1] * u[2],
    direction[2] * u[0] - direction[0] * u[2],
    -direction[1] * u[0],
  )
  const bottom: Rgb = [
    stem.top[0] - direction[0] * length,
    stem.top[1] - direction[1] * length,
    stem.top[2] - direction[2] * length,
  ]
  const center: Rgb = [
    bottom[0] + direction[0] * length * 0.4,
    bottom[1] + direction[1] * length * 0.4,
    bottom[2] + direction[2] * length * 0.4,
  ]
  const ring = (angle: number): Rgb => [
    center[0] + radius * (u[0] * Math.cos(angle) + v[0] * Math.sin(angle)),
    center[1] + radius * (u[1] * Math.cos(angle) + v[1] * Math.sin(angle)),
    center[2] + radius * (u[2] * Math.cos(angle) + v[2] * Math.sin(angle)),
  ]
  for (let side = 0; side < 4; side++) {
    const a = (side * Math.PI) / 2
    const b = ((side + 1) * Math.PI) / 2
    const normal = unit(
      u[0] * Math.cos((a + b) / 2) + v[0] * Math.sin((a + b) / 2),
      0.25,
      u[2] * Math.cos((a + b) / 2) + v[2] * Math.sin((a + b) / 2),
    )
    const first = out.vertices
    writeVertex(out, ...bottom, ...normal, color[0] * 0.7, color[1] * 0.7, color[2] * 0.7)
    writeVertex(out, ...ring(b), ...normal, ...color)
    writeVertex(
      out,
      ...stem.top,
      ...normal,
      Math.min(1, color[0] * 1.1),
      Math.min(1, color[1] * 1.1),
      Math.min(1, color[2] * 1.1),
    )
    writeVertex(out, ...ring(a), ...normal, ...color)
    writeTriangle(out, first, first + 1, first + 2)
    writeTriangle(out, first, first + 2, first + 3)
  }
}

/** Emit exactly `count` two-triangle cards, including optional flower dots, after all bodies. */
export function writePlantingDetail(
  out: MeshWriter,
  plant: PlantingSpecies,
  placement: PlantingPlacement,
  count: number,
) {
  const random = randomStream(placement.seed + 101)
  const palette = foliagePalette(plant.leafColor)
  const flower = plant.flowerColor ? linearColor(plant.flowerColor) : null
  const tone = valueNoise3(placement.seed, 3, 7, 1)
  const flowerShare = flower
    ? plant.habit === 'tuft'
      ? 1
      : plant.habit === 'spike'
        ? 0.35
        : 0.1
    : 0
  const flowers =
    plant.habit === 'spike'
      ? 4 * Math.min(STEMS, Math.floor((count * flowerShare) / 4))
      : Math.floor(count * flowerShare)
  const leafSize =
    Math.min(0.085, plant.spread * (plant.habit === 'carpet' ? 0.09 : 0.14)) *
    placement.scale *
    (plant.habit === 'mound' && plant.layer === 'mid' ? 0.68 : 0.8)
  const look: LeafLook = {
    size: leafSize,
    tiltLow: 0.1,
    tiltHigh: 0.55,
    roll: 1.4,
    lift: Math.min(0.025, plant.spread * 0.02) * placement.scale,
    bodyNormal: 0.6,
  }
  for (let leaf = 0; leaf < count - flowers; leaf++) {
    const angle = random() * 2 * Math.PI
    const t = 0.04 + random() * 0.94
    const { point, normal } = shell(plant, placement, angle, t)
    writeLeaf(
      out,
      random,
      look,
      point,
      normal,
      leafColor(
        foliageTone(
          palette,
          plant.habit === 'carpet'
            ? 0.18 + 0.42 * random() + 0.12 * tone
            : 0.2 + 0.6 * random() + 0.08 * tone,
          0.68 + 0.32 * t,
        ),
      ),
    )
  }
  const flowerLook: LeafLook = {
    size: Math.min(0.05, leafSize * 0.85),
    tiltLow: 0.7,
    tiltHigh: 1,
    roll: 1.6,
    lift: Math.min(0.025, plant.spread * 0.04),
    bodyNormal: 0.35,
  }
  const stemRandom = randomStream(placement.seed + 37)
  if (plant.habit === 'spike') {
    for (let head = 0; head < flowers / 4; head++) {
      const stem = spikeStem(plant, placement, stemRandom)
      flowerSpindle(
        out,
        stem,
        plant.height * placement.scale * 0.125,
        Math.min(0.016, plant.spread * 0.03) * placement.scale,
        flower as Rgb,
      )
    }
    return
  }
  for (let dot = 0; dot < flowers; dot++) {
    const { point, normal } = shell(plant, placement, random() * Math.PI * 2, 0.4 + 0.55 * random())
    // Flower stalks lift the small dots above the leafy envelope, rather than burying them in it.
    point[0] += normal[0] * leafSize * 0.75
    point[1] += normal[1] * leafSize * 0.75
    point[2] += normal[2] * leafSize * 0.75
    const color = leafColor(flower as Rgb)
    writeLeaf(out, random, flowerLook, point, normal, color)
  }
}
