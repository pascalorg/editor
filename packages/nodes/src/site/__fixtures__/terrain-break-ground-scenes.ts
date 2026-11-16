import {
  createTerrainField,
  encodeTerrainField,
  persistedTerrainFieldOf,
  type TerrainField,
  tileFieldOf,
} from '@pascal-app/core'
import { SiteNode, TerrainBreakNode, TerrainTileNode } from '@pascal-app/core/schema'

type Point = [number, number]
type Break = { line: Point[]; left: number | 'ground'; right: number | 'ground' }

/** Rolling ground with a fall, in whole centimetres: no plane, so a normal has something to say. */
export const rollingGround = (x: number, z: number) =>
  Math.round((0.08 * x + 0.05 * z + 0.6 * Math.sin(x / 3) * Math.cos(z / 4)) * 100) / 100

function tile(ix: number, iz: number, ground: (x: number, z: number) => number) {
  const field = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
  for (let row = 0; row < 65; row++)
    for (let col = 0; col < 65; col++)
      field.heights[row * 65 + col] = Math.round(ground(ix * 32 + col * 0.5, iz * 32 + row * 0.5) * 100)
  return TerrainTileNode.parse({
    id: `terrain-tile_x${ix + 1}z${iz + 1}`,
    parentId: 'site_break_ground',
    ix,
    iz,
    level: 0,
    step: 0.01,
    heights: encodeTerrainField(field).heights,
  })
}

/** A `w` by `d` rectangle about (cx, cz), turned by `degrees`, counter-clockwise and closed. */
export function turnedRing(cx: number, cz: number, w: number, d: number, degrees: number): Point[] {
  const a = (degrees * Math.PI) / 180
  const ring = (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as Point[]
  ).map(
    ([x, z]): Point => [
      Math.round((cx + x * Math.cos(a) - z * Math.sin(a)) * 1000) / 1000,
      Math.round((cz + x * Math.sin(a) + z * Math.cos(a)) * 1000) / 1000,
    ],
  )
  return [...ring, ring[0] as Point]
}

export type BreakGroundScene = {
  name: string
  site: SiteNode
  nodes: Record<string, SiteNode | TerrainTileNode | TerrainBreakNode>
  field: TerrainField
  /** The four tiles about the origin: [-1,-1], [0,-1], [-1,0], [0,0]. */
  grids: { key: string; grid: TerrainField }[]
  breaks: TerrainBreakNode[]
}

/** A 24 m lot on four tiles of rolling ground, with the given breaks. */
export function breakGroundScene(
  name: string,
  shapes: Break[],
  ground: (x: number, z: number) => number = rollingGround,
): BreakGroundScene {
  const tiles = [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ].map(([ix, iz]) => tile(ix as number, iz as number, ground))
  const breaks = shapes.map((shape, index) =>
    TerrainBreakNode.parse({
      id: `terrain-break_${name.replace(/[^a-z0-9]/g, '')}${index}`,
      parentId: 'site_break_ground',
      kind: 'retaining',
      ...shape,
    }),
  )
  const site = SiteNode.parse({
    id: 'site_break_ground',
    children: [...tiles, ...breaks].map((node) => node.id),
    polygon: {
      type: 'polygon',
      points: [
        [-12, -12],
        [12, -12],
        [12, 12],
        [-12, 12],
      ],
    },
  })
  const nodes = Object.fromEntries([site, ...tiles, ...breaks].map((node) => [node.id, node]))
  const field = persistedTerrainFieldOf(site, nodes)
  if (!field) throw new Error(`No ground for ${name}`)
  return {
    name,
    site,
    nodes,
    field,
    breaks,
    grids: tiles.map((node) => ({ key: node.id, grid: tileFieldOf(node) as TerrainField })),
  }
}

/**
 * The shapes a break can take against the grid. Breaks may not touch or cross and an open break
 * is one straight line across the whole site, so "a T" is a ring standing 0.3 m off a line (their
 * two faces inside one cell) and "a break that ends inside a tile" is a ring wholly inside one.
 */
export const BREAK_GROUND_SHAPES: Record<string, Break[]> = {
  'one straight break, oblique': [
    {
      line: [
        [-12, -9.3],
        [12, 7.1],
      ],
      left: 'ground',
      right: -0.5,
    },
  ],
  'one closed ring across the tile seams': [
    { line: turnedRing(0.7, -0.4, 7, 4.5, 30), left: 1.2, right: 'ground' },
  ],
  'a ring standing off a straight break (a T that does not touch)': [
    {
      line: [
        [-12, 2.2],
        [12, 2.2],
      ],
      left: 2.5,
      right: 'ground',
    },
    { line: turnedRing(3.1, -0.65, 4, 5.1, 0), left: -0.8, right: 'ground' },
  ],
  'a ring that ends inside one tile': [
    { line: turnedRing(6.3, 5.8, 3, 2, 20), left: 0.9, right: 'ground' },
  ],
  'a straight break on the tile seam': [
    {
      line: [
        [0, -12],
        [0, 12],
      ],
      left: 'ground',
      right: 0.8,
    },
  ],
}
