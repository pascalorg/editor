import {
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
  Vector2,
} from 'three'
import { Fn, floor, If, int, ivec2, Loop, round, texture, uniform, vec2 } from 'three/tsl'

/**
 * Which room a point is in, at any scale: a sparse, tiled room-id map.
 *
 * Every level keeps its own map of 10 cm cells, cut into square tiles. A tile entirely inside one
 * room (or outside every room) is a single value; only tiles a room edge crosses keep their cells,
 * packed into one shared atlas. A level's rooms are grouped into clusters, each with its own tile
 * rect, so open ground between distant rooms costs nothing. Memory then follows the length of the
 * walls, not the site's area, and no texture grows with the number of floors. Tiles are built one
 * at a time, so neither does the build.
 *
 * A point finds its level by height within its own building (a coarse directory lists the
 * buildings near it), so neighbouring buildings with different floor heights, or a 40-storey
 * tower, each keep their floors. Within a building, levels sorted by height stay sorted when they
 * explode apart, so the search runs on live heights.
 *
 * Each building's map is turned to its own walls: its cells run along the direction most of its
 * room edges take, so a house drawn at 40° to the world reads exactly like the same house drawn
 * square. Walls at other angles within a building still cross the cells in steps.
 */

type N = any

export const CELL = 0.1
/** Cells per tile side. */
export const TILE = 16
const TILE_M = CELL * TILE
/**
 * A cell is wall when a wall's footprint reaches this close to its centre (on each axis): thin
 * walls still mark an unbroken line of cells, and a wall cell ends at most ~10 cm past the face.
 */
const WALL_REACH = CELL / 4
/** Margin around a room: the 2-cell dilation plus polygon slop. */
const APRON = 0.35
/** Cells built around a tile so its 2-pass dilation and its edges' neighbours are exact. */
const MARGIN = 3
/** Rooms of a level closer than this (in tiles) share a cluster. */
const CLUSTER_GAP = 2
const LEVEL_W = 256
/** Directory cells, at most (they grow coarser on vast sites). */
const MAX_DIR_CELLS = 65536
/** Room ids are stored as two bytes (id + 1). */
export const MAX_ROOMS = 65535
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

/** A level's walls in plan: triangles of their footprints, six numbers each (world XZ × 3). */
export type MapWalls = { level: number; triangles: ArrayLike<number> }

/** One tile while it is being built, inside its row's dilated cells (with a margin all round). */
export type TileCells = {
  level: number
  /** Site cell index of `cells[0]`. */
  ci0: number
  cj0: number
  /** XZ of `cells[0]`'s lower corner, in the building's turned frame. */
  x0: number
  z0: number
  /** The frame's turn [cos, sin]: world x = x·cos − z·sin, world z = x·sin + z·cos. */
  turn: [number, number]
  /** Cells per buffer row. */
  stride: number
  /** The tile's first cell in the buffer. */
  i0: number
  j0: number
  /** Room index + 1 per cell, 0 outside. */
  cells: Uint16Array
  /** Every cell of the tile itself holds the same value (no edge inside). */
  uniform: boolean
}

type Cluster = {
  /** Tile rect, in tiles from the site origin. */
  tx0: number
  tz0: number
  tw: number
  th: number
  /** Per tile: 0 outside every room, room + 1 when uniform, −(atlas tile + 1) when detailed. */
  entries: Float32Array
}

type LevelMap = { y: number; building: number; clusters: Cluster[] }

export class RoomMap {
  /** The device's largest 2D texture side; set before `build`. */
  textureLimit = DEFAULT_TEXTURE_LIMIT
  private levels: LevelMap[] = []
  /** Level indices sorted by building, then height: the order the GPU searches in. */
  private order: number[] = []
  private position: number[] = []
  /** Per building: its range in `order`. */
  private buildingRange: [number, number][] = []
  /** Per building: the turn [cos, sin] that lays its walls along the cells. */
  private turns: [number, number][] = []
  private originX = 0
  private originZ = 0
  /** The directory's corner: it stays on the world axes, whatever the buildings' turns. */
  private dirX = 0
  private dirZ = 0
  private dirTiles = 8
  private dirW = 0
  private dirH = 0
  /** Per directory cell: the buildings whose rooms reach it. */
  private dirLists: number[][] = []
  private atlas = new Uint8Array(2)
  private atlasTilesW = 1
  private atlasTiles = 0
  private indexBytes = 0
  private warnedOverflow = false

  readonly u = {
    origin: uniform(new Vector2()) as N,
    dirOrigin: uniform(new Vector2()) as N,
    /** The only building's turn (with `single`). */
    turn: uniform(new Vector2(1, 0)) as N,
    dirTiles: uniform(8, 'int'),
    dirW: uniform(0, 'int'),
    dirH: uniform(0, 'int'),
    /** One building: its level range is the only candidate (no directory reads). */
    single: uniform(1, 'int'),
    singleCount: uniform(0, 'int'),
    /** Binary-search steps for the tallest building. */
    searchSteps: uniform(0, 'int'),
    atlasTilesW: uniform(1, 'int'),
    indexW: uniform(1, 'int'),
    index: texture(floatTexture(new Float32Array(4), 1, 1)) as N,
    levels: texture(floatTexture(new Float32Array(8), 2, 1)) as N,
    atlas: texture(byteTexture(new Uint8Array(2), 1, 1)) as N,
  }
  private levelData = new Float32Array(8)

  /**
   * Rebuild from rooms. `onTile` sees every built tile (the doorway search walks room edges).
   * `walls` keep a room from growing out through them: a wall's far side stays outside.
   */
  build(
    levels: MapLevel[],
    rooms: MapRoom[],
    onTile?: (tile: TileCells) => void,
    walls: MapWalls[] = [],
  ) {
    this.levels = levels.map((l) => ({ y: l.y, building: l.building, clusters: [] }))
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

    if (rooms.length > MAX_ROOMS)
      console.warn(`[daylight] ${rooms.length} rooms: only the first ${MAX_ROOMS} get room light`)

    // Each building's turn: the direction its room edges run along, folded to a quarter turn
    // (walls at right angles agree) and weighted by length.
    const sums = Array.from({ length: buildings }, () => [0, 0] as [number, number])
    for (const room of rooms.slice(0, MAX_ROOMS)) {
      const sum = sums[levels[room.level]?.building ?? -1]
      if (!sum) continue
      for (const ring of [room.polygon, ...(room.holes ?? [])])
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const dx = ring[a]![0] - ring[b]![0]
          const dz = ring[a]![1] - ring[b]![1]
          const length = Math.hypot(dx, dz)
          const angle = 4 * Math.atan2(dz, dx)
          sum[0] += length * Math.cos(angle)
          sum[1] += length * Math.sin(angle)
        }
    }
    // A building already square to the world keeps the plain frame, to the last bit.
    this.turns = sums.map(([c, s]) => {
      const angle = Math.hypot(c, s) < 1e-9 ? 0 : Math.atan2(s, c) / 4
      return Math.abs(angle) < 1e-9 ? IDENTITY : [Math.cos(angle), Math.sin(angle)]
    })
    const turnOf = (level: number) => this.turns[levels[level]?.building ?? -1] ?? IDENTITY
    const turned = (ring: [number, number][], [cos, sin]: [number, number]) =>
      ring.map(([x, z]) => [x * cos + z * sin, z * cos - x * sin] as [number, number])
    // From here on rooms and walls are in their building's turned frame.
    const used = rooms.slice(0, MAX_ROOMS).map((room) => {
      const turn = turnOf(room.level)
      return turn === IDENTITY
        ? room
        : {
            level: room.level,
            polygon: turned(room.polygon, turn),
            holes: room.holes?.map((hole) => turned(hole, turn)),
          }
    })
    const footprints = walls.map((wall) => {
      const turn = turnOf(wall.level)
      const t = wall.triangles
      if (turn === IDENTITY) return t
      const [cos, sin] = turn
      const out = new Float64Array(t.length)
      for (let k = 0; k + 1 < t.length; k += 2) {
        out[k] = t[k]! * cos + t[k + 1]! * sin
        out[k + 1] = t[k + 1]! * cos - t[k]! * sin
      }
      return out
    })

    // Site origin on the tile grid; every rect below is in whole tiles from it.
    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    for (const room of used)
      for (const [x, z] of room.polygon) {
        minX = Math.min(minX, x)
        minZ = Math.min(minZ, z)
      }
    if (!Number.isFinite(minX)) minX = minZ = 0
    const originTx = Math.floor((minX - APRON) / TILE_M)
    const originTz = Math.floor((minZ - APRON) / TILE_M)
    this.originX = originTx * TILE_M
    this.originZ = originTz * TILE_M

    // Each room's tile rect (padded by the apron).
    const rects = used.map((room) => {
      let x0 = Number.POSITIVE_INFINITY
      let z0 = Number.POSITIVE_INFINITY
      let x1 = Number.NEGATIVE_INFINITY
      let z1 = Number.NEGATIVE_INFINITY
      for (const [x, z] of room.polygon) {
        x0 = Math.min(x0, x)
        z0 = Math.min(z0, z)
        x1 = Math.max(x1, x)
        z1 = Math.max(z1, z)
      }
      return {
        tx0: Math.floor((x0 - APRON) / TILE_M) - originTx,
        tz0: Math.floor((z0 - APRON) / TILE_M) - originTz,
        tx1: Math.floor((x1 + APRON) / TILE_M) - originTx,
        tz1: Math.floor((z1 + APRON) / TILE_M) - originTz,
      }
    })

    const atlasTilesW = Math.max(1, Math.floor(Math.min(this.textureLimit, 4096) / TILE))
    const atlasCapacity = atlasTilesW * Math.max(1, Math.floor(this.textureLimit / TILE))
    const detailTiles: Uint16Array[] = []
    let buffer = new Uint16Array(0)
    let scratch = new Uint16Array(0)
    let wallBuffer = new Uint8Array(0)
    // Wall triangles per level and tile row (a row's strip reaches a margin into the next rows).
    const wallRows: Map<number, number[]>[] = levels.map(() => new Map())
    const reach = MARGIN * CELL + WALL_REACH
    walls.forEach((wall, wi) => {
      const rows = wallRows[wall.level]
      if (!rows) return
      const t = footprints[wi]!
      for (let k = 0; k + 5 < t.length; k += 6) {
        const zMin = Math.min(t[k + 1]!, t[k + 3]!, t[k + 5]!)
        const zMax = Math.max(t[k + 1]!, t[k + 3]!, t[k + 5]!)
        const r0 = Math.floor((zMin - reach - this.originZ) / TILE_M)
        const r1 = Math.floor((zMax + reach - this.originZ) / TILE_M)
        for (let r = r0; r <= r1; r++) {
          const list = rows.get(r)
          if (list) list.push(wi, k)
          else rows.set(r, [wi, k])
        }
      }
    })

    // Where rooms overlap (an automatic room under drawn ones, a unit around its rooms), the
    // smallest wins: rasterized last, so each level's rooms go largest first.
    const area = used.map((room) => Math.abs(ringArea(room.polygon)))
    const byLevel: number[][] = levels.map(() => [])
    used.forEach((room, ri) => {
      byLevel[room.level]?.push(ri)
    })
    for (const list of byLevel) list.sort((a, b) => area[b]! - area[a]! || a - b)
    for (let li = 0; li < levels.length; li++) {
      const level = this.levels[li]!
      for (const members of clusterRooms(byLevel[li]!, rects)) {
        let tx0 = Number.POSITIVE_INFINITY
        let tz0 = Number.POSITIVE_INFINITY
        let tx1 = Number.NEGATIVE_INFINITY
        let tz1 = Number.NEGATIVE_INFINITY
        for (const ri of members) {
          const r = rects[ri]!
          tx0 = Math.min(tx0, r.tx0)
          tz0 = Math.min(tz0, r.tz0)
          tx1 = Math.max(tx1, r.tx1)
          tz1 = Math.max(tz1, r.tz1)
        }
        const cluster: Cluster = {
          tx0,
          tz0,
          tw: tx1 - tx0 + 1,
          th: tz1 - tz0 + 1,
          entries: new Float32Array((tx1 - tx0 + 1) * (tz1 - tz0 + 1)),
        }
        level.clusters.push(cluster)
        // Rooms per tile, from each room's own rect.
        const buckets: number[][] = Array.from({ length: cluster.entries.length }, () => [])
        for (const ri of members) {
          const r = rects[ri]!
          for (let tz = r.tz0; tz <= r.tz1; tz++)
            for (let tx = r.tx0; tx <= r.tx1; tx++)
              buckets[(tz - tz0) * cluster.tw + (tx - tx0)]!.push(ri)
        }
        // One row of tiles at a time (plus a margin all round): each room rasterizes once per row.
        const stride = cluster.tw * TILE + 2 * MARGIN
        const rowH = TILE + 2 * MARGIN
        if (buffer.length < stride * rowH) {
          buffer = new Uint16Array(stride * rowH)
          scratch = new Uint16Array(stride * rowH)
          wallBuffer = new Uint8Array(stride * rowH)
        }
        const strip = buffer.subarray(0, stride * rowH)
        const wallStrip = wallBuffer.subarray(0, stride * rowH)
        const inRow = new Set<number>()
        for (let tz = tz0; tz <= tz1; tz++) {
          inRow.clear()
          for (let tx = tx0; tx <= tx1; tx++)
            for (const ri of buckets[(tz - tz0) * cluster.tw + (tx - tx0)]!) inRow.add(ri)
          if (!inRow.size) continue
          const ci0 = tx0 * TILE - MARGIN
          const cj0 = tz * TILE - MARGIN
          const x0 = this.originX + ci0 * CELL
          const z0 = this.originZ + cj0 * CELL
          strip.fill(0)
          for (const ri of [...inRow].sort((a, b) => area[b]! - area[a]! || a - b))
            rasterize(used[ri]!, ri + 1, strip, stride, rowH, x0, z0)
          // Growth only fills empty cells: inside a big room there are none.
          if (strip.includes(0)) {
            const rowWalls = wallRows[li]!.get(tz)
            if (rowWalls) {
              wallStrip.fill(0)
              for (let w = 0; w < rowWalls.length; w += 2)
                markWall(
                  footprints[rowWalls[w]!]!,
                  rowWalls[w + 1]!,
                  wallStrip,
                  stride,
                  rowH,
                  x0,
                  z0,
                )
            }
            dilate(strip, scratch, stride, rowH, rowWalls ? wallStrip : undefined)
          }
          for (let tx = tx0; tx <= tx1; tx++) {
            const t = (tz - tz0) * cluster.tw + (tx - tx0)
            if (!buckets[t]!.length) continue
            const i0 = MARGIN + (tx - tx0) * TILE
            const first = strip[MARGIN * stride + i0]!
            let same = true
            for (let j = MARGIN; j < MARGIN + TILE && same; j++)
              for (let i = i0; i < i0 + TILE; i++)
                if (strip[j * stride + i] !== first) {
                  same = false
                  break
                }
            if (same) cluster.entries[t] = first
            else if (detailTiles.length >= atlasCapacity) {
              // Out of atlas: the tile's most common room stands for all of it.
              if (!this.warnedOverflow) {
                console.warn('[daylight] room map atlas full: some room edges are coarse')
                this.warnedOverflow = true
              }
              cluster.entries[t] = majority(strip, stride, i0)
            } else {
              const tile = new Uint16Array(TILE * TILE)
              for (let j = 0; j < TILE; j++)
                tile.set(
                  strip.subarray((MARGIN + j) * stride + i0, (MARGIN + j) * stride + i0 + TILE),
                  j * TILE,
                )
              detailTiles.push(tile)
              cluster.entries[t] = -detailTiles.length
            }
            onTile?.({
              level: li,
              ci0,
              cj0,
              x0,
              z0,
              turn: turnOf(li),
              stride,
              i0,
              j0: MARGIN,
              cells: strip,
              uniform: same,
            })
          }
        }
      }
    }

    // Atlas: detailed tiles in rows, two bytes (room + 1) per cell.
    this.atlasTilesW = atlasTilesW
    this.atlasTiles = detailTiles.length
    const atlasRows = Math.max(1, Math.ceil(detailTiles.length / atlasTilesW))
    const aw = atlasTilesW * TILE
    this.atlas = new Uint8Array(aw * atlasRows * TILE * 2)
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

    // Directory: per cell, the buildings whose clusters reach it (coarser cells on vast sites).
    // On the world axes: each cluster's rect, turned back, as a world box.
    const boxes: { building: number; x0: number; z0: number; x1: number; z1: number }[] = []
    for (const l of this.levels) {
      const [cos, sin] = this.turns[l.building] ?? IDENTITY
      for (const c of l.clusters) {
        const box = {
          building: l.building,
          x0: Number.POSITIVE_INFINITY,
          z0: Number.POSITIVE_INFINITY,
          x1: Number.NEGATIVE_INFINITY,
          z1: Number.NEGATIVE_INFINITY,
        }
        for (const tx of [c.tx0, c.tx0 + c.tw])
          for (const tz of [c.tz0, c.tz0 + c.th]) {
            const mx = this.originX + tx * TILE_M
            const mz = this.originZ + tz * TILE_M
            const x = mx * cos - mz * sin
            const z = mx * sin + mz * cos
            box.x0 = Math.min(box.x0, x)
            box.z0 = Math.min(box.z0, z)
            box.x1 = Math.max(box.x1, x)
            box.z1 = Math.max(box.z1, z)
          }
        boxes.push(box)
      }
    }
    this.dirX = boxes.reduce((min, box) => Math.min(min, box.x0), Number.POSITIVE_INFINITY)
    this.dirZ = boxes.reduce((min, box) => Math.min(min, box.z0), Number.POSITIVE_INFINITY)
    if (!boxes.length) this.dirX = this.dirZ = 0
    // Whole tiles; a hair under, so a box ending on a tile edge doesn't claim the next tile.
    const tiles = (metres: number) => Math.max(0, Math.ceil(metres / TILE_M - 1e-6))
    const maxTx = boxes.reduce((max, box) => Math.max(max, tiles(box.x1 - this.dirX)), 0)
    const maxTz = boxes.reduce((max, box) => Math.max(max, tiles(box.z1 - this.dirZ)), 0)
    this.dirTiles = Math.max(8, Math.ceil(Math.sqrt((maxTx * maxTz) / MAX_DIR_CELLS)))
    this.dirW = Math.max(1, Math.ceil(maxTx / this.dirTiles))
    this.dirH = Math.max(1, Math.ceil(maxTz / this.dirTiles))
    this.dirLists = Array.from({ length: this.dirW * this.dirH }, () => [])
    const dirCell = (metres: number) => Math.floor(metres / TILE_M / this.dirTiles)
    for (const box of boxes)
      for (
        let dz = dirCell(box.z0 - this.dirZ + 1e-6);
        dz <= Math.min(this.dirH - 1, dirCell(box.z1 - this.dirZ - 1e-6));
        dz++
      )
        for (
          let dx = dirCell(box.x0 - this.dirX + 1e-6);
          dx <= Math.min(this.dirW - 1, dirCell(box.x1 - this.dirX - 1e-6));
          dx++
        ) {
          const list = this.dirLists[dz * this.dirW + dx]!
          if (!list.includes(box.building)) list.push(box.building)
        }

    this.upload()
  }

  /** CPU lookup in assembled space (same rule as the shader). */
  roomAt(x: number, y: number, z: number): number {
    const dx = Math.floor((x - this.dirX) / TILE_M / this.dirTiles)
    const dz = Math.floor((z - this.dirZ) / TILE_M / this.dirTiles)
    if (dx < 0 || dz < 0 || dx >= this.dirW || dz >= this.dirH) return -1
    for (const b of this.dirLists[dz * this.dirW + dx]!) {
      const [start, count] = this.buildingRange[b]!
      let found = start
      for (let pos = start; pos < start + count; pos++)
        if (this.levels[this.order[pos]!]!.y <= y - 0.12) found = pos
      // The point in the building's turned frame.
      const [cos, sin] = this.turns[b]!
      const mx = x * cos + z * sin
      const mz = z * cos - x * sin
      const tx = Math.floor((mx - this.originX) / TILE_M)
      const tz = Math.floor((mz - this.originZ) / TILE_M)
      const room = this.levelRoomAt(this.order[found]!, mx, mz, tx, tz)
      if (room >= 0) return room
    }
    return -1
  }

  /**
   * A level's room at a point of its building's frame; clusters' rects can overlap (a wing around
   * a courtyard pavilion).
   */
  private levelRoomAt(li: number, x: number, z: number, tx: number, tz: number) {
    for (const c of this.levels[li]!.clusters) {
      const lx = tx - c.tx0
      const lz = tz - c.tz0
      if (lx < 0 || lz < 0 || lx >= c.tw || lz >= c.th) continue
      const e = c.entries[lz * c.tw + lx]!
      if (e > 0) return e - 1
      if (e === 0) continue
      const a = -e - 1
      const ci = Math.floor((x - this.originX) / CELL) - tx * TILE
      const cj = Math.floor((z - this.originZ) / CELL) - tz * TILE
      const aw = this.atlasTilesW * TILE
      const k =
        ((Math.floor(a / this.atlasTilesW) * TILE + cj) * aw + (a % this.atlasTilesW) * TILE + ci) *
        2
      const room = this.atlas[k]! + this.atlas[k + 1]! * 256 - 1
      if (room >= 0) return room
    }
    return -1
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
      const off = offsets[level] ?? 0
      const flags = (focused[level] ? 1 : 0) + (shown[level] !== false ? 2 : 0)
      const t = pos * 8
      const liveY = this.levels[level]!.y + off
      if (this.levelData[t] !== liveY) {
        this.levelData[t] = liveY
        changed = true
      }
      if (this.levelData[t + 6] !== off || this.levelData[t + 7] !== flags) {
        this.levelData[t + 6] = off
        this.levelData[t + 7] = flags
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
    // index: [directory cells] [directory lists] [clusters, 2 texels] [entries]
    const dirCells = this.dirW * this.dirH
    const listTexels = this.dirLists.reduce((s, l) => s + l.length, 0)
    const clusterCount = this.levels.reduce((s, l) => s + l.clusters.length, 0)
    const entryTexels = this.levels.reduce(
      (s, l) => s + l.clusters.reduce((t, c) => t + c.entries.length, 0),
      0,
    )
    const texels = dirCells + listTexels + clusterCount * 2 + entryTexels + 1
    // As wide as the device allows, so a vast site's directory still fits.
    const indexW = Math.min(this.textureLimit, 4096)
    const rows = Math.max(1, Math.ceil(texels / indexW))
    if (rows > this.textureLimit)
      console.warn('[daylight] room map index exceeds the device texture limit')
    const index = new Float32Array(indexW * rows * 4)
    let list = dirCells
    this.dirLists.forEach((buildings, c) => {
      index[c * 4] = list
      index[c * 4 + 1] = buildings.length
      for (const b of buildings) {
        const [start, count] = this.buildingRange[b]!
        index.set([start, count, ...this.turns[b]!], list * 4)
        list++
      }
    })
    const clusterStart = new Array<number>(this.levels.length).fill(0)
    let cluster = list
    let entry = list + clusterCount * 2
    this.levels.forEach((l, li) => {
      clusterStart[li] = cluster
      for (const c of l.clusters) {
        index.set([c.tx0, c.tz0, c.tw, c.th, entry, 0, 0, 0], cluster * 4)
        for (let k = 0; k < c.entries.length; k++) index[(entry + k) * 4] = c.entries[k]!
        entry += c.entries.length
        cluster += 2
      }
    })
    this.indexBytes = index.byteLength

    // levels (GPU order): [liveY, clusterStart, clusterCount, 0] [0, 0, offset, flags]
    const levelRows = Math.max(1, Math.ceil((this.order.length * 2) / LEVEL_W))
    this.levelData = new Float32Array(LEVEL_W * levelRows * 4)
    this.order.forEach((level, pos) => {
      const l = this.levels[level]!
      this.levelData.set([l.y, clusterStart[level]!, l.clusters.length, 0, 0, 0, 0, 2], pos * 8)
    })

    const aw = this.atlasTilesW * TILE
    replace(this.u.index, floatTexture(index, indexW, rows))
    replace(this.u.levels, floatTexture(this.levelData, LEVEL_W, levelRows))
    replace(this.u.atlas, byteTexture(this.atlas, aw, this.atlas.length / 2 / aw))
    ;(this.u.origin.value as Vector2).set(this.originX, this.originZ)
    ;(this.u.dirOrigin.value as Vector2).set(this.dirX, this.dirZ)
    ;(this.u.turn.value as Vector2).set(...(this.turns[0] ?? IDENTITY))
    this.u.indexW.value = indexW
    this.u.dirTiles.value = this.dirTiles
    this.u.dirW.value = this.dirW
    this.u.dirH.value = this.dirH
    this.u.atlasTilesW.value = this.atlasTilesW
    this.u.single.value = this.buildingRange.length <= 1 ? 1 : 0
    this.u.singleCount.value = this.buildingRange[0]?.[1] ?? 0
    this.u.searchSteps.value = this.buildingRange.reduce(
      (steps, [, count]) => Math.max(steps, Math.ceil(Math.log2(count + 1))),
      0,
    )
  }

  // ---- TSL ---------------------------------------------------------------------------------

  private indexTexel(i: N): N {
    const k = int(i)
    return this.u.index.load(ivec2(k.mod(this.u.indexW), k.div(this.u.indexW)))
  }

  /** [liveY, clusterStart, clusterCount, 0] of the level at GPU position `pos`. */
  levelTexel0(pos: N): N {
    const k = int(pos).mul(2)
    return this.u.levels.load(ivec2(k.mod(LEVEL_W), k.div(LEVEL_W)))
  }

  /** [0, 0, offset, flags] of the level at GPU position `pos`. */
  levelTexel1(pos: N): N {
    const k = int(pos).mul(2).add(1)
    return this.u.levels.load(ivec2(k.mod(LEVEL_W), k.div(LEVEL_W)))
  }

  /** Room index (−1 outside) at a world-space position (live heights). */
  roomAtNode = Fn(([p]: [N]) => {
    const u = this.u
    const room = int(-1).toVar()
    // Candidate buildings: the only one, or the directory cell's list.
    const count = int(0).toVar()
    const listStart = int(0).toVar()
    If(u.single.equal(1), () => {
      count.assign(1)
    }).Else(() => {
      const dir = ivec2((floor as N)(p.xz.sub(u.dirOrigin).div(TILE_M).div(u.dirTiles)))
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
        const turn = u.turn.toVar()
        If(u.single.equal(0), () => {
          const range = this.indexTexel(listStart.add(i))
          start.assign(int(range.x))
          levels.assign(int(range.y))
          turn.assign(range.zw)
        })
        // The point in the building's turned frame, from the site origin.
        const m = vec2(p.x.mul(turn.x).add(p.z.mul(turn.y)), p.z.mul(turn.x).sub(p.x.mul(turn.y)))
          .sub(u.origin)
          .toVar()
        const tile = ivec2((floor as N)(m.div(TILE_M))).toVar()
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
        const level = this.levelTexel0(found)
        // Clusters' rects can overlap: the first one holding a room at the point wins.
        Loop({ start: int(0), end: int(level.z), type: 'int', condition: '<' }, ({ i: c }: N) => {
          If(room.lessThan(0), () => {
            const base = int(level.y).add(c.mul(2))
            const rect = this.indexTexel(base)
            const local = tile.sub(ivec2(int(rect.x), int(rect.y)))
            If(
              local.x
                .greaterThanEqual(0)
                .and(local.y.greaterThanEqual(0))
                .and(local.x.lessThan(int(rect.z)))
                .and(local.y.lessThan(int(rect.w))),
              () => {
                const entryStart = int(this.indexTexel(base.add(1)).x)
                const e = this.indexTexel(entryStart.add(local.y.mul(int(rect.z))).add(local.x)).x
                If(e.greaterThan(0.5), () => {
                  room.assign(int(round(e)).sub(1))
                }).ElseIf(e.lessThan(-0.5), () => {
                  const a = int(round(e.negate())).sub(1)
                  const cell = ivec2((floor as N)(m.div(CELL))).sub(tile.mul(TILE))
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
      })
    })
    return room
  })
}

// ---- build helpers --------------------------------------------------------------------------

const IDENTITY: [number, number] = [1, 0]

/** Groups a level's rooms whose padded tile rects lie within `CLUSTER_GAP` tiles of each other. */
function clusterRooms(
  members: number[],
  rects: { tx0: number; tz0: number; tx1: number; tz1: number }[],
): number[][] {
  const parent = members.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const order = members
    .map((_, i) => i)
    .sort((a, b) => rects[members[a]!]!.tx0 - rects[members[b]!]!.tx0)
  for (let a = 0; a < order.length; a++) {
    const ra = rects[members[order[a]!]!]!
    for (let b = a + 1; b < order.length; b++) {
      const rb = rects[members[order[b]!]!]!
      if (rb.tx0 > ra.tx1 + CLUSTER_GAP) break
      if (rb.tz0 <= ra.tz1 + CLUSTER_GAP && ra.tz0 <= rb.tz1 + CLUSTER_GAP)
        parent[find(order[a]!)] = find(order[b]!)
    }
  }
  const groups = new Map<number, number[]>()
  members.forEach((ri, i) => {
    const root = find(i)
    const group = groups.get(root)
    if (group) group.push(ri)
    else groups.set(root, [ri])
  })
  return [...groups.values()]
}

function ringArea(ring: [number, number][]) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1]
  return a / 2
}

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

/** Marks the cells one footprint triangle (`t[at…at+5]`, world XZ) reaches. */
function markWall(
  t: ArrayLike<number>,
  at: number,
  wall: Uint8Array,
  width: number,
  height: number,
  x0: number,
  z0: number,
) {
  const zMin = Math.min(t[at + 1]!, t[at + 3]!, t[at + 5]!)
  const zMax = Math.max(t[at + 1]!, t[at + 3]!, t[at + 5]!)
  const j0 = Math.max(0, Math.ceil((zMin - WALL_REACH - z0) / CELL - 0.5))
  const j1 = Math.min(height - 1, Math.floor((zMax + WALL_REACH - z0) / CELL - 0.5))
  for (let j = j0; j <= j1; j++) {
    // The triangle's x extent inside the band of z this row's cell centres reach.
    const lo = z0 + (j + 0.5) * CELL - WALL_REACH
    const hi = lo + 2 * WALL_REACH
    let xMin = Number.POSITIVE_INFINITY
    let xMax = Number.NEGATIVE_INFINITY
    for (let a = 0; a < 3; a++) {
      const xa = t[at + a * 2]!
      const za = t[at + a * 2 + 1]!
      const xb = t[at + ((a + 1) % 3) * 2]!
      const zb = t[at + ((a + 1) % 3) * 2 + 1]!
      if (za >= lo && za <= hi) {
        xMin = Math.min(xMin, xa)
        xMax = Math.max(xMax, xa)
      }
      for (const z of [lo, hi])
        if (za < z !== zb < z) {
          const x = xa + ((xb - xa) * (z - za)) / (zb - za)
          xMin = Math.min(xMin, x)
          xMax = Math.max(xMax, x)
        }
    }
    if (xMin > xMax) continue
    const i0 = Math.max(0, Math.ceil((xMin - WALL_REACH - x0) / CELL - 0.5))
    const i1 = Math.min(width - 1, Math.floor((xMax + WALL_REACH - x0) / CELL - 0.5))
    if (i1 >= i0) wall.fill(1, j * width + i0, j * width + i1 + 1)
  }
}

/**
 * Two passes of 4-neighbour growth into empty cells: wall thickness and polygon slop resolve.
 * A room grows into a wall but never out of it: past a wall's far face is outside, wherever the
 * room's outline runs inside the wall (its centre line, or either face).
 */
function dilate(
  cells: Uint16Array,
  scratch: Uint16Array,
  width: number,
  height: number,
  wall?: Uint8Array,
) {
  const steps = [-1, 1, -width, width]
  for (let pass = 0; pass < 2; pass++) {
    scratch.set(cells)
    for (let j = 1; j < height - 1; j++)
      for (let i = 1; i < width - 1; i++) {
        const k = j * width + i
        if (scratch[k]) continue
        const open = !wall || wall[k] === 1
        for (const step of steps) {
          const n = scratch[k + step]!
          if (n && (open || !wall?.[k + step])) {
            cells[k] = n
            break
          }
        }
      }
  }
}

/** The most common value among a tile's own cells. */
function majority(cells: Uint16Array, stride: number, i0: number) {
  const counts = new Map<number, number>()
  for (let j = MARGIN; j < MARGIN + TILE; j++)
    for (let i = i0; i < i0 + TILE; i++) {
      const v = cells[j * stride + i]!
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
