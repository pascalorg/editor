import type { AuthorScenePayload } from '../agent-tools/author-scene'
import { refuse } from '../agent-tools/refusal'
import { doorTypeFields } from '../building/door-types'
import {
  DOOR_STYLES,
  type DoorStyle,
  doorStyleLook,
  getWindowStyleOverrides,
  WINDOW_STYLES,
  type WindowStyle,
} from '../building/opening-style-presets'
import { windowTakesStyle, windowTypeFields } from '../building/window-types'
import { floorRoomFaces } from '../lib/floor-room-faces'
import {
  matchScriptSlotsToLibrary,
  requireMeasured,
  scriptedSize,
  scriptSource,
} from '../lib/geometry-script-node'
import type { BoundaryNode } from '../lib/room-topology-index'
import { detectSpacesForLevel } from '../lib/space-detection'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import { wallFaceScriptInputs } from '../lib/wall-face-script'
import { nearestLibraryColorRef } from '../procedural-items/library-colors'
import {
  type AnyNode,
  type CeilingNode,
  ColumnNode,
  type CompiledGeometryScript,
  DoorNode,
  type GeometryArtifactManifest,
  LevelNode,
  type SceneMaterial,
  type SceneMaterialId,
  SlabNode,
  type WallFace,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import { DoorType, WindowType } from '../schema/nodes/opening-types'
import { resolveCeilingHeight } from '../services/level-height'
import { CEILING_DRAW_OFFSET } from '../services/storey'
import { getWallLocalFaceZ } from '../systems/wall/wall-frame'
import { roomFaceCover } from '../systems/wall/wall-room-sides'
import { migrateRoomZones } from '../utils/room-zone-migration'
import { addObject } from './add-object'
import { authoredSceneChanges } from './authored-scene-merge'
import { paint } from './paint'
import { pointInPolygon, projectWorldPointToWallLocalX, type Vec2 } from './plan-geometry'
import { resolveInlinePaintMaterial } from './scene-materials'
import { queryNodes } from './scene-queries'
import type { AgentContext, AgentOperationOutcome, SceneNodes } from './types'
import { setWallSkirting } from './wall-skirting'

/**
 * `author_scene`: a whole design, read by its author from the three.js module it wrote, handed
 * over as a payload and written as native Pascal nodes in one step. Not in AGENT_OPERATIONS: the
 * host compiles every module first (the MCP on its server, the chat in its worker) and passes the
 * results as `compiled`, keyed by the payload's item ids and, for an opening with code, by
 * `<wallId>/<index>`. Candidate ceiling points use `light/<level>/<index>` from
 * `authorSceneCeilingPoints`; a module whose compile failed is absent and comes back in the report
 * with the host's reason.
 *
 * The policy, decided with the owner: accept and report. Everything valid is written; every
 * defect comes back by the payload's own id with a reason; what Pascal fills in or drops is a
 * sentence in `defaults`; what it writes but doubts is a `warning`. Its join rule snaps a wall
 * end within reach of another wall's centerline onto it, reported per wall. Ids are derived from the payload, so the same payload writes the same
 * scene.
 */
export type AuthorSceneInput = {
  payload: AuthorScenePayload
  compiled: Record<string, CompiledGeometryScript>
  /** Why a module did not compile, keyed like `compiled`, for the report. */
  compileErrors?: Record<string, string>
  replace?: boolean
  buildingId?: string
  /** Hosts compile finishes against the candidate before making one scene commit. */
  prepareOnly?: boolean
}

export type AuthorSceneState = {
  version: 1
  buildingId: string
  seed: string
  ids: Record<string, string>
  nodes: Record<string, AnyNode>
}

export type AuthorSceneDefect = { id: string; code: string; message: string }

export type AuthorSceneReport = {
  levels: number
  walls: number
  doors: number
  windows: number
  rooms: number
  roomsNamed: number
  slabs: number
  columns: number
  items: number
  lights: number
  /** Rooms whose floor finish is their module, counted by the host that compiles them after the write. */
  floorScripts: number
  /** Wall faces whose finish is a module, counted by the host that compiles them after the write. */
  faceScripts: number
  /** The join rule applied: wall ends moved onto a centerline, with how far. */
  snapped: { id: string; end: 'start' | 'end'; movedM: number }[]
  /** What Pascal filled in or dropped, one sentence per fact. */
  defaults: string[]
  /** Written, but doubtful: by the payload's id, with a code. */
  warnings: AuthorSceneDefect[]
  defects: AuthorSceneDefect[]
  notes: string[]
  /** Payload ids, `wall/i` openings, `room/level/i`, and `light/level/i` ceiling points to nodes. */
  ids: Record<string, string>
}

const JOIN_REACH = 0.3
const THIN_SLAB = 0.02
const MANY_SLABS = 20
const MANY_REGIONS = 24
const HEX = /^#[0-9a-f]{6}$/i
const GLASS = 'library:preset-glass'

type Vec3 = [number, number, number]
type AuthorSceneWall = NonNullable<AuthorScenePayload['levels'][number]['walls']>[number]

/**
 * Explicit payload keys retain their identities across revisions; derived nodes use the
 * conversion's retained seed. A changed payload never remints every existing wall or item.
 */
function idFactory(seed: string, previous: Record<string, string> = {}) {
  const counts = new Map<string, number>()
  return (kind: string, key?: string) => {
    const n = (counts.get(kind) ?? 0) + 1
    counts.set(kind, n)
    if (key && previous[key]?.startsWith(`${kind}_`)) return previous[key]!
    let hash = 0x811c9dc5
    for (const ch of `${seed}:${kind}:${key ?? n}`)
      hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
    return `${kind}_as${hash.toString(16).padStart(8, '0')}`
  }
}

function payloadSeed(payload: AuthorScenePayload) {
  let hash = 0x811c9dc5
  for (const ch of JSON.stringify(payload))
    hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return hash.toString(16)
}

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)

const metres = (value: number) => `${value.toFixed(2)} m`

/**
 * Where a wall end meets another wall's centerline: the projection onto that line, as long as it
 * lands on the wall or within reach past its ends. The line, not the segment, so a partition
 * stopping short of a wall extends to it, and the wall it meets does not slide to the partition.
 */
function nearestOnSegment(p: readonly number[], a: readonly number[], b: readonly number[]) {
  const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) || 1
  const t = ((p[0]! - a[0]!) * (b[0]! - a[0]!) + (p[1]! - a[1]!) * (b[1]! - a[1]!)) / (len * len)
  if (t * len < -JOIN_REACH || (t - 1) * len > JOIN_REACH)
    return { point: [p[0]!, p[1]!] as [number, number], distance: Number.POSITIVE_INFINITY }
  const q: [number, number] = [a[0]! + t * (b[0]! - a[0]!), a[1]! + t * (b[1]! - a[1]!)]
  return { point: q, distance: dist(p, q) }
}

const cross = (o: Vec2, a: Vec2, b: Vec2) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Whether two segments cross each other's interior (touching ends and shared edges do not). */
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const [d1, d2, d3, d4] = [cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)]
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Whether two polygons share interior area: a slab flush against a wall's face does not. */
function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  if (a.some((p) => pointInPolygon(p, b, false)) || b.some((p) => pointInPolygon(p, a, false)))
    return true
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (segmentsCross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true
  return false
}

/** A wall's footprint, pulled in by a few millimetres so a slab meeting its face is not on it. */
function wallFootprint(wall: { start: Vec2; end: Vec2; thickness: number }): Vec2[] {
  const inset = 0.005
  const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const len = Math.hypot(dx, dz) || 1
  const [ux, uz] = [dx / len, dz / len]
  const half = Math.max(wall.thickness / 2 - inset, 0.001)
  const s: Vec2 = [wall.start[0] + ux * inset, wall.start[1] + uz * inset]
  const e: Vec2 = [wall.end[0] - ux * inset, wall.end[1] - uz * inset]
  return [
    [s[0] - uz * half, s[1] + ux * half],
    [e[0] - uz * half, e[1] + ux * half],
    [e[0] + uz * half, e[1] - ux * half],
    [s[0] + uz * half, s[1] - ux * half],
  ]
}

/**
 * Where an item stands and which way it faces, so what rests on it (another item, a light) is
 * written in its frame: Pascal keeps a hosted thing's position relative to its host.
 */
type Frame = { position: Vec3; yaw: number }

function toLocal(frame: Frame, world: Vec3): Vec3 {
  const [dx, dy, dz] = [
    world[0] - frame.position[0],
    world[1] - frame.position[1],
    world[2] - frame.position[2],
  ]
  const [c, s] = [Math.cos(frame.yaw), Math.sin(frame.yaw)]
  return [c * dx - s * dz, dy, s * dx + c * dz]
}

/** How a colour's surface reflects: a module's own values, or a matte paint for a payload colour. */
type Surface = { roughness: number; metalness: number }
const MATTE: Surface = { roughness: 0.9, metalness: 0 }

/**
 * The finish a payload value writes. A library or scene ref passes through; a hex colour is kept
 * as an exact native material, one scene material per distinct colour and surface across the
 * payload, named by them. A host that keeps no scene materials gets the nearest library colour,
 * said once.
 */
function finishPool(context: AgentContext, say: (sentence: string) => void) {
  const materials: Record<SceneMaterialId, SceneMaterial> | undefined = context.materials
    ? { ...context.materials }
    : undefined
  const created: SceneMaterial[] = []
  let snapped = false
  return {
    materials,
    created,
    ref(value: string, surface: Surface = MATTE): { ref: string } | { error: string } {
      if (value.startsWith('library:') || value.startsWith('scene:')) return { ref: value }
      if (!HEX.test(value)) return { error: `${value} is no colour: give #rrggbb or library:<id>.` }
      const hex = value.toLowerCase()
      if (!materials) {
        if (!snapped)
          say('this host keeps no scene materials: colours written as the nearest library colour')
        snapped = true
        return { ref: nearestLibraryColorRef(hex)!.ref }
      }
      const resolved = resolveInlinePaintMaterial(
        materials,
        {
          properties: {
            color: hex,
            roughness: surface.roughness,
            metalness: surface.metalness,
            opacity: 1,
            transparent: false,
            side: 'front',
          },
        },
        surface.roughness === MATTE.roughness && surface.metalness === MATTE.metalness
          ? hex
          : `${hex}, roughness ${+surface.roughness.toFixed(2)}, metalness ${+surface.metalness.toFixed(2)}`,
      )
      if (resolved.created) {
        materials[resolved.sceneMaterial.id as SceneMaterialId] = resolved.sceneMaterial
        created.push(resolved.sceneMaterial)
      }
      return { ref: resolved.ref }
    },
  }
}

const isDoorType = (type: string): type is DoorType => DoorType.options.includes(type as DoorType)
const isWindowType = (type: string): type is WindowType =>
  WindowType.options.includes(type as WindowType)
const isDoorStyle = (style: string): style is DoorStyle =>
  (DOOR_STYLES as readonly string[]).includes(style)
const isWindowStyle = (style: string): style is WindowStyle =>
  (WINDOW_STYLES as readonly string[]).includes(style)

const CEILING_POINT_CODE = `export const mount = 'ceiling'
export default function build({ THREE }) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff' })
  material.name = 'slot_body'
  return new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 24), material)
}`

/** Candidate modules, compiled by the host before room derivation decides which points are used. */
export function authorSceneCeilingPoints(
  payload: AuthorScenePayload,
): { id: string; code: string }[] {
  return payload.levels.flatMap((level, index) =>
    level.lights.flatMap((light, i) =>
      light.fixture ? [] : [{ id: `light/${index}/${i}`, code: CEILING_POINT_CODE }],
    ),
  )
}

/**
 * The rooms whose floor finish is a module, by their zone once the write made it: the host reads
 * each room's floor (`floorScriptInputs`), compiles the module for it and writes it with
 * `setRoomFloorScript`, which core cannot do without a three.js runtime. A room whose seed found
 * no enclosure has no zone and is already a defect.
 */
export function authorSceneFloorScripts(
  payload: AuthorScenePayload,
  report: Pick<AuthorSceneReport, 'ids'>,
): { roomId: string; zoneId: string; code: string }[] {
  return payload.levels.flatMap((level, index) =>
    level.rooms.flatMap((room, i) => {
      const roomId = `room/${index}/${i}`
      const zoneId = report.ids[roomId]
      return room.floorCode && zoneId ? [{ roomId, zoneId, code: room.floorCode }] : []
    }),
  )
}

/** A wall face whose finish is a module, for the host to compile once the write is applied. */
export type AuthorSceneFaceScript = {
  /** The payload's wall id. */
  wallId: string
  face: WallFace
  nodeId: string
  code: string
  toHeight?: number
}

/**
 * Which faces the payload's face modules build on, and why the others cannot be: a wall's own
 * `faceLeft` (face a) and `faceRight` (face b), then each room's `wallCode` on the faces its floor
 * meets (the spans of the room the zone was derived from, the faces `setWallSkirting` runs along),
 * where a wall's own module wins. A face with nothing to build on (a curved or curtain wall) or
 * that no room looks into is a `no_face` defect.
 */
function resolveFaceScripts(
  payload: AuthorScenePayload,
  ids: AuthorSceneReport['ids'],
  nodes: SceneNodes,
): {
  scripts: AuthorSceneFaceScript[]
  defects: AuthorSceneDefect[]
  warnings: AuthorSceneDefect[]
} {
  const scripts: AuthorSceneFaceScript[] = []
  const defects: AuthorSceneDefect[] = []
  const warnings: AuthorSceneDefect[] = []
  const side = (face: WallFace) => (face === 'a' ? 'left' : 'right')
  const add = (wallId: string, face: WallFace, nodeId: string, code: string, toHeight?: number) =>
    scripts.push({ wallId, face, nodeId, code, ...(toHeight === undefined ? {} : { toHeight }) })
  const flat = 'is curved, a curtain wall or has no height'
  payload.levels.forEach((level, index) => {
    const walls = (level.walls ?? []).flatMap((spec) => {
      const nodeId = ids[spec.id]
      return nodeId && nodes[nodeId]?.type === 'wall' ? [{ spec, nodeId }] : []
    })
    const owned = new Set<string>()
    for (const { spec, nodeId } of walls) {
      for (const [face, module] of [
        ['a', spec.faceLeft],
        ['b', spec.faceRight],
      ] as const) {
        if (!module) continue
        owned.add(`${nodeId}/${face}`)
        const id = `${spec.id}/${face}`
        if (!wallFaceScriptInputs(nodes, nodeId, face, module.toHeight))
          defects.push({
            id,
            code: 'no_face',
            message: `Wall ${spec.id} ${flat}: its ${side(face)} face has nothing a script can build on and keeps its paint.`,
          })
        else if (roomFaceCover(nodes, nodeId)[face] === 'none')
          defects.push({
            id,
            code: 'no_face',
            message: `No room looks into the ${side(face)} face of wall ${spec.id} (left and right as seen from its start to its end): its face script was not written.`,
          })
        else add(spec.id, face, nodeId, module.code, module.toHeight)
      }
    }
    const byRoom = new Map<string, { name: string; code: string; toHeight?: number }>()
    for (const [i, room] of level.rooms.entries()) {
      const roomId = `room/${index}/${i}`
      const zone = nodes[ids[roomId] ?? '']
      if (!room.wallCode || zone?.type !== 'zone') continue
      const boundaries = queryNodes<BoundaryNode>(nodes, {
        type: ['wall', 'separator'],
        parentId: zone.parentId ?? null,
      })
      const zoneWalls = [...zone.boundaryWallIds].sort().join()
      const derived = floorRoomFaces(boundaries).find(
        (r) =>
          [...new Set(r.spans.filter((s) => s.kind === 'wall').map((s) => s.boundaryId))]
            .sort()
            .join() === zoneWalls && pointInPolygon(room.seed as Vec2, r.referencePolygon),
      )
      const faces = new Set(
        (derived?.spans ?? [])
          .filter((s) => s.kind === 'wall' && s.t1 > s.t0)
          .map((s) => `${s.boundaryId}/${s.face}`),
      )
      if (!faces.size) {
        defects.push({
          id: roomId,
          code: 'no_face',
          message: `No wall face looks into "${room.name}": its wallCode was not written.`,
        })
        continue
      }
      for (const { spec, nodeId } of walls) {
        for (const face of ['a', 'b'] as const) {
          const key = `${nodeId}/${face}`
          if (!faces.has(key) || owned.has(key)) continue
          const other = byRoom.get(key)
          if (other) {
            if (other.code !== room.wallCode || other.toHeight !== room.wallToHeight)
              warnings.push({
                id: `${spec.id}/${face}`,
                code: 'face_shared',
                message: `The ${side(face)} face of wall ${spec.id} looks into "${other.name}" and "${room.name}": it is built by "${other.name}"'s wallCode.`,
              })
            continue
          }
          byRoom.set(key, { name: room.name, code: room.wallCode, toHeight: room.wallToHeight })
          if (!wallFaceScriptInputs(nodes, nodeId, face, room.wallToHeight))
            defects.push({
              id: `${spec.id}/${face}`,
              code: 'no_face',
              message: `Wall ${spec.id} ${flat}: "${room.name}"'s wallCode was not written on its ${side(face)} face, which keeps its paint.`,
            })
          else add(spec.id, face, nodeId, room.wallCode, room.wallToHeight)
        }
      }
    }
  })
  return { scripts, defects, warnings }
}

/** Below this share a floor or face finish leaves enough of its host bare to be worth a warning. */
const FINISH_COVERED = 0.98

/** Where a floor or face script's build was compiled: the room's floor outline, or the wall's face. */
export type AuthorSceneFinishHost =
  | { room: string; polygon: [number, number][] }
  | { wall: string; face: WallFace }

const figure = (value: number) => String(Math.round(value * 100) / 100)

/** A bare patch on a floor, by the edges of the floor's bounds it runs along, and its extent. */
function floorPatch(
  { min, max }: { min: [number, number]; max: [number, number] },
  polygon: [number, number][],
): string {
  const reach = 0.05
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  const touches = {
    north: min[1] <= Math.min(...zs) + reach,
    south: max[1] >= Math.max(...zs) - reach,
    west: min[0] <= Math.min(...xs) + reach,
    east: max[0] >= Math.max(...xs) - reach,
  }
  const sides = (Object.keys(touches) as (keyof typeof touches)[]).filter((side) => touches[side])
  const ns = sides.filter((side) => side === 'north' || side === 'south')
  const ew = sides.filter((side) => side === 'west' || side === 'east')
  const where =
    sides.length === 0
      ? 'inside the floor'
      : sides.length === 1
        ? `along the ${sides[0]} edge`
        : sides.length > 2
          ? 'over most of the floor'
          : ns.length === 1
            ? `in the ${ns[0]}-${ew[0]} corner`
            : `across the floor from ${sides[0]} to ${sides[1]}`
  return `${where} (${figure(max[0] - min[0])} × ${figure(max[1] - min[1])} m, x ${figure(min[0])} to ${figure(max[0])}, z ${figure(min[1])} to ${figure(max[1])})`
}

/**
 * The `finish_gaps` warning for a floor or face script whose build leaves part of its host bare:
 * its `coverage` under FINISH_COVERED with at least one bare patch, each named by where it lies.
 * Joints make no patch, so a tiled finish is never warned for its joints alone. Null otherwise.
 */
export function authorSceneFinishGaps(
  id: string,
  manifest: GeometryArtifactManifest,
  host: AuthorSceneFinishHost,
): AuthorSceneDefect | null {
  const { coverage, uncovered } = manifest
  if (coverage === undefined || coverage >= FINISH_COVERED || !uncovered?.length) return null
  const share = `${Math.round(coverage * 100)}%`
  const message =
    'room' in host
      ? `The floor finish of "${host.room}" covers ${share} of its floor: uncovered ${uncovered.map((patch) => floorPatch(patch, host.polygon)).join('; ')}.`
      : `The finish on the ${host.face === 'a' ? 'left' : 'right'} face of wall ${host.wall} covers ${share} of the face: uncovered ${uncovered
          .map(
            ({ min, max }) =>
              `${figure(min[0])} to ${figure(max[0])} m along the wall from its start, ${figure(min[1])} to ${figure(max[1])} m up (${figure(max[0] - min[0])} × ${figure(max[1] - min[1])} m)`,
          )
          .join('; ')}.`
  return { id, code: 'finish_gaps', message }
}

/**
 * The wall faces whose finish is a module, once the write made the walls and the rooms: the host
 * reads each face (`wallFaceScriptInputs`), compiles the module for it and writes it with
 * `setWallFaceScript`, which core cannot do without a three.js runtime. The faces that cannot take
 * one are already `no_face` defects in the operation's report.
 */
export function authorSceneFaceScripts(
  payload: AuthorScenePayload,
  report: Pick<AuthorSceneReport, 'ids'>,
  nodes: SceneNodes,
): AuthorSceneFaceScript[] {
  return resolveFaceScripts(payload, report.ids, nodes).scripts
}

export function authorScene(
  scene: SceneNodes,
  input: AuthorSceneInput,
  context: AgentContext,
): AgentOperationOutcome & {
  result: AuthorSceneReport
  candidate: AuthorSceneState
  buildingId: string
} {
  const { payload } = input
  const sourceKeys = new Set<string>()
  const claimSourceKey = (key: string) => {
    if (sourceKeys.has(key))
      refuse(
        'duplicate_source_id',
        `Source id "${key}" is repeated. Give every wall and item a unique id across all levels; opening and generated-part keys must also remain distinct.`,
        { id: key, mutationApplied: false },
      )
    sourceKeys.add(key)
  }
  payload.levels.forEach((level, index) => {
    claimSourceKey(`level/${index}`)
    for (const [kind, parts] of [
      ['room', level.rooms],
      ['slab', level.slabs],
      ['column', level.columns],
      ['light', level.lights],
    ] as const)
      parts?.forEach((_, i) => {
        claimSourceKey(`${kind}/${index}/${i}`)
      })
    for (const wall of level.walls ?? []) {
      claimSourceKey(wall.id)
      wall.openings?.forEach((_, i) => {
        claimSourceKey(`${wall.id}/${i}`)
      })
    }
    for (const item of level.items ?? []) claimSourceKey(item.id)
  })
  const buildings = Object.values(scene).filter((n) => n.type === 'building')
  const selected =
    input.buildingId ?? (context.activeLevelId ? scene[context.activeLevelId]?.parentId : undefined)
  const building = selected
    ? buildings.find((node) => node.id === selected)
    : buildings.length === 1
      ? buildings[0]
      : undefined
  if (!building) refuse('no_building', 'The scene has no building to put the levels in.')
  const existingLevels = Object.values(scene).filter(
    (n) => n.type === 'level' && n.parentId === building.id,
  )
  const saved = building.metadata?.authorSceneState as AuthorSceneState | undefined
  const previous =
    saved?.version === 1 &&
    saved.buildingId === building.id &&
    saved.nodes &&
    saved.ids &&
    typeof saved.seed === 'string'
      ? saved
      : undefined
  const converted = Boolean(previous) || existingLevels.some((l) => l.metadata?.authorScene)
  if (converted && !input.replace)
    refuse(
      'conversion_exists',
      'This scene already holds a conversion. Pass replace: true to write over it.',
    )

  if (
    !previous &&
    (converted ||
      existingLevels.some((level) =>
        Object.values(scene).some((node) => node.parentId === level.id),
      ))
  )
    refuse(
      'existing_design',
      'This building already contains work without a retained conversion baseline. Use its native edit tools or convert into a separate building; existing geometry will not be replaced.',
      { mutationApplied: false },
    )
  const seed = previous?.seed ?? `${building.id}:${payloadSeed(payload)}`
  const mint = idFactory(seed, previous?.ids)
  const report: AuthorSceneReport = {
    levels: 0,
    walls: 0,
    doors: 0,
    windows: 0,
    rooms: 0,
    roomsNamed: 0,
    slabs: 0,
    columns: 0,
    items: 0,
    lights: 0,
    floorScripts: 0,
    faceScripts: 0,
    snapped: [],
    defaults: [],
    warnings: [],
    defects: [],
    notes: [...payload.notes],
    ids: {},
  }
  const defect = (id: string, code: string, message: string) =>
    report.defects.push({ id, code, message })
  const warn = (id: string, code: string, message: string) =>
    report.warnings.push({ id, code, message })
  const say = (sentence: string) => report.defaults.push(sentence)
  const finishes = finishPool(context, say)
  const finishRef = (
    value: string | undefined,
    id: string,
    surface?: Surface,
  ): string | undefined => {
    if (!value) return undefined
    const got = finishes.ref(value, surface)
    if ('error' in got) {
      defect(id, 'invalid_color', got.error)
      return undefined
    }
    return got.ref
  }
  const exactSlots = (compiled: CompiledGeometryScript, id: string) => {
    const slots = matchScriptSlotsToLibrary(compiled.manifest)
    for (const slot of compiled.manifest.slots) {
      // Glass keeps the glass add_object writes, drawn see-through and letting light pass. A
      // scene material carries no emission, so an emissive slot keeps the module's own material
      // (the library match leaves it alone) and a bulb stays lit.
      if (!slot.color || slot.emissive || slots[slot.id] === GLASS) continue
      const ref = finishRef(slot.color, id, {
        roughness: slot.roughness ?? MATTE.roughness,
        metalness: slot.metalness ?? MATTE.metalness,
      })
      if (ref) slots[slot.id] = ref
    }
    return slots
  }
  const paintContext = (levelId: string): AgentContext => ({
    ...context,
    activeLevelId: levelId,
    ...(finishes.materials ? { materials: finishes.materials } : {}),
  })

  // A separate candidate contains only its building and ancestors, never another building's work.
  const draft: Record<string, AnyNode> = {}
  let ancestor: AnyNode | undefined = building
  while (ancestor && !draft[ancestor.id]) {
    draft[ancestor.id] = { ...ancestor, children: [] } as AnyNode
    ancestor = ancestor.parentId ? scene[ancestor.parentId] : undefined
  }

  const scaffoldIds = new Set(Object.keys(draft))
  const levelNodes: ReturnType<typeof LevelNode.parse>[] = []
  const itemNodeIds = new Map<string, string>()
  const itemFrames = new Map<string, Frame>()
  const skirtings: {
    id: string
    nodeId: string
    levelId: string
    skirting: NonNullable<AuthorSceneWall['skirting']>
  }[] = []
  let untypedWindows = 0

  payload.levels.forEach((level, index) => {
    const levelNode = LevelNode.parse({
      object: 'node',
      type: 'level',
      id: mint('level', `level/${index}`),
      parentId: building!.id,
      visible: true,
      metadata: { authorScene: { elevation: level.elevation } },
      name: level.name,
      level: index,
      children: [],
    })
    draft[levelNode.id] = levelNode
    report.ids[`level/${index}`] = levelNode.id
    levelNodes.push(levelNode)
    const place = (node: AnyNode) => {
      draft[node.id] = node
      levelNode.children.push(node.id as never)
    }

    // ---------- walls, joined ----------
    const walls = (level.walls ?? []).map((w) => ({
      spec: w,
      start: [...w.start] as [number, number],
      end: [...w.end] as [number, number],
    }))
    for (const w of walls) {
      for (const end of ['start', 'end'] as const) {
        const pt = w[end]
        let best: { point: [number, number]; distance: number } | null = null
        for (const o of walls) {
          if (o === w) continue
          const near = nearestOnSegment(pt, o.start, o.end)
          if (near.distance < JOIN_REACH && (!best || near.distance < best.distance)) best = near
        }
        if (best && best.distance > 0.001) {
          report.snapped.push({
            id: w.spec.id,
            end,
            movedM: Math.round(best.distance * 1000) / 1000,
          })
          w[end] = best.point
        }
      }
    }
    const wallNodes = new Map<string, (typeof walls)[number] & { node: WallNode }>()
    for (const w of walls) {
      if (dist(w.start, w.end) < 0.05) {
        defect(w.spec.id, 'wall_too_short', 'The wall is shorter than 5 cm after joining.')
        continue
      }
      const node = WallNode.parse({
        object: 'node',
        type: 'wall',
        id: mint('wall', w.spec.id),
        parentId: levelNode.id,
        visible: true,
        metadata: { authorScene: { id: w.spec.id } },
        children: [],
        start: w.start,
        end: w.end,
        height: w.spec.height,
        thickness: w.spec.thickness,
      })
      place(node)
      wallNodes.set(w.spec.id, { ...w, node })
      if (w.spec.skirting)
        skirtings.push({
          id: w.spec.id,
          nodeId: node.id,
          levelId: levelNode.id,
          skirting: w.spec.skirting,
        })
      report.ids[w.spec.id] = node.id
      report.walls++
      // ---------- its openings ----------
      const length = dist(w.start, w.end)
      ;(w.spec.openings ?? []).forEach((o, i) => {
        const id = `${w.spec.id}/${i}`
        // A module supplies geometry; the declared type still describes how the opening works.
        let compiled: CompiledGeometryScript | undefined
        if (o.code) {
          compiled = input.compiled[id]
          if (!compiled) {
            defect(id, 'compile_failed', input.compileErrors?.[id] ?? 'The module did not compile.')
            return
          }
          if (compiled.mount !== 'wall') {
            defect(
              id,
              'wrong_mount',
              `A ${o.kind}'s module uses mount 'wall', not '${compiled.mount}'.`,
            )
            return
          }
          try {
            requireMeasured(compiled, { label: o.name ?? id, tool: 'author_scene' })
          } catch (error) {
            const e = error as { code?: string; message?: string }
            defect(id, e.code ?? 'unmeasurable_object', e.message ?? String(error))
            return
          }
          if (o.style) say(`${o.kind} ${id}: style ignored, its module builds it`)
        }
        const [width, height] = compiled ? scriptedSize(compiled.manifest) : [o.width, o.height]
        if (width > length + 0.01) {
          defect(
            id,
            'opening_wider_than_wall',
            `${o.kind} ${width.toFixed(2)} m wide on a ${length.toFixed(2)} m wall.`,
          )
          return
        }
        const x = Math.min(Math.max(o.along, width / 2), length - width / 2)
        if (Math.abs(x - o.along) > 0.01)
          say(
            `${o.kind} ${id}: moved ${Math.abs(x - o.along).toFixed(2)} m along the wall to fit inside it`,
          )
        const common = {
          object: 'node',
          id: mint(o.kind, id),
          parentId: node.id,
          visible: true,
          metadata: { authorScene: { id, color: o.color ?? null } },
          wallId: node.id,
          width,
          height,
          rotation: [0, 0, 0],
          ...(o.name ? { name: o.name } : {}),
          ...(compiled
            ? {
                source: scriptSource(compiled, { category: o.kind }),
                slots: exactSlots(compiled, id),
              }
            : {}),
        }
        let opening: AnyNode
        if (o.kind === 'door') {
          const type = o.type
          if (type && !isDoorType(type))
            defect(id, 'type_mismatch', `${type} is a window type; the door is written hinged.`)
          const style = o.style && !compiled ? o.style : undefined
          if (style && !isDoorStyle(style))
            defect(
              id,
              'style_mismatch',
              `${style} is a window style; the door keeps its panel leaf.`,
            )
          const hingesSide = o.hinge === 'end' ? 'right' : 'left'
          const handleSide = hingesSide === 'right' ? 'left' : 'right'
          if (o.hinge) say(`door ${id}: handle set opposite the hinge (${handleSide})`)
          opening = DoorNode.parse({
            ...common,
            type: 'door',
            position: [x, height / 2, 0],
            ...(type && isDoorType(type) ? doorTypeFields(type) : {}),
            ...(style && isDoorStyle(style) ? doorStyleLook(style) : {}),
            ...(o.leaves ? { leafCount: o.leaves } : {}),
            hingesSide,
            handleSide,
            ...(o.swing ? { swingDirection: o.swing === 'back' ? 'outward' : 'inward' } : {}),
          })
          report.doors++
        } else {
          const type = o.type
          if (type && !isWindowType(type))
            defect(id, 'type_mismatch', `${type} is a door type; the window is written fixed.`)
          const windowType = type && isWindowType(type) ? type : undefined
          if (!windowType && !compiled) untypedWindows++
          const style = o.style && !compiled ? o.style : undefined
          if (style && !isWindowStyle(style))
            defect(
              id,
              'style_mismatch',
              `${style} is a door style; the window keeps a single pane.`,
            )
          const takesStyle = windowTakesStyle(windowType ?? 'fixed')
          if (style && isWindowStyle(style) && !takesStyle)
            say(`window ${id}: style ${style} dropped, a ${windowType} window draws its own sashes`)
          opening = WindowNode.parse({
            ...common,
            type: 'window',
            position: [x, o.sill + height / 2, 0],
            ...(windowType ? windowTypeFields(windowType) : {}),
            ...(style && isWindowStyle(style) && takesStyle ? getWindowStyleOverrides(style) : {}),
          })
          report.windows++
        }
        const panel = o.kind === 'door' ? finishRef(o.color, id) : undefined
        const frame = finishRef(o.frameColor ?? o.color, id)
        if (panel || frame)
          opening = {
            ...opening,
            slots: {
              ...('slots' in opening ? opening.slots : {}),
              ...(panel ? { panel } : {}),
              ...(frame ? { frame } : {}),
            },
          } as AnyNode
        draft[opening.id] = opening
        report.ids[id] = opening.id
        node.children.push(opening.id as never)
      })
    }

    // ---------- slabs and columns ----------
    const slabs = level.slabs ?? []
    if (slabs.length > MANY_SLABS)
      warn(
        `level/${index}`,
        'many_slabs',
        `${slabs.length} slabs on "${level.name}": Pascal builds floor plates, caps and ceilings itself; a slab is a terrace, a platform, a balcony.`,
      )
    slabs.forEach((s, i) => {
      const id = `slab/${index}/${i}`
      const label = s.name ? `"${s.name}"` : `slab ${i}`
      const polygon = s.polygon as Vec2[]
      // A slab over a wall's footprint, higher than half the wall: a cap, which would lift the
      // wall onto it. Pascal caps its walls itself.
      const lifted = [...wallNodes.values()].find(
        (w) =>
          s.top > w.spec.height / 2 &&
          polygonsOverlap(polygon, wallFootprint({ ...w, thickness: w.spec.thickness })),
      )
      if (lifted) {
        defect(
          id,
          'slab_over_wall',
          `${label} overlaps wall ${lifted.spec.id} with its top at ${metres(s.top)}, above half the wall's ${metres(lifted.spec.height)}: it would lift the wall onto it. Pascal builds a wall's cap itself; fold it into the wall.`,
        )
        return
      }
      if (s.thickness < THIN_SLAB)
        warn(
          id,
          'thin_slab',
          `${label} is ${(s.thickness * 1000).toFixed(0)} mm thick: a slab is a terrace, a platform, a balcony; a finish goes on the room's floor.`,
        )
      const finish = finishRef(s.finish, id)
      const node = SlabNode.parse({
        object: 'node',
        type: 'slab',
        id: mint('slab', id),
        parentId: levelNode.id,
        visible: true,
        metadata: { authorScene: { finish: s.finish ?? null } },
        ...(s.name ? { name: s.name } : {}),
        polygon: s.polygon,
        elevation: s.top,
        thickness: s.thickness,
        ...(finish ? { slots: { surface: finish } } : {}),
        ...(s.railing?.length
          ? { railing: s.railing.map((r) => ({ start: r.start, end: r.end })) }
          : {}),
      })
      place(node)
      report.ids[id] = node.id
      report.slabs++
    })
    ;(level.columns ?? []).forEach((c, i) => {
      const node = ColumnNode.parse({
        object: 'node',
        type: 'column',
        id: mint('column', `column/${index}/${i}`),
        parentId: levelNode.id,
        visible: true,
        metadata: { authorScene: { color: c.color ?? null } },
        ...(c.name ? { name: c.name } : {}),
        position: [c.position[0], 0, c.position[1]],
        crossSection: 'square',
        width: c.width,
        depth: c.depth,
        height: c.height,
        baseHeight: 0,
        capitalHeight: 0,
      })
      place(node)
      report.ids[`column/${index}/${i}`] = node.id
      report.columns++
    })

    // ---------- items, hosts first ----------
    const pending = [...(level.items ?? [])]
    let progress = true
    while (pending.length && progress) {
      progress = false
      for (const item of [...pending]) {
        const hostItemId = item.host ? itemNodeIds.get(item.host) : undefined
        const hostWall = item.host && !hostItemId ? wallNodes.get(item.host) : undefined
        if (item.host && !hostItemId && !hostWall) continue
        pending.splice(pending.indexOf(item), 1)
        progress = true
        const compiled = input.compiled[item.id]
        if (!compiled) {
          defect(
            item.id,
            'compile_failed',
            input.compileErrors?.[item.id] ?? 'The module did not compile.',
          )
          continue
        }
        const world: Vec3 = [item.position[0]!, item.position[1]!, item.position[2]!]
        const yaw = (item.rotation * Math.PI) / 180
        let placed: {
          compiled: CompiledGeometryScript
          parentId: string
          position: Vec3
          rotation: number
          side?: 'front' | 'back'
          wallT?: number
          frame: Frame
        }
        if (hostWall) {
          // On the wall as place_items puts a wall-side item there: along it from its start, the
          // payload's height for its bottom, on the face nearest the point, facing the room.
          const [width, height] = scriptedSize(compiled.manifest)
          const wallHeight = hostWall.spec.height
          if (height > wallHeight) {
            defect(
              item.id,
              'item_too_tall',
              `"${item.name}" is ${metres(height)} tall; wall ${item.host} is ${metres(wallHeight)}.`,
            )
            continue
          }
          const length = dist(hostWall.start, hostWall.end)
          const along = projectWorldPointToWallLocalX(hostWall, world)
          const x = Math.max(width / 2, Math.min(length - width / 2, along))
          const y = Math.max(0, Math.min(wallHeight - height, world[1]))
          const [dx, dz] = [
            hostWall.end[0] - hostWall.start[0],
            hostWall.end[1] - hostWall.start[1],
          ]
          // The wall's left (its local +z) is its front.
          const localZ =
            (-dz * (world[0] - hostWall.start[0]) + dx * (world[2] - hostWall.start[1])) / length
          const left = localZ >= 0
          const faceZ = getWallLocalFaceZ(hostWall.node, left ? 'a' : 'b')
          const offset = (localZ - faceZ) * (left ? 1 : -1)
          const z = faceZ + (left ? 1 : -1) * Math.max(0, offset)
          if (offset < -1e-9)
            say(`${item.id}: point inside wall ${item.host}, moved to its nearest face`)
          if (item.rotation)
            say(`${item.id}: rotation ignored on wall ${item.host}, it faces the room`)
          const [ux, uz] = [dx / length, dz / length]
          placed = {
            compiled: { ...compiled, mount: 'wall-side' },
            parentId: hostWall.node.id,
            position: [x, y, z],
            rotation: left ? 0 : 180,
            side: left ? 'front' : 'back',
            wallT: x / length,
            frame: {
              position: [
                hostWall.start[0] + ux * x - uz * z,
                y,
                hostWall.start[1] + uz * x + ux * z,
              ],
              yaw: -Math.atan2(dz, dx) + (left ? 0 : Math.PI),
            },
          }
        } else {
          const host = hostItemId ? itemFrames.get(item.host!) : undefined
          placed = {
            compiled,
            parentId: hostItemId ?? levelNode.id,
            position: host ? toLocal(host, world) : world,
            rotation: host ? item.rotation - (host.yaw * 180) / Math.PI : item.rotation,
            frame: { position: world, yaw },
          }
        }
        try {
          const outcome = addObject(
            draft,
            {
              compiled: { ...placed.compiled, nodeId: mint('item', item.id) },
              name: item.name,
              category: item.category,
              reason: `author_scene: ${item.name}`,
              position: placed.position,
              rotation: placed.rotation,
              parentId: placed.parentId,
              ...(placed.side ? { side: placed.side } : {}),
            },
            { ...context, activeLevelId: levelNode.id },
          )
          for (const { node, parentId } of outcome.changes?.create ?? []) {
            draft[node.id] = {
              ...node,
              slots: exactSlots(compiled, item.id),
              ...(placed.wallT === undefined ? {} : { wallT: placed.wallT }),
            } as AnyNode
            const parent = draft[parentId ?? levelNode.id] as AnyNode & { children?: string[] }
            parent.children = [...(parent.children ?? []), node.id]
            itemNodeIds.set(item.id, node.id)
            itemFrames.set(item.id, placed.frame)
            report.ids[item.id] = node.id
            report.items++
          }
        } catch (error) {
          const e = error as { code?: string; message?: string }
          defect(item.id, e.code ?? 'item_refused', e.message ?? String(error))
        }
      }
    }
    for (const item of pending)
      defect(item.id, 'host_missing', `Its host ${item.host} was not placed.`)

    // ---------- wall paint, through the editor's paint: both faces, or each its own ----------
    for (const w of walls) {
      const node = wallNodes.get(w.spec.id)?.node
      if (!node) continue
      const faces = {
        a: w.spec.colorLeft ?? w.spec.color,
        b: w.spec.colorRight ?? w.spec.color,
      }
      const coats: { role?: 'a' | 'b'; material: string }[] = []
      if (faces.a && faces.a === faces.b) {
        const ref = finishRef(faces.a, w.spec.id)
        if (ref) coats.push({ material: ref })
      } else
        for (const face of ['a', 'b'] as const) {
          const ref = finishRef(faces[face], w.spec.id)
          if (ref) coats.push({ role: face, material: ref })
        }
      for (const coat of coats) {
        try {
          const { changes } = paint(
            draft,
            { targets: [node.id], ...coat },
            paintContext(levelNode.id),
          )
          for (const u of changes?.update ?? [])
            draft[u.id] = { ...draft[u.id], ...u.data } as AnyNode
        } catch (error) {
          defect(w.spec.id, 'paint_refused', (error as Error).message)
        }
      }
    }
  })
  report.levels = levelNodes.length
  if (untypedWindows)
    say(
      `${untypedWindows} window${untypedWindows === 1 ? ' has' : 's have'} no type: written fixed (cannot open); give type`,
    )

  // ---------- which face of each wall looks into a room: read from the plan, as the editor does ----------
  for (const levelNode of levelNodes) {
    const boundaries = Object.values(draft).filter(
      (n): n is BoundaryNode =>
        n.parentId === levelNode.id && (n.type === 'wall' || n.type === 'separator'),
    )
    for (const { wallId, ...sides } of detectSpacesForLevel(levelNode.id, boundaries).wallUpdates)
      draft[wallId] = { ...draft[wallId], ...sides } as AnyNode
  }

  // ---------- rooms: Pascal's own derivation, then the payload's names and floors ----------
  const { nodes: withZones, createdZoneIds } = migrateRoomZones(draft)
  const zones = createdZoneIds.map((id) => ZoneNode.parse(withZones[id]))
  for (const zone of zones) {
    draft[zone.id] = zone
    const level = draft[zone.parentId!] as AnyNode & { children: string[] }
    draft[zone.parentId!] = { ...level, children: [...level.children, zone.id] } as AnyNode
    report.rooms++
  }
  const claimed = new Map<string, string>()
  payload.levels.forEach((level, index) => {
    const levelNode = levelNodes[index]!
    for (const [i, room] of level.rooms.entries()) {
      const id = `room/${index}/${i}`
      const zone = zones.find(
        (z) => z.parentId === levelNode.id && pointInPolygon(room.seed as Vec2, z.polygon),
      )
      // Two seeds in one enclosure: the walls do not separate the rooms the payload names.
      if (zone && claimed.has(zone.id)) {
        defect(
          id,
          'room_shares_enclosure',
          `"${room.name}" and "${claimed.get(zone.id)}" are one enclosure: no wall separates them.`,
        )
        continue
      }
      if (!zone) {
        defect(
          id,
          'room_not_enclosed',
          `No closed room around (${room.seed[0]}, ${room.seed[1]}) "${room.name}": its walls do not meet.`,
        )
        continue
      }
      if (room.floorRegions.length > MANY_REGIONS)
        warn(
          id,
          'many_regions',
          `"${room.name}" has ${room.floorRegions.length} floor regions: regions are fixed polygons that do not follow a resize; use one floor finish.`,
        )
      const finish = finishRef(room.floor, id)
      const regions = room.floorRegions.map((r, k) => ({
        id: `region_${k}`,
        polygon: r.polygon,
        finish: finishRef(r.finish, id) ?? r.finish,
      }))
      draft[zone.id] = ZoneNode.parse({
        ...zone,
        name: room.name,
        spaceRole: 'room',
        ...(finish || regions.length
          ? {
              floor: {
                ...zone.floor,
                ...(finish ? { finish } : {}),
                ...(regions.length ? { regions } : {}),
              },
            }
          : {}),
        metadata: { ...zone.metadata, authorScene: { seed: room.seed } },
      })
      claimed.set(zone.id, room.name)
      report.ids[id] = zone.id
      report.roomsNamed++
    }
  })

  // ---------- floors and ceilings, as the editor derives them on load ----------
  const structure = reconcileSceneStructure({
    nodes: draft,
    levelIds: levelNodes.map((l) => l.id as `level_${string}`),
    mintId: (kind) => mint(kind),
  })

  const written = { ...structure.nodes }

  // ---------- skirting, native on each wall, along the faces its rooms stand on ----------
  for (const { id, nodeId, levelId, skirting } of skirtings) {
    const finish = finishRef(skirting.color, id)
    try {
      const { changes } = setWallSkirting(
        written,
        {
          wallIds: [nodeId],
          height: skirting.height,
          depth: skirting.depth,
          ...(finish ? { finish } : {}),
        },
        paintContext(levelId),
      )
      for (const u of changes?.update ?? [])
        written[u.id] = { ...written[u.id], ...u.data } as AnyNode
    } catch (error) {
      const e = error as { code?: string; message?: string }
      defect(
        id,
        'skirting_refused',
        e.code === 'side_unknown'
          ? `No room stands on either face of wall ${id}: its skirting was not written.`
          : `Wall ${id}: ${e.message ?? String(error)}`,
      )
    }
  }

  // ---------- face modules: which faces they build on is known now; the host compiles them ----------
  const faces = resolveFaceScripts(payload, report.ids, written)
  report.defects.push(...faces.defects)
  report.warnings.push(...faces.warnings)

  // Ceilings exist only after structure reconciliation; lights can now use their room's host.
  payload.levels.forEach((level, index) => {
    const levelNode = levelNodes[index]!
    for (const [i, light] of level.lights.entries()) {
      const id = `light/${index}/${i}`
      const at: Vec3 = [light.position[0]!, light.position[1]!, light.position[2]!]
      let hostId = light.fixture ? itemNodeIds.get(light.fixture) : undefined
      let hostFrame = light.fixture ? itemFrames.get(light.fixture) : undefined
      const room = !light.fixture
        ? Object.values(written).find(
            (node): node is ZoneNode =>
              node.type === 'zone' &&
              node.spaceRole === 'room' &&
              node.parentId === levelNode.id &&
              pointInPolygon([at[0], at[2]], node.polygon) &&
              !node.holes.some((hole) => pointInPolygon([at[0], at[2]], hole)),
          )
        : undefined
      const ceiling = room
        ? Object.values(written).find(
            (node): node is CeilingNode =>
              node.type === 'ceiling' && node.zoneId === room.id && node.parentId === levelNode.id,
          )
        : undefined
      if (ceiling) {
        const compiled = input.compiled[id]
        if (!compiled) {
          defect(
            id,
            'compile_failed',
            input.compileErrors?.[id] ?? 'The ceiling point module did not compile.',
          )
          continue
        }
        try {
          const outcome = addObject(
            written,
            {
              compiled: { ...compiled, nodeId: mint('item', id) },
              name: `Ceiling point in ${room!.name}`,
              category: 'light',
              reason: 'author_scene: ceiling point for a light without a fixture',
              parentId: ceiling.id,
              position: [at[0], 0, at[2]],
              rotation: 0,
            },
            { ...context, activeLevelId: levelNode.id },
          )
          const node = outcome.changes!.create![0]!.node
          written[node.id] = { ...node, slots: exactSlots(compiled, id) } as AnyNode
          written[ceiling.id] = { ...ceiling, children: [...ceiling.children, node.id as never] }
          hostId = node.id
          hostFrame = {
            position: [at[0], resolveCeilingHeight(ceiling, written) - CEILING_DRAW_OFFSET, at[2]],
            yaw: 0,
          }
          report.ids[id] = node.id
          report.items++
          say(`light at [${at.join(', ')}] has no fixture: a ceiling point in ${room!.name}`)
        } catch (error) {
          const e = error as { code?: string; message?: string }
          defect(id, e.code ?? 'item_refused', e.message ?? String(error))
          continue
        }
      }
      if (!hostId) {
        let best: { key: string; d: number } | null = null
        for (const item of level.items ?? []) {
          const frame = itemFrames.get(item.id)
          if (!frame) continue
          const d = Math.hypot(frame.position[0] - at[0], frame.position[2] - at[2])
          if (!best || d < best.d) best = { key: item.id, d }
        }
        if (!best) {
          defect(
            id,
            'light_unhosted',
            'No item on this level to hold the light; Pascal keeps lights inside objects.',
          )
          continue
        }
        hostId = itemNodeIds.get(best.key)!
        hostFrame = itemFrames.get(best.key)!
        say(
          `light at [${at.join(', ')}] has no fixture: ${!light.fixture ? 'no room contains its point; ' : ''}hosted on the nearest item ${best.key} (${best.d.toFixed(2)} m away); moving that item moves the light`,
        )
      }
      const hostNode = written[hostId] as AnyNode & {
        asset: { interactive?: { controls: unknown[]; effects: unknown[] } }
      }
      const interactive = hostNode.asset.interactive ?? { controls: [], effects: [] }
      const controls = interactive.controls.some((c) => (c as { kind?: string }).kind === 'toggle')
        ? interactive.controls
        : [...interactive.controls, { kind: 'toggle', label: 'Lights', default: true }]
      const effects = [
        ...interactive.effects,
        {
          kind: 'light',
          color: light.color,
          intensityRange: [0, light.intensity],
          offset: toLocal(hostFrame!, at),
        },
      ]
      written[hostNode.id] = {
        ...hostNode,
        asset: { ...hostNode.asset, interactive: { controls, effects } },
      } as unknown as AnyNode
      report.lights++
    }
  })

  const nodes = Object.fromEntries(Object.entries(written).filter(([id]) => !scaffoldIds.has(id)))
  const candidate: AuthorSceneState = {
    version: 1,
    buildingId: building.id,
    seed,
    ids: report.ids,
    nodes,
  }
  const outcome = {
    result: report,
    candidate,
    buildingId: building.id,
    changes: finishes.created.length ? { materials: finishes.created } : {},
  }
  return input.prepareOnly ? outcome : finalizeAuthorScene(scene, outcome)
}

/** Commit the complete candidate after the host has compiled all of its finishes. */
export function finalizeAuthorScene(
  scene: SceneNodes,
  outcome: AgentOperationOutcome & {
    result: AuthorSceneReport
    candidate: AuthorSceneState
    buildingId: string
  },
) {
  const building = scene[outcome.buildingId]
  if (building?.type !== 'building') refuse('no_building', 'The target building no longer exists.')
  const previous = building.metadata?.authorSceneState as AuthorSceneState | undefined
  const base =
    previous?.nodes ??
    Object.fromEntries(
      Object.values(scene)
        .filter((node) => node.type === 'level' && node.parentId === building.id)
        .map((node) => [node.id, node]),
    )
  const changes = authoredSceneChanges(scene, base, outcome.candidate.nodes)
  return {
    ...outcome,
    changes: {
      ...changes,
      ...(outcome.changes?.materials ? { materials: outcome.changes.materials } : {}),
      update: [
        ...(changes.update ?? []),
        {
          id: building.id,
          data: { metadata: { ...building.metadata, authorSceneState: outcome.candidate } },
        },
      ],
    },
  }
}
