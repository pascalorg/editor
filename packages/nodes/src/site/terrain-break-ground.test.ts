import { afterAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  applyHeightPatch,
  createTerrainField,
  normalAt,
  type TerrainField,
  terrainEditField,
  terrainPreviewField,
} from '@pascal-app/core'
import golden from './__fixtures__/terrain-break-ground-golden.json'
import {
  BREAK_GROUND_SHAPES,
  type BreakGroundScene,
  breakGroundScene,
  turnedRing,
} from './__fixtures__/terrain-break-ground-scenes'
import { getTerrainBreakGround, setTerrainBreakGround } from './terrain-break-split'
import type { TerrainMeshBuffers } from './terrain-geometry'
import {
  buildTerrainGroundMesh,
  groundMeshInReach,
  terrainFieldBounds,
  updateTerrainGroundMesh,
} from './terrain-ground'

/*
 * The ground beside a terrain break (`setTerrainBreakGround`). Faceted is the first build and the
 * default: it must stay the buffers the commit before this switch produced, hash for hash. Smooth
 * must be the same surface (every height the faceted build drew, the same break edges), shaded
 * with each side's own normals, the same along a tile seam, and the same after a live stroke as
 * after a rebuild.
 */

const initial = getTerrainBreakGround()
afterAll(() => setTerrainBreakGround(initial))

const hash = (array: ArrayBufferView) =>
  createHash('sha256')
    .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex')
    .slice(0, 24)

type Built = { key: string; grid: TerrainField; mesh: TerrainMeshBuffers }

function build(scene: BreakGroundScene, ground: 'faceted' | 'smooth'): Built[] {
  setTerrainBreakGround(ground)
  try {
    return scene.grids.map(({ key, grid }) => ({
      key,
      grid,
      mesh: buildTerrainGroundMesh(grid, scene.field, []),
    }))
  } finally {
    setTerrainBreakGround(initial)
  }
}

const scenes = Object.entries(BREAK_GROUND_SHAPES).map(([name, shapes]) =>
  breakGroundScene(name, shapes),
)
const plain = breakGroundScene('no break', [])

/** The distance in plan from a point to the nearest break line (an open break is its whole line). */
function toBreaks(scene: BreakGroundScene, x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const { line } of scene.breaks) {
    const closed = line[0]?.[0] === line.at(-1)?.[0] && line[0]?.[1] === line.at(-1)?.[1]
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1] as [number, number]
      const [bx, bz] = line[i] as [number, number]
      const length2 = (bx - ax) ** 2 + (bz - az) ** 2
      let t = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / length2
      if (closed) t = Math.max(0, Math.min(1, t))
      nearest = Math.min(nearest, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)))
    }
  }
  return nearest
}

/** The height of a mesh's surface over a plan point, read from the triangle that holds it. */
function surfaceReader(mesh: TerrainMeshBuffers) {
  const cells = new Map<number, number[]>()
  const cell = (x: number, z: number) => Math.floor(x * 2) * 100_003 + Math.floor(z * 2)
  const P = mesh.positions
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => (mesh.indices[t + k] as number) * 3) as [
      number,
      number,
      number,
    ]
    const xs = [P[a], P[b], P[c]] as number[]
    const zs = [P[a + 2], P[b + 2], P[c + 2]] as number[]
    for (let x = Math.floor(Math.min(...xs) * 2); x <= Math.floor(Math.max(...xs) * 2); x++)
      for (let z = Math.floor(Math.min(...zs) * 2); z <= Math.floor(Math.max(...zs) * 2); z++) {
        const key = x * 100_003 + z
        const list = cells.get(key)
        if (list) list.push(t)
        else cells.set(key, [t])
      }
  }
  return (x: number, z: number): number[] => {
    const found: number[] = []
    for (const t of cells.get(cell(x, z)) ?? []) {
      const [a, b, c] = [0, 1, 2].map((k) => (mesh.indices[t + k] as number) * 3) as [
        number,
        number,
        number,
      ]
      const ax = P[a] as number
      const az = P[a + 2] as number
      const bx = P[b] as number
      const bz = P[b + 2] as number
      const cx = P[c] as number
      const cz = P[c + 2] as number
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(det) < 1e-12) continue
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue
      found.push(
        u * (P[a + 1] as number) + v * (P[b + 1] as number) + (1 - u - v) * (P[c + 1] as number),
      )
    }
    return found
  }
}

describe('faceted, the default, is the build before the switch', () => {
  for (const scene of scenes)
    test(`${scene.name}: positions, normals, uvs and indices, hash for hash`, () => {
      const read = build(scene, 'faceted').map(({ key, mesh }) => ({
        key,
        positions: hash(mesh.positions),
        normals: hash(mesh.normals),
        uvs: hash(mesh.uvs),
        indices: hash(mesh.indices),
        verts: mesh.positions.length / 3,
        tris: mesh.indices.length / 3,
      }))
      expect(read).toEqual((golden as Record<string, typeof read>)[scene.name] as typeof read)
    })

  test('breaks that touch are refused by the core, so no scene holds a true T', () => {
    expect(() =>
      breakGroundScene('touching', [
        {
          line: [
            [-12, 2.2],
            [12, 2.2],
          ],
          left: 2.5,
          right: 'ground',
        },
        { line: turnedRing(3, -0.3, 4, 5, 0), left: -0.8, right: 'ground' },
      ]),
    ).toThrow('Terrain breaks may not cross, touch')
  })
})

describe('smooth is the same surface with each side’s own normals', () => {
  test('a tile no break cuts is the shared grid again, and a cut one adds only its pieces', () => {
    const scene = scenes.find(({ name }) => name === 'a ring that ends inside one tile')
    if (!scene) throw new Error('Missing scene')
    const count = (built: Built[]) =>
      built.map(({ mesh }) => [mesh.positions.length / 3, mesh.indices.length / 3])
    const faceted = count(build(scene, 'faceted'))
    const smooth = count(build(scene, 'smooth'))
    // 65 x 65 samples and two triangles a cell: the ring stands in the fourth tile alone, yet
    // the faceted build cut the other three along the extensions of its sides.
    expect(smooth.slice(0, 3)).toEqual([
      [4225, 8192],
      [4225, 8192],
      [4225, 8192],
    ])
    expect(faceted.every(([vertices, triangles]) => vertices === (triangles as number) * 3)).toBe(
      true,
    )
    expect((smooth[3] as number[])[0]).toBeLessThan(4225 * 1.2)
    expect((faceted[3] as number[])[0]).toBeGreaterThan(4225 * 5)
  })

  for (const scene of scenes) {
    const faceted = build(scene, 'faceted')
    const smooth = build(scene, 'smooth')

    test(`${scene.name}: every height the faceted build drew is on the smooth surface`, () => {
      let checked = 0
      let uncovered = 0
      let worst = 0
      faceted.forEach(({ mesh: old }, tile) => {
        const read = surfaceReader((smooth[tile] as Built).mesh)
        const P = old.positions
        for (let t = 0; t < old.indices.length; t += 3) {
          const corners = [0, 1, 2].map((k) => (old.indices[t + k] as number) * 3)
          const centre = [0, 1, 2].map(
            (axis) => corners.reduce((sum, i) => sum + (P[i + axis] as number), 0) / 3,
          ) as [number, number, number]
          // Each corner, drawn a hair into its own triangle so the point has one region.
          for (const i of corners) {
            const at = [0, 1, 2].map(
              (axis) => (P[i + axis] as number) + (centre[axis] - (P[i + axis] as number)) * 1e-3,
            ) as [number, number, number]
            const heights = read(at[0], at[2])
            if (!heights.length) uncovered++
            else worst = Math.max(worst, Math.min(...heights.map((h) => Math.abs(h - at[1]))))
            checked++
          }
        }
      })
      expect(checked).toBeGreaterThan(90_000)
      expect(uncovered).toBe(0)
      expect(worst).toBeLessThan(2e-5)
    })

    test(`${scene.name}: away from a break the normal is the ground’s own, on a level side it is up`, () => {
      let own = 0
      let level = 0
      let worstOwn = 0
      let worstLevel = 0
      for (const { mesh } of smooth) {
        const sides = mesh.terrainBreakSides ?? []
        for (let i = 0; i < sides.length; i++) {
          const x = mesh.positions[i * 3] as number
          const z = mesh.positions[i * 3 + 2] as number
          const normal = [0, 1, 2].map((axis) => mesh.normals[i * 3 + axis] as number)
          const numeric = scene.breaks.some(
            (edge, index) =>
              typeof edge[(sides[i] as ('left' | 'right')[])[index] as 'left'] === 'number',
          )
          if (numeric) {
            worstLevel = Math.max(
              worstLevel,
              Math.abs(normal[0] as number),
              Math.abs(normal[2] as number),
              1 - (normal[1] as number),
            )
            level++
          } else if (toBreaks(scene, x, z) > 1.5 && Math.max(Math.abs(x), Math.abs(z)) < 31) {
            // (The outer rim of the tiles is left out: past it the two fields continue differently.)
            const expected = normalAt(plain.field, x, z)
            for (const axis of [0, 1, 2])
              worstOwn = Math.max(
                worstOwn,
                Math.abs((normal[axis] as number) - (expected[axis] as number)),
              )
            own++
          }
        }
      }
      expect(own).toBeGreaterThan(5_000)
      expect(worstOwn).toBeLessThan(1e-6)
      expect(worstLevel).toBe(0)
      if (scene.name !== 'one straight break, oblique') expect(level).toBeGreaterThan(0)
    })

    test(`${scene.name}: beside a break the ground keeps its own slope (no bleed from the other side)`, () => {
      let beside = 0
      let worst = 0
      for (const { mesh } of smooth) {
        const sides = mesh.terrainBreakSides ?? []
        for (let i = 0; i < sides.length; i++) {
          const x = mesh.positions[i * 3] as number
          const z = mesh.positions[i * 3 + 2] as number
          const numeric = scene.breaks.some(
            (edge, index) =>
              typeof edge[(sides[i] as ('left' | 'right')[])[index] as 'left'] === 'number',
          )
          if (numeric || toBreaks(scene, x, z) > 1.5) continue
          const expected = normalAt(plain.field, x, z)
          const dot = [0, 1, 2].reduce(
            (sum, axis) =>
              sum + (mesh.normals[i * 3 + axis] as number) * (expected[axis] as number),
            0,
          )
          worst = Math.max(worst, (Math.acos(Math.min(1, dot)) * 180) / Math.PI)
          beside++
        }
      }
      expect(beside).toBeGreaterThan(50)
      // The ground here rolls by a few degrees over a metre; a step of 0.8 to 2.5 m read into the
      // normal would turn it by 40 degrees or more.
      expect(worst).toBeLessThan(12)
    })

    test(`${scene.name}: two tiles agree on height and normal along their seam`, () => {
      const seam = new Map<string, number[]>()
      let shared = 0
      let apart = 0
      for (const { mesh } of smooth) {
        const own = new Map<string, number[]>()
        const sides = mesh.terrainBreakSides ?? []
        for (let i = 0; i < sides.length; i++) {
          const x = mesh.positions[i * 3] as number
          const z = mesh.positions[i * 3 + 2] as number
          if (x !== 0 && z !== 0) continue
          own.set(`${x}:${z}:${(sides[i] as string[]).join('')}`, [
            mesh.positions[i * 3 + 1] as number,
            ...[0, 1, 2].map((axis) => mesh.normals[i * 3 + axis] as number),
          ])
        }
        for (const [key, value] of own) {
          const other = seam.get(key)
          if (other) {
            if (value.some((number, index) => number !== other[index])) apart++
            shared++
          } else seam.set(key, value)
        }
      }
      // Four seams of 65 samples; a break on a seam leaves its two sides apart there, by design.
      expect(shared).toBeGreaterThan(scene.name === 'a straight break on the tile seam' ? 120 : 250)
      expect(apart).toBe(0)
    })

    test(`${scene.name}: a live stroke leaves the buffers a rebuild would make`, () => {
      // The stroke as the sculpt tool holds it: an edit field over the lot and its 4 m margin,
      // previewed over the persisted ground (the surface reads all of it once, when the stroke
      // begins), then a patch of it raised (the surface reads the patch and its halo). Three
      // dabs: in open ground, on the break, and across the tile seam.
      const live = terrainEditField(scene.site, scene.nodes, {
        minX: -16,
        minZ: -16,
        maxX: 16,
        maxZ: 16,
      })
      const dabs: [number, number][] = [
        [-7.5, -7],
        [0.5, -0.5],
        [0, 6],
      ]
      for (const [cx, cz] of dabs) {
        const half = 4
        const col0 = Math.round((cx - live.origin[0]) / live.spacing) - half
        const row0 = Math.round((cz - live.origin[1]) / live.spacing) - half
        const size = half * 2 + 1
        const heights = new Int16Array(size * size)
        for (let row = 0; row < size; row++)
          for (let col = 0; col < size; col++)
            heights[row * size + col] =
              (live.heights[(row0 + row) * live.cols + col0 + col] as number) +
              Math.round(60 * Math.max(0, 1 - Math.hypot(col - half, row - half) / half))
        const patch = { col0, row0, cols: size, rows: size, heights }
        const begun = terrainPreviewField(live, scene.field)
        const after = terrainPreviewField(applyHeightPatch(live, patch), scene.field)
        setTerrainBreakGround('smooth')
        try {
          const uploads: (number | null)[] = []
          for (const { grid } of scene.grids) {
            const want = buildTerrainGroundMesh(grid, after, [])
            const mesh = buildTerrainGroundMesh(grid, scene.field, [])
            updateTerrainGroundMesh(mesh, begun)
            // The patch and its halo of one spacing, as the ground surface hands them over.
            const range = updateTerrainGroundMesh(mesh, after, {
              minX: live.origin[0] + (col0 - 1) * live.spacing,
              minZ: live.origin[1] + (row0 - 1) * live.spacing,
              maxX: live.origin[0] + (col0 + size) * live.spacing,
              maxZ: live.origin[1] + (row0 + size) * live.spacing,
            })
            expect(hash(mesh.indices)).toBe(hash(want.indices))
            expect(hash(mesh.positions)).toBe(hash(want.positions))
            expect(hash(mesh.normals)).toBe(hash(want.normals))
            uploads.push(range ? range.count / 3 : null)
          }
          // The dab in open ground is 4.5 m from the seams: one tile is read again, three are not.
          if (cx === -7.5)
            expect(uploads.map((count) => count !== null)).toEqual([true, false, false, false])
        } finally {
          setTerrainBreakGround(initial)
        }
      }
    }, 60_000)
  }
})

describe('a stroke reads only what it can reach', () => {
  // The edit field of a 12 m lot inside these four tiles: the stroke's start is read inside its
  // rectangle alone, and must leave what reading every vertex leaves.
  for (const scene of [plain, ...scenes])
    for (const ground of ['faceted', 'smooth'] as const) {
      if (scene === plain && ground === 'faceted') continue
      test(`${scene.name}, ${scene === plain ? 'no break' : ground}: the start of a stroke inside its rectangle is the start read everywhere`, () => {
        const live = terrainEditField(scene.site, scene.nodes, {
          minX: -6,
          minZ: -10,
          maxX: 6,
          maxZ: 2,
        })
        const begun = terrainPreviewField(live, scene.field)
        setTerrainBreakGround(ground)
        try {
          let skipped = 0
          for (const { grid } of scene.grids) {
            const everywhere = buildTerrainGroundMesh(grid, scene.field, [])
            updateTerrainGroundMesh(everywhere, begun)
            const inside = buildTerrainGroundMesh(grid, scene.field, [])
            const range = updateTerrainGroundMesh(inside, begun, terrainFieldBounds(live, 0.5))
            expect(hash(inside.positions)).toBe(hash(everywhere.positions))
            expect(hash(inside.normals)).toBe(hash(everywhere.normals))
            if (range && range.count < inside.positions.length) skipped++
          }
          // Faceted, the whole mesh is read whatever the rectangle; otherwise rows are left alone.
          if (scene !== plain && ground === 'faceted') expect(skipped).toBe(0)
          else expect(skipped).toBeGreaterThanOrEqual(3)
        } finally {
          setTerrainBreakGround(initial)
        }
      }, 60_000)
    }

  test('a mesh whose bounding sphere is out of a dab’s reach is not asked', () => {
    const dab = { minX: -3, minZ: -3, maxX: 3, maxZ: 3 }
    // A 32 m tile about (16, 16): its sphere reaches the origin, the next tile's does not.
    const tile = (cx: number, cz: number) => ({ center: { x: cx, z: cz }, radius: 16 * Math.SQRT2 })
    expect(groundMeshInReach(tile(16, 16), dab, 2.5)).toBe(true)
    expect(groundMeshInReach(tile(48, 16), dab, 2.5)).toBe(false)
    expect(groundMeshInReach(tile(24, 16), dab, 2.5)).toBe(true)
    expect(groundMeshInReach(null, dab, 2.5)).toBe(true)
    expect(
      terrainFieldBounds(
        createTerrainField({ origin: [-4, 2], cols: 9, rows: 5, spacing: 0.5 }),
        0.5,
      ),
    ).toEqual({ minX: -4.5, minZ: 1.5, maxX: 0.5, maxZ: 4.5 })
  })
})
