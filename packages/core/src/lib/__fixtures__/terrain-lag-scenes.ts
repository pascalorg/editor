import {
  AnyNode,
  SiteNode,
  TerrainBreakNode,
  TerrainTileNode,
} from '../../schema'
import { encodeTerrainField } from '../terrain-codec'
import { createTerrainField, type TerrainField } from '../terrain-field'

/*
 * Scenes shaped like a large graded site (24 tiles, five retaining breaks), small enough
 * for a test: a 35 × 50 m lot on 3 × 3 tiles of 32 m, graded between −6 and 0 m with a gentle
 * noise, and breaks of each kind the authority supports. Deterministic: no random source, so the
 * heights an old build read are the heights this file reads.
 */

type Point = [number, number]
export type TerrainLagScene = {
  name: string
  site: SiteNode
  nodes: Record<string, AnyNode>
  rings: Point[][]
  open: Point[] | null
}

const LOT: Point[] = [
  [-17.5, -25],
  [17.5, -25],
  [17.5, 25],
  [-17.5, 25],
]

const noise = (a: number, b: number) => {
  let h = (Math.imul(a + 1013, 374761393) ^ Math.imul(b + 7919, 668265263)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

let roughness = 0.05
let plateau = 0

const groundHeight = (x: number, z: number) =>
  -3 +
  2.6 * Math.sin(x / 9) * Math.cos(z / 7) -
  0.4 * Math.sin((x + z) / 3.1) +
  roughness * noise(Math.round(x * 2), Math.round(z * 2)) +
  (plateau && x >= 0 && x < 32 && z >= 0 && z < 32 ? plateau : 0)

function tileHeights(ix: number, iz: number): TerrainField {
  const field = createTerrainField({ origin: [ix * 32, iz * 32], spacing: 0.5, cols: 65, rows: 65, step: 0.01 })
  for (let row = 0; row < 65; row++)
    for (let col = 0; col < 65; col++)
      field.heights[row * 65 + col] = Math.round(
        groundHeight(ix * 32 + col * 0.5, iz * 32 + row * 0.5) / field.step,
      )
  return field
}

const ring = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
  [x0, z0],
]

export const RING_A = ring(-8.7, -5.5, -1.65, 4.45)
export const RING_B = ring(-6, 12, 11, 20)
export const RING_C = ring(11.2, 5.6, 14.8, 8.4)
export const OPEN_LINE: Point[] = [
  [4, -40],
  [4, 40],
]

export function terrainLagScene(
  name: string,
  options: {
    tiles?: boolean
    legacy?: boolean
    breaks?: { line: Point[]; left: number | 'ground'; right: number | 'ground' }[]
    /** Sample-to-sample noise in metres (default 0.05); the owner's graded ground is smooth. */
    roughness?: number
    /** A step in metres on the tile whose x and z are 0..32 (default none): a cliff on its borders. */
    plateau?: number
  } = {},
): TerrainLagScene {
  const { tiles = true, legacy = false, breaks = [] } = options
  roughness = options.roughness ?? 0.05
  plateau = options.plateau ?? 0
  const siteId = 'site_lag'
  const tileNodes = tiles
    ? [-1, 0, 1].flatMap((iz) =>
        [-1, 0, 1].map((ix) =>
          TerrainTileNode.parse({
            id: `terrain-tile_${ix + 1}_${iz + 1}`,
            parentId: siteId,
            ix,
            iz,
            level: 0,
            step: 0.01,
            heights: encodeTerrainField(tileHeights(ix, iz)).heights,
          }),
        ),
      )
    : []
  const breakNodes = breaks.map((entry, index) =>
    TerrainBreakNode.parse({
      id: `terrain-break_${index}`,
      parentId: siteId,
      kind: 'retaining',
      line: entry.line,
      left: entry.left,
      right: entry.right,
    }),
  )
  let terrain: ReturnType<typeof encodeTerrainField> | undefined
  if (legacy) {
    const base = createTerrainField({ origin: [-16, -16], spacing: 0.5, cols: 65, rows: 65, step: 0.01 })
    for (let row = 0; row < 65; row++)
      for (let col = 0; col < 65; col++)
        base.heights[row * 65 + col] = Math.round(groundHeight(-16 + col * 0.5, -16 + row * 0.5) / 0.01)
    terrain = encodeTerrainField(base)
  }
  const site = SiteNode.parse({
    id: siteId,
    polygon: { type: 'polygon', points: LOT },
    children: [...tileNodes, ...breakNodes].map((node) => node.id),
    ...(terrain ? { terrain } : {}),
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [site, ...tileNodes, ...breakNodes].map((node) => [node.id, node]),
  )
  return {
    name,
    site,
    nodes,
    rings: breaks.filter((entry) => entry.line[0]?.join() === entry.line.at(-1)?.join()).map((entry) => entry.line),
    open: breaks.find((entry) => entry.line[0]?.join() !== entry.line.at(-1)?.join())?.line ?? null,
  }
}

/** The scenes the equality tests and the profile read. */
export function terrainLagScenes(): TerrainLagScene[] {
  return [
    terrainLagScene('tiles only', {}),
    terrainLagScene('three rings, ground outside', {
      breaks: [
        { line: RING_A, left: -3.8, right: 'ground' },
        { line: RING_B, left: -4.7, right: 'ground' },
        { line: RING_C, left: -3.6, right: 'ground' },
      ],
    }),
    terrainLagScene('open break', { breaks: [{ line: OPEN_LINE, left: 2, right: 'ground' }] }),
    terrainLagScene('open break, ground on its left', {
      breaks: [{ line: OPEN_LINE, left: 'ground', right: -2.5 }],
    }),
    terrainLagScene('one ring, numeric both sides', {
      breaks: [{ line: RING_B, left: -4.7, right: 1.2 }],
    }),
    terrainLagScene('legacy only', { tiles: false, legacy: true }),
    terrainLagScene('legacy and a ring', {
      tiles: false,
      legacy: true,
      breaks: [{ line: RING_A, left: -3.8, right: 'ground' }],
    }),
    terrainLagScene('legacy, tiles and rings', {
      legacy: true,
      breaks: [
        { line: RING_A, left: -3.8, right: 'ground' },
        { line: RING_C, left: -3.6, right: 'ground' },
      ],
    }),
  ]
}

/** Sample points: a lattice over the lot and beyond, every tile edge, and both sides of each break. */
export function terrainLagPoints(scene: TerrainLagScene): [number, number][] {
  const points: [number, number][] = []
  for (let x = -44; x <= 44; x += 5.3) for (let z = -44; z <= 44; z += 5.3) points.push([x, z])
  for (const t of [-48, -32, 0, 32, 48]) for (let s = -30; s <= 30; s += 7.7) points.push([t, s], [s, t])
  const far: Point[] = [
    [-90, 0],
    [90, 30],
    [0, -100],
    [0, 130],
    [-130, 140],
    [70, -70],
  ]
  points.push(...far)
  const lines = [...scene.rings, ...(scene.open ? [scene.open] : [])]
  for (const line of lines)
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i] as Point
      const b = line[i + 1] as Point
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      const nx = (b[1] - a[1]) / length
      const nz = -(b[0] - a[0]) / length
      for (const u of [0, 0.13, 0.5, 0.87, 1])
        for (const d of [-1.7, -0.5, -0.12, 0, 0.12, 0.5, 1.7]) {
          const x = a[0] + (b[0] - a[0]) * u
          const z = a[1] + (b[1] - a[1]) * u
          points.push([x + nx * d, z + nz * d])
        }
    }
  return points
}
