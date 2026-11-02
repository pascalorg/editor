import { foldRoomName } from '../building/room-use'
import type { AnyNode, SceneMaterial, WallNode, ZoneNode } from '../schema'
import { standsAgainst } from './dress-targets'
import { itemPlanAabbInLevel } from './item-space'
import { wallResolvedHeight } from './level-reads'
import { type RoomWallFace, roomWallFaces } from './room-faces'
import { describeFinish, wallFaceFinish } from './room-finishes'
import type { RoomPiece } from './room-readings'
import { finishTiled, type Tiled } from './room-tile'
import type { SceneNodes } from './types'

/**
 * What a wet room is tiled to: a bathroom, shower room, WC or laundry counts tiled when the walls its
 * fixtures stand against are tiled to `WET_TILED_TO_M`, and to the ceiling around its shower. The
 * wall faces read are the stretches a shower, bath, basin or toilet stands against (within
 * `STANDS_AGAINST_M` of the face), else, when none can be placed, every face of the room. A face is
 * tiled to a height when tile covers at least `COVERED` of its stretch up to there; what covers it is
 * read as the renderer layers it (the base finish, then the face's regions, a later one over an
 * earlier). A face a script builds, or a finish the nodes cannot name, is `unknown`, and unknown
 * never fails a room.
 */

/** A wet room's walls are tiled up to this, metres. */
export const WET_TILED_TO_M = 1.2
/** The share of a face's stretch tile must cover to count as tiled there. */
export const COVERED = 0.8
/** Tile may stop this short of a height and still count as reaching it, metres. */
const SLACK_M = 0.02
/** Where "to the ceiling" begins, metres under the top of the wall. */
const CEILING_SLACK_M = 0.05
/** How far a shower's stretch reaches past it each side, metres. */
const SHOWER_MARGIN_M = 0.1
/** A shower hung on a wall has no footprint: this much of the wall each side of it is its stretch. */
const HUNG_REACH_M = 0.45
const STEP_M = 0.05

const FIXTURE_WORDS = new Set([
  'shower',
  'showers',
  'douche',
  'douches',
  'bath',
  'baths',
  'bathtub',
  'bathtubs',
  'tub',
  'tubs',
  'baignoire',
  'baignoires',
  'sink',
  'sinks',
  'basin',
  'basins',
  'washbasin',
  'washbasins',
  'lavabo',
  'lavabos',
  'vasque',
  'vasques',
  'vanity',
  'vanities',
  'toilet',
  'toilets',
  'wc',
  'cuvette',
  'bidet',
  'bidets',
  'washer',
  'washing',
  'lave',
  'laundry',
])
const SHOWER_WORDS = new Set(['shower', 'showers', 'douche', 'douches'])

/** What a piece is, in words: its kind (a category, else its name without its room's words), never its name, so a "shower mirror" is a mirror. */
const wordsOf = (piece: Pick<RoomPiece, 'kind'>) =>
  foldRoomName(piece.kind)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const isFixture = (piece: RoomPiece) => wordsOf(piece).some((word) => FIXTURE_WORDS.has(word))
const isShower = (piece: RoomPiece) => wordsOf(piece).some((word) => SHOWER_WORDS.has(word))

export type WetReading = {
  /** True when the faces read are those fixtures stand against; false when every face was read. */
  byFixtures: boolean
  /** The least height tile reaches over the faces read, covering 80% of each stretch, metres; null when unreadable. */
  tiledTo: number | null
  /** Whether tile shows anywhere on those faces. */
  anyTile: boolean
  /** Whether those faces are tiled to `WET_TILED_TO_M`. */
  tiled: Tiled
  /** The showers standing against a wall, and whether tile reaches the ceiling around each. */
  showers: { id: string; name: string; full: Tiled }[]
  /** `no` when the walls are short of the height or a shower's surround is: what the finding reads. */
  verdict: Tiled
}

type Cover = { u0: number; u1: number; v0: number; v1: number; state: Tiled }

/** The layers a face shows, bottom to top. */
function layersOf(
  zone: ZoneNode,
  wall: WallNode,
  stretch: RoomWallFace,
  height: number,
  materials: Readonly<Record<string, SceneMaterial>> | undefined,
): Cover[] {
  const { face, length } = stretch
  const layers: Cover[] = [
    {
      u0: 0,
      u1: length,
      v0: 0,
      v1: height,
      state: finishTiled(wallFaceFinish(zone, wall, face, materials), materials),
    },
  ]
  const script = wall.finishScripts?.[face]
  if (script)
    layers.push({
      u0: 0,
      u1: length,
      v0: 0,
      v1: Math.min(height, script.toHeight ?? height),
      state: 'unknown',
    })
  for (const region of wall.faceRegions ?? []) {
    if (region.face !== face) continue
    layers.push({
      u0: region.u0 ?? 0,
      u1: region.u1 ?? length,
      v0: region.v0 ?? 0,
      v1: Math.min(height, region.v1 ?? height),
      state: finishTiled(describeFinish(region.finish, materials), materials),
    })
  }
  return layers
}

/** How high tile runs unbroken from the floor at one point along a face, and whether what stops it is unreadable. */
function tileRun(layers: readonly Cover[], u: number, height: number) {
  const here = layers.filter((layer) => u >= layer.u0 && u <= layer.u1)
  const stops = [...new Set([0, height, ...here.flatMap((layer) => [layer.v0, layer.v1])])]
    .filter((v) => v >= 0 && v <= height)
    .sort((a, b) => a - b)
  for (let index = 0; index + 1 < stops.length; index++) {
    const [low, high] = [stops[index]!, stops[index + 1]!]
    if (high - low < 1e-6) continue
    const mid = (low + high) / 2
    const state = here.filter((layer) => mid >= layer.v0 && mid <= layer.v1).at(-1)?.state ?? 'no'
    if (state !== 'yes') return { top: low, open: state === 'unknown' }
  }
  return { top: height, open: false }
}

/** Tile heights sampled along a stretch of a face: where the unbroken run from the floor ends at each point, and whether an unreadable finish stops it. */
export type Read = { tops: number[]; open: boolean[] }

export function readStretch(
  nodes: SceneNodes,
  zone: ZoneNode,
  stretch: RoomWallFace,
  range: { u0: number; u1: number },
  materials: Readonly<Record<string, SceneMaterial>> | undefined,
): Read & { height: number } {
  const wall = nodes[stretch.wallId] as WallNode
  const height = wallResolvedHeight(nodes, wall)
  const layers = layersOf(zone, wall, stretch, height, materials)
  const count = Math.max(1, Math.ceil((range.u1 - range.u0) / STEP_M))
  const runs = Array.from({ length: count }, (_, index) =>
    tileRun(layers, range.u0 + ((index + 0.5) * (range.u1 - range.u0)) / count, height),
  )
  return { height, tops: runs.map((run) => run.top), open: runs.map((run) => run.open) }
}

/** Whether tile covers 80% of the samples up to `target`: yes, no, or unknown where unreadable parts could. */
export function reaches(read: Read, target: number): Tiled {
  const n = read.tops.length
  const yes = read.tops.filter((top) => top >= target - SLACK_M).length
  const maybe = read.tops.filter((top, i) => top < target - SLACK_M && read.open[i]).length
  if (yes >= COVERED * n - 1e-9) return 'yes'
  return yes + maybe >= COVERED * n - 1e-9 ? 'unknown' : 'no'
}

/** The height 80% of the samples reach at least. */
export const coveredTo = (read: Read) =>
  [...read.tops].sort((a, b) => a - b)[Math.floor((1 - COVERED) * read.tops.length - 1e-9)] ??
  read.tops[0]!

const combine = (states: readonly Tiled[]): Tiled =>
  states.includes('no') ? 'no' : states.includes('unknown') ? 'unknown' : 'yes'

/** The stretch of a face a piece stands against, margin added, or undefined when it does not. */
function against(
  nodes: SceneNodes,
  byId: Map<string, AnyNode>,
  stretch: RoomWallFace,
  piece: RoomPiece,
  margin: number,
): { u0: number; u1: number } | undefined {
  if (stretch.curved) return undefined
  if (piece.hung) {
    if (piece.hung.wallId !== stretch.wallId || piece.hung.face !== stretch.face) return undefined
    const u0 = Math.max(stretch.u0, piece.hung.u - HUNG_REACH_M)
    const u1 = Math.min(stretch.u1, piece.hung.u + HUNG_REACH_M)
    return u1 > u0 ? { u0, u1 } : undefined
  }
  const item = nodes[piece.id]
  const box = item?.type === 'item' ? itemPlanAabbInLevel(item, byId) : null
  if (!box) return undefined
  const { minX, maxX, minZ, maxZ } = box
  return standsAgainst(
    nodes[stretch.wallId] as WallNode,
    stretch,
    [
      [minX, minZ],
      [maxX, minZ],
      [maxX, maxZ],
      [minX, maxZ],
    ],
    margin,
  )
}

/** A wet room's walls against what it is tiled to; undefined for a room with no wall face. */
export function readWet(
  nodes: SceneNodes,
  byId: Map<string, AnyNode>,
  zone: ZoneNode,
  pieces: readonly RoomPiece[],
  materials: Readonly<Record<string, SceneMaterial>> | undefined,
): WetReading | undefined {
  const stretches = roomWallFaces(nodes, zone)
  if (!stretches.length) return undefined
  const fixtures = pieces.filter(isFixture)
  const wetKeys = new Set<string>()
  for (const stretch of stretches)
    if (fixtures.some((piece) => against(nodes, byId, stretch, piece, 0)))
      wetKeys.add(`${stretch.wallId}/${stretch.face}/${stretch.t0}`)
  const byFixtures = wetKeys.size > 0
  const read = stretches.filter(
    (stretch) => !byFixtures || wetKeys.has(`${stretch.wallId}/${stretch.face}/${stretch.t0}`),
  )

  const reads = read.map((stretch) => readStretch(nodes, zone, stretch, stretch, materials))
  const tiled = combine(reads.map((r) => reaches(r, WET_TILED_TO_M)))
  const readable = reads.every((r) => !r.open.some(Boolean))
  const tiledTo = readable ? Math.min(...reads.map(coveredTo)) : null

  const showers = pieces.filter(isShower).flatMap((piece) => {
    const fulls = stretches.flatMap((stretch) => {
      const range = against(nodes, byId, stretch, piece, SHOWER_MARGIN_M)
      if (!range) return []
      const there = readStretch(nodes, zone, stretch, range, materials)
      return [reaches(there, there.height - CEILING_SLACK_M)]
    })
    return fulls.length ? [{ id: piece.id, name: piece.name, full: combine(fulls) }] : []
  })

  return {
    byFixtures,
    tiledTo,
    anyTile: reads.some((r) => r.tops.some((top) => top > SLACK_M)),
    tiled,
    showers,
    verdict: combine([tiled, ...showers.map((shower) => shower.full)]),
  }
}
