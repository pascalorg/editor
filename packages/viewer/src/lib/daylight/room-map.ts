import {
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
  Vector2,
} from 'three'
import { Fn, floor, If, int, ivec2, Loop, round, texture, uniform } from 'three/tsl'

/**
 * Which room a point is in, at any scale: a sparse, tiled room-id map.
 *
 * Every level keeps its own map of 10 cm cells, cut into square tiles. A tile entirely inside one
 * room (or outside every room) is a single value; only tiles a room edge crosses keep their cells,
 * packed into one shared atlas. Memory then follows the length of the walls, not the site's area,
 * and no texture grows with the number of floors.
 *
 * A point finds its level by height within its own building (a coarse directory lists the
 * buildings near it), so neighbouring buildings with different floor heights, or a 40-storey
 * tower, each keep their floors. Within a building, levels sorted by height stay sorted when they
 * explode apart, so the search runs on live heights.
 */

type N = any

export const CELL = 0.1
/** Cells per tile side. */
export const TILE = 16
const TILE_M = CELL * TILE
/** Tiles per directory cell side. */
const DIR = 8
/** Margin around a level's rooms: the 2-cell dilation plus polygon slop. */
const APRON = 0.35
const INDEX_W = 1024
const LEVEL_W = 256
/** WebGPU guarantees 8192 texels a side; the renderer asks for no more. */
export const DEFAULT_TEXTURE_LIMIT = 8192

export type MapLevel = {
  /** World Y of the level's floor, assembled (not exploded). */
  y: number
  /** Index of the level's building; levels of one building stack. */
  building: number
}

export type MapRoom = {
  level: number
  /** World XZ. */
  polygon: [number, number][]
  holes?: [number, number][][]
}

/** One level's dense cell grid while it is being built (dilated, before tiling). */
export type LevelGrid = {
  level: number
  /** Cell (0, 0)'s lower corner, world XZ. */
  x0: number
  z0: number
  width: number
  height: number
  /** Room index + 1 per cell, 0 outside. */
  cells: Uint16Array
  /** Per tile: true when every cell holds the same value (no edge inside). */
  uniformTile: (tx: number, tz: number) => boolean
}

type LevelMap = {
  y: number
  building: number
  /** Tile rect, in tiles from the site origin. */
  tx0: number
  tz0: number
  tw: number
  th: number
  /** Per tile: 0 outside every room, room + 1 when uniform, −(atlas tile + 1) when detailed. */
  entries: Float32Array
}

export class RoomMap {
  /** The device's largest 2D texture side; set before `build`. */
  textureLimit = DEFAULT_TEXTURE_LIMIT
  private levels: LevelMap[] = []
  /** Level indices sorted by building, then height: the order the GPU searches in. */
  private order: number[] = []
  private position: number[] = []
  /** Per building: its range in `order`. */
  private buildingRange: [number, number][] = []
  private originX = 0
  private originZ = 0
  private dirW = 0
  private dirH = 0
  /** Per directory cell: the buildings whose levels reach it. */
  private dirLists: number[][] = []
  private atlas = new Uint8Array(2)
  private atlasTilesW = 1
  private atlasTiles = 0
  private indexBytes = 0
  private warnedOverflow = false

  readonly u = {
    origin: uniform(new Vector2()) as N,
    dirW: uniform(0, 'int'),
    dirH: uniform(0, 'int'),
    /** One building: its level range is the only candidate (no directory reads). */
    single: uniform(1, 'int'),
    singleCount: uniform(0, 'int'),
    /** Binary-search steps for the tallest building. */
    searchSteps: uniform(0, 'int'),
    atlasTilesW: uniform(1, 'int'),
    index: texture(floatTexture(new Float32Array(4), 1, 1)) as N,
    levels: texture(floatTexture(new Float32Array(8), 2, 1)) as N,
    atlas: texture(byteTexture(new Uint8Array(2), 1, 1)) as N,
  }
  private levelData = new Float32Array(8)

  /**
   * Rebuild from rooms. `onGrid` sees each level's dense grid before it is tiled (the doorway
   * search walks room edges on it).
   */
  build(levels: MapLevel[], rooms: MapRoom[], onGrid?: (grid: LevelGrid) => void) {
    this.levels = levels.map((l) => ({
      y: l.y,
      building: l.building,
      tx0: 0,
      tz0: 0,
      tw: 0,
      th: 0,
      entries: new Float32Array(0),
    }))
    this.order = levels
      .map((_, i) => i)
      .sort((a, b) => levels[a]!.building - levels[b]!.building || levels[a]!.y - levels[b]!.y)
    this.position = new Array(levels.length)
    this.order.forEach((level, pos) => {
      this.position[level] = pos
    })
    const buildings = levels.reduce((n, l) => Math.max(n, l.building + 1), 0)
    this.buildingRange = Array.from({ length: buildings }, () => [0, 0] as [number, number])
    this.order.forEach((level, pos) => {
      const range = this.buildingRange[levels[level]!.building]!
      if (range[1] === 0) range[0] = pos
      range[1]++
    })

    // Site origin on the tile grid.
    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    for (const room of rooms)
      for (const [x, z] of room.polygon) {
        minX = Math.min(minX, x)
        minZ = Math.min(minZ, z)
      }
    if (!Number.isFinite(minX)) minX = minZ = 0
    this.originX = Math.floor((minX - APRON) / TILE_M) * TILE_M
    this.originZ = Math.floor((minZ - APRON) / TILE_M) * TILE_M

    const byLevel: number[][] = levels.map(() => [])
    rooms.forEach((room, ri) => {
      byLevel[room.level]?.push(ri)
    })

    const atlasTilesW = Math.max(1, Math.floor(Math.min(this.textureLimit, 4096) / TILE))
    const atlasCapacity = atlasTilesW * Math.max(1, Math.floor(this.textureLimit / TILE))
    const detailTiles: Uint16Array[] = []

    for (let li = 0; li < levels.length; li++) {
      const level = this.levels[li]!
      const own = byLevel[li]!
      if (!own.length) continue
      let x0 = Number.POSITIVE_INFINITY
      let z0 = Number.POSITIVE_INFINITY
      let x1 = Number.NEGATIVE_INFINITY
      let z1 = Number.NEGATIVE_INFINITY
      for (const ri of own)
        for (const [x, z] of rooms[ri]!.polygon) {
          x0 = Math.min(x0, x)
          z0 = Math.min(z0, z)
          x1 = Math.max(x1, x)
          z1 = Math.max(z1, z)
        }
      level.tx0 = Math.floor((x0 - APRON - this.originX) / TILE_M)
      level.tz0 = Math.floor((z0 - APRON - this.originZ) / TILE_M)
      level.tw = Math.floor((x1 + APRON - this.originX) / TILE_M) - level.tx0 + 1
      level.th = Math.floor((z1 + APRON - this.originZ) / TILE_M) - level.tz0 + 1
      const width = level.tw * TILE
      const height = level.th * TILE
      const gx0 = this.originX + level.tx0 * TILE_M
      const gz0 = this.originZ + level.tz0 * TILE_M
      const cells = new Uint16Array(width * height)
      for (const ri of own) rasterize(rooms[ri]!, ri + 1, cells, width, height, gx0, gz0)
      dilate(cells, width, height)

      const uniformTiles = new Uint8Array(level.tw * level.th)
      level.entries = new Float32Array(level.tw * level.th)
      for (let tz = 0; tz < level.th; tz++)
        for (let tx = 0; tx < level.tw; tx++) {
          const first = cells[tz * TILE * width + tx * TILE]!
          let same = true
          for (let j = 0; j < TILE && same; j++) {
            const row = (tz * TILE + j) * width + tx * TILE
            for (let i = 0; i < TILE; i++)
              if (cells[row + i] !== first) {
                same = false
                break
              }
          }
          const t = tz * level.tw + tx
          if (same) {
            uniformTiles[t] = 1
            level.entries[t] = first
            continue
          }
          if (detailTiles.length >= atlasCapacity) {
            // Out of atlas: the tile's most common room stands for all of it.
            if (!this.warnedOverflow) {
              console.warn('[daylight] room map atlas full: some room edges are coarse')
              this.warnedOverflow = true
            }
            level.entries[t] = majority(cells, width, tx, tz)
            continue
          }
          const tile = new Uint16Array(TILE * TILE)
          for (let j = 0; j < TILE; j++)
            tile.set(
              cells.subarray(
                (tz * TILE + j) * width + tx * TILE,
                (tz * TILE + j) * width + tx * TILE + TILE,
              ),
              j * TILE,
            )
          detailTiles.push(tile)
          level.entries[t] = -detailTiles.length
        }
      onGrid?.({
        level: li,
        x0: gx0,
        z0: gz0,
        width,
        height,
        cells,
        uniformTile: (tx, tz) => uniformTiles[tz * level.tw + tx] === 1,
      })
    }

    // Atlas: detailed tiles in rows, two bytes (room + 1) per cell.
    this.atlasTilesW = atlasTilesW
    this.atlasTiles = detailTiles.length
    const atlasRows = Math.max(1, Math.ceil(detailTiles.length / atlasTilesW))
    const aw = atlasTilesW * TILE
    const ah = atlasRows * TILE
    this.atlas = new Uint8Array(aw * ah * 2)
    detailTiles.forEach((tile, a) => {
      const ox = (a % atlasTilesW) * TILE
      const oz = Math.floor(a / atlasTilesW) * TILE
      for (let j = 0; j < TILE; j++)
        for (let i = 0; i < TILE; i++) {
          const v = tile[j * TILE + i]!
          const k = ((oz + j) * aw + ox + i) * 2
          this.atlas[k] = v & 255
          this.atlas[k + 1] = v >> 8
        }
    })

    // Directory: per cell, the buildings whose levels reach it.
    let maxTx = 0
    let maxTz = 0
    for (const l of this.levels) {
      if (!l.tw) continue
      maxTx = Math.max(maxTx, l.tx0 + l.tw)
      maxTz = Math.max(maxTz, l.tz0 + l.th)
    }
    this.dirW = Math.max(1, Math.ceil(maxTx / DIR))
    this.dirH = Math.max(1, Math.ceil(maxTz / DIR))
    this.dirLists = Array.from({ length: this.dirW * this.dirH }, () => [])
    for (let b = 0; b < buildings; b++) {
      let bx0 = Number.POSITIVE_INFINITY
      let bz0 = Number.POSITIVE_INFINITY
      let bx1 = -1
      let bz1 = -1
      for (const l of this.levels) {
        if (l.building !== b || !l.tw) continue
        bx0 = Math.min(bx0, l.tx0)
        bz0 = Math.min(bz0, l.tz0)
        bx1 = Math.max(bx1, l.tx0 + l.tw - 1)
        bz1 = Math.max(bz1, l.tz0 + l.th - 1)
      }
      if (bx1 < 0) continue
      for (let dz = Math.floor(bz0 / DIR); dz <= Math.floor(bz1 / DIR); dz++)
        for (let dx = Math.floor(bx0 / DIR); dx <= Math.floor(bx1 / DIR); dx++)
          this.dirLists[dz * this.dirW + dx]!.push(b)
    }

    this.upload()
  }

  /** CPU lookup in assembled space (same rule as the shader). */
  roomAt(x: number, y: number, z: number): number {
    const tx = Math.floor((x - this.originX) / TILE_M)
    const tz = Math.floor((z - this.originZ) / TILE_M)
    const dx = Math.floor(tx / DIR)
    const dz = Math.floor(tz / DIR)
    if (dx < 0 || dz < 0 || dx >= this.dirW || dz >= this.dirH) return -1
    for (const b of this.dirLists[dz * this.dirW + dx]!) {
      const [start, count] = this.buildingRange[b]!
      let found = start
      for (let pos = start; pos < start + count; pos++)
        if (this.levels[this.order[pos]!]!.y <= y - 0.12) found = pos
      const room = this.levelRoomAt(this.order[found]!, x, z, tx, tz)
      if (room >= 0) return room
    }
    return -1
  }

  private levelRoomAt(li: number, x: number, z: number, tx: number, tz: number) {
    const l = this.levels[li]!
    const lx = tx - l.tx0
    const lz = tz - l.tz0
    if (lx < 0 || lz < 0 || lx >= l.tw || lz >= l.th) return -1
    const e = l.entries[lz * l.tw + lx]!
    if (e > 0) return e - 1
    if (e === 0) return -1
    const a = -e - 1
    const ci = Math.floor((x - this.originX) / CELL) - tx * TILE
    const cj = Math.floor((z - this.originZ) / CELL) - tz * TILE
    const aw = this.atlasTilesW * TILE
    const k =
      (((Math.floor(a / this.atlasTilesW) * TILE + cj) * aw + (a % this.atlasTilesW) * TILE + ci) *
        2) |
      0
    const v = this.atlas[k]! + this.atlas[k + 1]! * 256
    return v - 1
  }

  /** The level stacked right above `level` in its building, or −1. */
  levelAbove(level: number): number {
    const pos = this.position[level]
    if (pos === undefined) return -1
    const next = this.order[pos + 1]
    return next !== undefined && this.levels[next]!.building === this.levels[level]!.building
      ? next
      : -1
  }

  /** Index the GPU uses for `level` (rooms store it). */
  gpuLevel(level: number): number {
    return this.position[level] ?? 0
  }

  /**
   * Live presentation per level (input order): explode offset, whether it is shown, and whether
   * the levels over it are hidden (its rooms open to the sky from above).
   */
  setPresentation(offsets: number[], shown: boolean[], focused: boolean[]) {
    let changed = false
    this.order.forEach((level, pos) => {
      const l = this.levels[level]!
      const off = offsets[level] ?? 0
      const flags = (focused[level] ? 1 : 0) + (shown[level] !== false ? 2 : 0)
      const t0 = pos * 8
      const liveY = l.y + off
      if (this.levelData[t0] !== liveY) {
        this.levelData[t0] = liveY
        changed = true
      }
      if (this.levelData[t0 + 6] !== off || this.levelData[t0 + 7] !== flags) {
        this.levelData[t0 + 6] = off
        this.levelData[t0 + 7] = flags
        changed = true
      }
    })
    if (changed) (this.u.levels.value as DataTexture).needsUpdate = true
  }

  memoryBytes() {
    return this.atlas.byteLength + this.indexBytes + this.levelData.byteLength
  }

  get stats() {
    return { atlasTiles: this.atlasTiles, dirW: this.dirW, dirH: this.dirH }
  }

  private upload() {
    // index: [directory cells] [directory lists] [entries per level]
    const dirCells = this.dirW * this.dirH
    const listTexels = this.dirLists.reduce((s, l) => s + l.length, 0)
    const entryTexels = this.levels.reduce((s, l) => s + l.entries.length, 0)
    const texels = dirCells + listTexels + entryTexels + 1
    const rows = Math.max(1, Math.ceil(texels / INDEX_W))
    const index = new Float32Array(INDEX_W * rows * 4)
    let list = dirCells
    this.dirLists.forEach((buildings, c) => {
      index[c * 4] = list
      index[c * 4 + 1] = buildings.length
      for (const b of buildings) {
        const [start, count] = this.buildingRange[b]!
        index[list * 4] = start
        index[list * 4 + 1] = count
        list++
      }
    })
    let entry = list
    const entryOffset = new Array<number>(this.levels.length).fill(0)
    this.levels.forEach((l, li) => {
      entryOffset[li] = entry
      for (let k = 0; k < l.entries.length; k++) index[(entry + k) * 4] = l.entries[k]!
      entry += l.entries.length
    })
    this.indexBytes = index.byteLength

    // levels (GPU order): [liveY, tx0, tz0, tw] [th, entryOffset, offset, flags]
    const levelRows = Math.max(1, Math.ceil((this.order.length * 2) / LEVEL_W))
    this.levelData = new Float32Array(LEVEL_W * levelRows * 4)
    this.order.forEach((level, pos) => {
      const l = this.levels[level]!
      this.levelData.set([l.y, l.tx0, l.tz0, l.tw, l.th, entryOffset[level]!, 0, 2], pos * 8)
    })

    const aw = this.atlasTilesW * TILE
    replace(this.u.index, floatTexture(index, INDEX_W, rows))
    replace(this.u.levels, floatTexture(this.levelData, LEVEL_W, levelRows))
    replace(this.u.atlas, byteTexture(this.atlas, aw, this.atlas.length / 2 / aw))
    ;(this.u.origin.value as Vector2).set(this.originX, this.originZ)
    this.u.dirW.value = this.dirW
    this.u.dirH.value = this.dirH
    this.u.single.value = this.buildingRange.length <= 1 ? 1 : 0
    this.u.singleCount.value = this.buildingRange[0]?.[1] ?? 0
    this.u.searchSteps.value = this.buildingRange.reduce(
      (steps, [, count]) => Math.max(steps, Math.ceil(Math.log2(count + 1))),
      0,
    )
    this.u.atlasTilesW.value = this.atlasTilesW
  }

  // ---- TSL ---------------------------------------------------------------------------------

  private indexTexel(i: N): N {
    const k = int(i)
    return this.u.index.load(ivec2(k.mod(INDEX_W), k.div(INDEX_W)))
  }

  /** [liveY, tx0, tz0, tw] of the level at GPU position `pos`. */
  levelTexel0(pos: N): N {
    const k = int(pos).mul(2)
    return this.u.levels.load(ivec2(k.mod(LEVEL_W), k.div(LEVEL_W)))
  }

  /** [th, entryOffset, offset, flags] of the level at GPU position `pos`. */
  levelTexel1(pos: N): N {
    const k = int(pos).mul(2).add(1)
    return this.u.levels.load(ivec2(k.mod(LEVEL_W), k.div(LEVEL_W)))
  }

  /** Room index (−1 outside) at a world-space position (live heights). */
  roomAtNode = Fn(([p]: [N]) => {
    const u = this.u
    const room = int(-1).toVar()
    const tileF = p.xz.sub(u.origin).div(TILE_M)
    const tile = ivec2((floor as N)(tileF))
    // Candidate buildings: the only one, or the directory cell's list.
    const count = int(0).toVar()
    const listStart = int(0).toVar()
    If(u.single.equal(1), () => {
      count.assign(1)
    }).Else(() => {
      const dir = ivec2((floor as N)(tileF.div(DIR)))
      If(
        dir.x
          .greaterThanEqual(0)
          .and(dir.y.greaterThanEqual(0))
          .and(dir.x.lessThan(u.dirW))
          .and(dir.y.lessThan(u.dirH)),
        () => {
          const d = this.indexTexel(dir.y.mul(u.dirW).add(dir.x))
          listStart.assign(int(d.x))
          count.assign(int(d.y))
        },
      )
    })
    const y = p.y.sub(0.12)
    Loop({ start: int(0), end: count, type: 'int', condition: '<' }, ({ i }: N) => {
      If(room.lessThan(0), () => {
        const start = int(0).toVar()
        const levels = u.singleCount.toVar()
        If(u.single.equal(0), () => {
          const range = this.indexTexel(listStart.add(i))
          start.assign(int(range.x))
          levels.assign(int(range.y))
        })
        // Last level of the building whose live floor is at or below the point (else its lowest).
        const lo = start.toVar()
        const hi = start.add(levels).sub(1).toVar()
        const found = start.toVar()
        Loop({ start: int(0), end: u.searchSteps, type: 'int', condition: '<' }, () => {
          If(lo.lessThanEqual(hi), () => {
            const mid = lo.add(hi).div(2)
            If(this.levelTexel0(mid).x.lessThanEqual(y), () => {
              found.assign(mid)
              lo.assign(mid.add(1))
            }).Else(() => {
              hi.assign(mid.sub(1))
            })
          })
        })
        const t0 = this.levelTexel0(found)
        const t1 = this.levelTexel1(found)
        const local = tile.sub(ivec2(int(t0.y), int(t0.z)))
        If(
          local.x
            .greaterThanEqual(0)
            .and(local.y.greaterThanEqual(0))
            .and(local.x.lessThan(int(t0.w)))
            .and(local.y.lessThan(int(t1.x))),
          () => {
            const e = this.indexTexel(
              int(t1.y)
                .add(local.y.mul(int(t0.w)))
                .add(local.x),
            ).x
            If(e.greaterThan(0.5), () => {
              room.assign(int(round(e)).sub(1))
            }).ElseIf(e.lessThan(-0.5), () => {
              const a = int(round(e.negate())).sub(1)
              const cell = ivec2((floor as N)(p.xz.sub(u.origin).div(CELL))).sub(tile.mul(TILE))
              const at = ivec2(
                a.mod(u.atlasTilesW).mul(TILE).add(cell.x),
                a.div(u.atlasTilesW).mul(TILE).add(cell.y),
              )
              const texel = u.atlas.load(at)
              const id = int(round(texel.x.mul(255))).add(int(round(texel.y.mul(255))).mul(256))
              room.assign(id.sub(1))
            })
          },
        )
      })
    })
    return room
  })
}

// ---- build helpers --------------------------------------------------------------------------

/** Scanline fill of a room (holes subtracted, even-odd) at cell centres. */
function rasterize(
  room: MapRoom,
  value: number,
  cells: Uint16Array,
  width: number,
  height: number,
  x0: number,
  z0: number,
) {
  const rings = [room.polygon, ...(room.holes ?? [])]
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [, z] of room.polygon) {
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  const j0 = Math.max(0, Math.floor((minZ - z0) / CELL))
  const j1 = Math.min(height - 1, Math.ceil((maxZ - z0) / CELL))
  const xs: number[] = []
  for (let j = j0; j <= j1; j++) {
    const z = z0 + (j + 0.5) * CELL
    xs.length = 0
    for (const ring of rings)
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [xa, za] = ring[a]!
        const [xb, zb] = ring[b]!
        if (za > z !== zb > z) xs.push(((xb - xa) * (z - za)) / (zb - za) + xa)
      }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Cells whose centre lies in (xs[k], xs[k+1]].
      const i0 = Math.max(0, Math.floor((xs[k]! - x0) / CELL - 0.5) + 1)
      const i1 = Math.min(width - 1, Math.floor((xs[k + 1]! - x0) / CELL - 0.5))
      if (i1 >= i0) cells.fill(value, j * width + i0, j * width + i1 + 1)
    }
  }
}

/** Two passes of 4-neighbour growth into empty cells: wall thickness and polygon slop resolve. */
function dilate(cells: Uint16Array, width: number, height: number) {
  for (let pass = 0; pass < 2; pass++) {
    const src = cells.slice()
    for (let j = 1; j < height - 1; j++)
      for (let i = 1; i < width - 1; i++) {
        const k = j * width + i
        if (src[k]) continue
        const n = src[k - 1] || src[k + 1] || src[k - width] || src[k + width]
        if (n) cells[k] = n
      }
  }
}

function majority(cells: Uint16Array, width: number, tx: number, tz: number) {
  const counts = new Map<number, number>()
  for (let j = 0; j < TILE; j++)
    for (let i = 0; i < TILE; i++) {
      const v = cells[(tz * TILE + j) * width + tx * TILE + i]!
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
  let best = 0
  let bestCount = -1
  for (const [v, c] of counts)
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  return best
}

function floatTexture(data: Float32Array, width: number, height: number) {
  const tex = new DataTexture(data, width, height, RGBAFormat, FloatType)
  tex.magFilter = tex.minFilter = NearestFilter
  tex.needsUpdate = true
  return tex
}

function byteTexture(data: Uint8Array, width: number, height: number) {
  const tex = new DataTexture(data, width, height, RGFormat, UnsignedByteType)
  tex.magFilter = tex.minFilter = NearestFilter
  tex.needsUpdate = true
  return tex
}

function replace(node: N, tex: DataTexture) {
  const previous = node.value as DataTexture
  node.value = tex
  previous.dispose()
}
