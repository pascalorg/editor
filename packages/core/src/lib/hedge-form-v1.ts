import {
  foliagePalette,
  foliageTone,
  gridNormals,
  LEAF_ASPECT,
  type LeafLook,
  type MeshWriter,
  type Rgb,
  writeLeaf,
  writeTriangle,
  writeVertex,
} from './foliage'
import {
  HEDGE_MAX_TRIANGLES,
  type HedgeEstimate,
  type HedgeForm,
  type HedgeFormInput,
  type HedgeMesh,
} from './hedge-form'
import { HEDGE_EMBED, type HedgeFootRun, type HedgeFootStation } from './hedge-ground'
import { hedgeEndScale, hedgeLateral, hedgeNormal } from './hedge-line'
import { fractalNoise3, hashSeed, randomStream, valueNoise3 } from './seeded-noise'

/**
 * Generator 1 of the hedge (16 Nov 2026): a first decent form, written to be replaced.
 *
 * A body, then leaves on it. The body is a section swept along the stations: straight battered
 * sides and a flat top with rounded arrises when clipped, a fuller rounded arch when left to
 * grow, with seeded bulges, a height and a width that wander along a loose run, and rounded
 * ends. It is coloured like foliage in shade, darker toward the base. The leaves are small kites
 * (two triangles) scattered over it, shaded mostly by the body's own normal so the mass reads as
 * one soft form, lying close when clipped and standing out when loose; a loose hedge also throws
 * shoots above its top. See `hedge-form.ts` for what a replacement must keep.
 */

/** Leaves a metre of run at the reference section (0.7 m wide, 1.2 m high): about 1,500 triangles a metre with the body. */
const LEAVES_PER_M = 640
const REFERENCE_GIRTH = 3.1
/** No more leaf area than this many times the body's surface: large leaves need fewer. */
const LEAF_COVER = 1.5
const SHOOTS_PER_M = 6
const SHOOT_LEAVES = 3
/** Station steps a mesh: a chunk a camera can cull, about 7 m of a hedge 0.7 m wide. */
const CHUNK_ROWS = 48

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const smooth = (t: number) => t * t * (3 - 2 * t)

/** Columns across the section, bottom of one side over the top to the bottom of the other. */
function columnsOf(input: HedgeFormInput): number {
  const columns = 2 * Math.round((2 * input.height + input.width) / 0.52) + 1
  return Math.min(19, Math.max(11, columns))
}

const cellRowsOf = (run: HedgeFootRun) => (run.ring ? run.stations.length : run.stations.length - 1)
const lengthOf = (run: HedgeFootRun) => run.to - run.from

/** What a hedge of these numbers is given: its columns, and leaves and shoots a metre of run. */
function budgetOf(input: HedgeFormInput) {
  const columns = columnsOf(input)
  let [bodyTriangles, planted] = [0, 0]
  for (const run of input.runs) {
    bodyTriangles += Math.max(0, cellRowsOf(run)) * (columns - 1) * 2
    planted += lengthOf(run)
  }
  const girth = 2 * input.height + input.width
  const leafArea = (input.leafSize * input.leafSize * LEAF_ASPECT) / 2
  const wanted = Math.min(
    LEAVES_PER_M * Math.min(2.2, Math.max(0.6, girth / REFERENCE_GIRTH)),
    (LEAF_COVER * girth) / leafArea,
  )
  const loose = (1 - input.clip) * (1 - input.clip)
  const shoots = SHOOTS_PER_M * loose
  const room = Math.max(0, (HEDGE_MAX_TRIANGLES - bodyTriangles) / 2)
  const asked = (wanted + shoots * SHOOT_LEAVES) * planted
  const share = asked > room ? room / asked : 1
  return { columns, bodyTriangles, leavesPerM: wanted * share, shootsPerM: shoots * share }
}

const leavesOf = (run: HedgeFootRun, perM: number) =>
  cellRowsOf(run) > 0 ? Math.floor(perM * lengthOf(run)) : 0
const shootsOf = (run: HedgeFootRun, perM: number) =>
  cellRowsOf(run) > 0 ? Math.floor(perM * lengthOf(run)) : 0

function estimate(input: HedgeFormInput): HedgeEstimate {
  const { columns, bodyTriangles, leavesPerM, shootsPerM } = budgetOf(input)
  let [leaves, vertices, meshes] = [0, 0, 0]
  for (const run of input.runs) {
    const cellRows = cellRowsOf(run)
    if (cellRows <= 0) continue
    const chunks = Math.ceil(cellRows / CHUNK_ROWS)
    meshes += chunks
    vertices += (cellRows + chunks) * columns
    leaves += leavesOf(run, leavesPerM) + shootsOf(run, shootsPerM) * SHOOT_LEAVES
  }
  return {
    triangles: bodyTriangles + leaves * 2,
    vertices: vertices + leaves * 4,
    bodyTriangles,
    leaves,
    meshes,
  }
}

/**
 * The section, as `columns` points from the foot of one side over the top to the foot of the
 * other, evenly spaced along it: [across, up], each in -1..1 and 0..1 of the half width and the
 * height. Sides and top are straight; the arris between them is a quarter circle of `corner`
 * metres, drawn by the circle's rational form so no sine is taken.
 */
function sectionOf(input: HedgeFormInput, columns: number): Float64Array {
  const half = input.width / 2
  const corner = Math.min(half, input.height) * mix(0.92, 0.22, input.clip)
  const side = input.height - corner
  const arc = 1.5707963267948966 * corner
  const top = half - corner
  const whole = side + arc + top
  const points = new Float64Array(columns * 2)
  for (let j = 0; j < columns; j++) {
    const u = j / (columns - 1)
    const d = (u <= 0.5 ? u : 1 - u) * 2 * whole
    let [across, up] = [-half, d]
    if (d > side + arc) {
      across = -half + corner + (d - side - arc)
      up = input.height
    } else if (d > side) {
      const t = (d - side) / arc
      across = -half + corner - (corner * (1 - t * t)) / (1 + t * t)
      up = side + (corner * 2 * t) / (1 + t * t)
    }
    points[j * 2] = (u <= 0.5 ? across : -across) / half
    points[j * 2 + 1] = up / input.height
  }
  return points
}

function buildRun(input: HedgeFormInput, run: HedgeFootRun, runIndex: number, meshes: HedgeMesh[]) {
  const cellRows = cellRowsOf(run)
  if (cellRows <= 0) return
  const { columns, leavesPerM, shootsPerM } = budgetOf(input)
  const { clip, seed, height, width } = input
  const rows = run.stations.length
  const section = sectionOf(input, columns)
  const palette = foliagePalette(input.leafColor)
  const bulge = mix(0.2, 0.012, clip) * Math.min(1.6, width / 0.7)
  const grain = mix(0.05, 0.012, clip)
  const [heightWander, widthWander] = [0.2 * (1 - clip), 0.25 * (1 - clip) + 0.02]

  // 1. The section at every station, standing on the ground under it.
  const points = new Float64Array(rows * columns * 3)
  const floor = new Float64Array(rows * columns)
  const rise = new Float64Array(rows)
  const taper = new Float64Array(rows)
  for (let i = 0; i < rows; i++) {
    const station = run.stations[i] as HedgeFootStation
    const end = hedgeEndScale(run, station.s, input.endRadius)
    const [endAcross, endUp] = [Math.max(0.02, end), 0.55 + 0.45 * end]
    const tall =
      height *
      (1 + heightWander * valueNoise3(seed, station.x * 0.55, 1.3, station.z * 0.55)) *
      endUp
    const wide =
      (width / 2) *
      (1 + widthWander * valueNoise3(seed, station.x * 0.8, 5.1, station.z * 0.8)) *
      endAcross
    const [nx, nz] = hedgeNormal(station)
    rise[i] = tall
    taper[i] = end
    for (let j = 0; j < columns; j++) {
      const [across, up] = [section[j * 2] as number, section[j * 2 + 1] as number]
      const middle = 1 - (2 * up - 1) * (2 * up - 1)
      const batter = mix(0.78 + 0.3 * middle, 1 - 0.12 * up, clip)
      const lateral = hedgeLateral(station, across * wide * batter)
      const reach = station.half > 1e-6 ? Math.min(1, Math.abs(lateral) / station.half) : 0
      const ground = mix(station.yC, lateral > 0 ? station.yR : station.yL, reach) - HEDGE_EMBED
      const at = (i * columns + j) * 3
      points[at] = station.x + nx * lateral
      points[at + 1] = mix(ground, station.yTop, up) + up * tall
      points[at + 2] = station.z + nz * lateral
      floor[i * columns + j] = ground
    }
  }

  // 2. Bulges and grain along the normal, none at the foot, less over a rounded end.
  let normals = gridNormals(points, rows, columns, run.ring)
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < columns; j++) {
      const at = (i * columns + j) * 3
      const [x, y, z] = [points[at] as number, points[at + 1] as number, points[at + 2] as number]
      const base = floor[i * columns + j] as number
      const push =
        (bulge * fractalNoise3(seed, x * 1.1, y * 1.1, z * 1.1, 2) +
          grain * fractalNoise3(seed + 5, x * 6, y * 6, z * 6, 2)) *
        smooth(clamp01((y - base) / 0.2)) *
        (0.35 + 0.65 * (taper[i] as number))
      points[at] = x + (normals[at] as number) * push
      points[at + 1] = Math.max(base, y + (normals[at + 1] as number) * push)
      points[at + 2] = z + (normals[at + 2] as number) * push
    }
  normals = gridNormals(points, rows, columns, run.ring)

  /** Darker toward the base: the shade a hedge keeps under itself. */
  const shade = (i: number, j: number, y: number) =>
    0.68 +
    0.32 *
      smooth(
        clamp01((y - (floor[i * columns + j] as number)) / (0.75 * (rise[i] as number) + 1e-6)),
      )
  const patch = (x: number, y: number, z: number) =>
    0.5 + 0.5 * valueNoise3(seed + 91, x * 0.9, y * 0.9, z * 0.9)

  // 3. How many leaves stand on each cell: by its share of the run's surface, to the leaf.
  const cells = cellRows * (columns - 1)
  const area = new Float64Array(cells)
  let surface = 0
  for (let i = 0; i < cellRows; i++)
    for (let j = 0; j < columns - 1; j++) {
      const a = (i * columns + j) * 3
      const d = (((i + 1) % rows) * columns + j) * 3
      const [ux, uy, uz] = [
        (points[a + 3] as number) - (points[a] as number),
        (points[a + 4] as number) - (points[a + 1] as number),
        (points[a + 5] as number) - (points[a + 2] as number),
      ]
      const [vx, vy, vz] = [
        (points[d] as number) - (points[a] as number),
        (points[d + 1] as number) - (points[a + 1] as number),
        (points[d + 2] as number) - (points[a + 2] as number),
      ]
      const [cx, cy, cz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
      const size = Math.sqrt(cx * cx + cy * cy + cz * cz)
      area[i * (columns - 1) + j] = size
      surface += size
    }
  const leafTotal = leavesOf(run, leavesPerM)
  const leafCount = new Int32Array(cells)
  let [covered, placed] = [0, 0]
  for (let cell = 0; cell < cells; cell++) {
    covered += area[cell] as number
    const upTo =
      cell === cells - 1 || !(surface > 0) ? leafTotal : Math.floor((leafTotal * covered) / surface)
    leafCount[cell] = Math.max(0, upTo - placed)
    placed += leafCount[cell] as number
  }

  // 4. Shoots above a loose hedge's top: where each one stands is drawn from its own seed.
  const shootTotal = shootsOf(run, shootsPerM)
  const shootRow = new Int32Array(shootTotal)
  for (let q = 0; q < shootTotal; q++)
    shootRow[q] = Math.min(
      cellRows - 1,
      Math.floor(randomStream(hashSeed(seed, runIndex, -7, q))() * cellRows),
    )

  // Clipped, a leaf lies close to the body and keeps its face out; loose, it is larger, leans out
  // and turns about itself, so its face shows from the side as well as from above.
  const leafLook: LeafLook = {
    size: input.leafSize * mix(1.3, 1, clip),
    tiltLow: mix(0.12, 0.05, clip),
    tiltHigh: mix(0.55, 0.22, clip),
    roll: mix(1.8, 0.7, clip),
    lift: mix(0.035, 0.008, clip),
    bodyNormal: mix(0.5, 0.75, clip),
  }
  // A shoot is a tuft of long leaves standing on the top, each rooted in the body.
  const shootLook: LeafLook = {
    size: input.leafSize * 1.9,
    tiltLow: 0.5,
    tiltHigh: 0.9,
    roll: 1.8,
    lift: 0,
    bodyNormal: 0.3,
  }
  // 5. One mesh a chunk of rows; neighbours share the ring of points and normals between them.
  for (let first = 0; first < cellRows; first += CHUNK_ROWS) {
    const chunkRows = Math.min(CHUNK_ROWS, cellRows - first)
    let leaves = 0
    for (let i = first; i < first + chunkRows; i++)
      for (let j = 0; j < columns - 1; j++) leaves += leafCount[i * (columns - 1) + j] as number
    let shoots = 0
    for (let q = 0; q < shootTotal; q++) {
      const row = shootRow[q] as number
      if (row >= first && row < first + chunkRows) shoots++
    }
    leaves += shoots * SHOOT_LEAVES
    const vertices = (chunkRows + 1) * columns + leaves * 4
    const bodyIndexCount = chunkRows * (columns - 1) * 6
    const indices = bodyIndexCount + leaves * 6
    const out: MeshWriter = {
      position: new Float32Array(vertices * 3),
      normal: new Float32Array(vertices * 3),
      color: new Float32Array(vertices * 3),
      index: vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
      vertices: 0,
      indices: 0,
    }
    for (let r = 0; r <= chunkRows; r++) {
      const i = (first + r) % rows
      for (let j = 0; j < columns; j++) {
        const at = (i * columns + j) * 3
        const [x, y, z] = [points[at] as number, points[at + 1] as number, points[at + 2] as number]
        // The body is the shade between the leaves, a little lighter toward the top.
        const lit =
          (0.7 +
            0.5 *
              smooth(
                clamp01((y - (floor[i * columns + j] as number)) / ((rise[i] as number) + 1e-6)),
              )) *
          (0.9 + 0.2 * valueNoise3(seed + 33, x * 7, y * 7, z * 7))
        const tone: Rgb = [palette.shade[0] * lit, palette.shade[1] * lit, palette.shade[2] * lit]
        writeVertex(
          out,
          x,
          y,
          z,
          normals[at] as number,
          normals[at + 1] as number,
          normals[at + 2] as number,
          tone[0],
          tone[1],
          tone[2],
        )
      }
    }
    for (let r = 0; r < chunkRows; r++)
      for (let j = 0; j < columns - 1; j++) {
        const a = r * columns + j
        const d = a + columns
        writeTriangle(out, a, a + 1, d + 1)
        writeTriangle(out, a, d + 1, d)
      }
    for (let r = 0; r < chunkRows; r++) {
      const i = first + r
      const next = (i + 1) % rows
      for (let j = 0; j < columns - 1; j++) {
        const count = leafCount[i * (columns - 1) + j] as number
        if (!count) continue
        const random = randomStream(hashSeed(seed, runIndex, i, j))
        const corners = [
          (i * columns + j) * 3,
          (i * columns + j + 1) * 3,
          (next * columns + j + 1) * 3,
          (next * columns + j) * 3,
        ] as const
        for (let n = 0; n < count; n++) {
          // Not on the very foot: a leaf there would lie in the ground.
          const [u, v] = [
            random(),
            j === 0 ? 0.2 + 0.8 * random() : j === columns - 2 ? 0.8 * random() : random(),
          ]
          const weights = [(1 - u) * (1 - v), (1 - u) * v, u * v, u * (1 - v)]
          const point: Rgb = [0, 0, 0]
          const normal: Rgb = [0, 0, 0]
          corners.forEach((corner, c) => {
            const weight = weights[c] as number
            for (let axis = 0; axis < 3; axis++) {
              point[axis] = (point[axis] as number) + (points[corner + axis] as number) * weight
              normal[axis] = (normal[axis] as number) + (normals[corner + axis] as number) * weight
            }
          })
          const d =
            Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]) || 1
          normal[0] /= d
          normal[1] /= d
          normal[2] /= d
          const tone = clamp01(0.15 + 0.42 * random() + 0.4 * patch(point[0], point[1], point[2]))
          writeLeaf(
            out,
            random,
            leafLook,
            point,
            normal,
            foliageTone(palette, tone, shade(i, j, point[1])),
          )
        }
      }
    }
    for (let q = 0; q < shootTotal; q++) {
      const row = shootRow[q] as number
      if (row < first || row >= first + chunkRows) continue
      const random = randomStream(hashSeed(seed, runIndex, -7, q))
      random()
      const column = Math.round(mix(0.3, 0.7, random()) * (columns - 1))
      const at = (row * columns + column) * 3
      const [nx, nz] = [normals[at] as number, normals[at + 2] as number]
      for (let n = 0; n < SHOOT_LEAVES; n++) {
        // Up, leaning a little its own way and away from the body.
        let [ux, uy, uz] = [nx * 0.4 + (random() - 0.5) * 0.7, 1, nz * 0.4 + (random() - 0.5) * 0.7]
        const d = Math.sqrt(ux * ux + uy * uy + uz * uz)
        ux /= d
        uy /= d
        uz /= d
        const point: Rgb = [
          (points[at] as number) + (random() - 0.5) * 0.06,
          (points[at + 1] as number) - 0.01,
          (points[at + 2] as number) + (random() - 0.5) * 0.06,
        ]
        writeLeaf(
          out,
          random,
          shootLook,
          point,
          [ux, uy, uz],
          foliageTone(palette, 0.8 + 0.2 * random(), 1),
        )
      }
    }
    meshes.push({
      position: out.position,
      normal: out.normal,
      color: out.color,
      index: out.index,
      bodyIndexCount,
    })
  }
}

export const hedgeFormV1: HedgeForm = {
  gen: 1,
  estimate,
  build: (input) => {
    const meshes: HedgeMesh[] = []
    input.runs.forEach((run, index) => {
      buildRun(input, run, index, meshes)
    })
    return meshes
  },
}
