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
import {
  matchScriptSlotsToLibrary,
  requireMeasured,
  scriptedSize,
  scriptSource,
} from '../lib/geometry-script-node'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import { nearestLibraryColorRef } from '../procedural-items/library-colors'
import {
  type AnyNode,
  ColumnNode,
  type CompiledGeometryScript,
  DoorNode,
  LevelNode,
  type SceneMaterial,
  type SceneMaterialId,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import { DoorType, WindowType } from '../schema/nodes/opening-types'
import { getWallLocalFaceZ } from '../systems/wall/wall-frame'
import { migrateRoomZones } from '../utils/room-zone-migration'
import { addObject } from './add-object'
import { paint } from './paint'
import { pointInPolygon, projectWorldPointToWallLocalX, type Vec2 } from './plan-geometry'
import { resolveInlinePaintMaterial } from './scene-materials'
import type { AgentContext, AgentOperationOutcome, NodeWrite, SceneNodes } from './types'

/**
 * `author_scene`: a whole design, read by its author from the three.js module it wrote, handed
 * over as a payload and written as native Pascal nodes in one step. Not in AGENT_OPERATIONS: the
 * host compiles every module first (the MCP on its server, the chat in its worker) and passes the
 * results as `compiled`, keyed by the payload's item ids and, for an opening with code, by
 * `<wallId>/<index>`; a module whose compile failed is absent there and comes back in the report
 * with the host's reason.
 *
 * The policy, decided with the owner: accept and report. Everything valid is written; every
 * defect comes back by the payload's own id with a reason; what Pascal fills in or drops is a
 * sentence in `defaults`; what it writes but doubts is a `warning`. The one correction Pascal
 * makes itself is its join rule (a wall end within reach of another wall's centerline snaps onto
 * it), reported per wall. Ids are derived from the payload, so the same payload writes the same
 * scene.
 */
export type AuthorSceneInput = {
  payload: AuthorScenePayload
  compiled: Record<string, CompiledGeometryScript>
  /** Why a module did not compile, by the payload's item id or `<wallId>/<index>`, for the report. */
  compileErrors?: Record<string, string>
  replace?: boolean
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
  /** The join rule applied: wall ends moved onto a centerline, with how far. */
  snapped: { id: string; end: 'start' | 'end'; movedM: number }[]
  /** What Pascal filled in or dropped, one sentence per fact. */
  defaults: string[]
  /** Written, but doubtful: by the payload's id, with a code. */
  warnings: AuthorSceneDefect[]
  defects: AuthorSceneDefect[]
  notes: string[]
  /** The payload's own ids (walls, `wall/i` openings, `room/level/i`, items) to the nodes written. */
  ids: Record<string, string>
}

const JOIN_REACH = 0.3
const THIN_SLAB = 0.02
const MANY_SLABS = 20
const MANY_REGIONS = 24
const HEX = /^#[0-9a-f]{6}$/i

type Vec3 = [number, number, number]

/**
 * Small, stable ids: the payload's own hash and a counter per kind, so a replay writes the same
 * scene. A revision salt keeps a replacement's ids apart from the conversion it replaces: the
 * same payload written over itself would otherwise create nodes that already exist and then
 * delete them with the old levels.
 */
function idFactory(payload: AuthorScenePayload, revision = 0) {
  let hash = 0x811c9dc5
  for (const ch of `${revision}:${JSON.stringify(payload)}`)
    hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
  const base = hash.toString(16).padStart(8, '0')
  const counts = new Map<string, number>()
  return (kind: string) => {
    const n = (counts.get(kind) ?? 0) + 1
    counts.set(kind, n)
    return `${kind}_as${base}${n.toString(36).padStart(4, '0')}`
  }
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

/**
 * The finish a payload value writes. A library or scene ref passes through; a hex colour is kept
 * as an exact native material, one scene material per distinct colour across the payload, named
 * by the colour. A host that keeps no scene materials gets the nearest library colour, said once.
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
    ref(value: string): { ref: string } | { error: string } {
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
            roughness: 0.9,
            metalness: 0,
            opacity: 1,
            transparent: false,
            side: 'front',
          },
        },
        hex,
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

export function authorScene(
  scene: SceneNodes,
  input: AuthorSceneInput,
  context: AgentContext,
): AgentOperationOutcome & { result: AuthorSceneReport } {
  const { payload } = input
  const building = Object.values(scene).find((n) => n.type === 'building')
  if (!building) refuse('no_building', 'The scene has no building to put the levels in.')
  const existingLevels = Object.values(scene).filter((n) => n.type === 'level')
  const converted = existingLevels.some(
    (l) => (l.metadata as { authorScene?: unknown })?.authorScene,
  )
  if (converted && !input.replace)
    refuse(
      'conversion_exists',
      'This scene already holds a conversion. Pass replace: true to write over it.',
    )

  // The first revision whose ids are free in this scene.
  let revision = 0
  while (revision < 32 && scene[idFactory(payload, revision)('probe')]) revision++
  const mint = idFactory(payload, revision)
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
  const finishRef = (value: string | undefined, id: string): string | undefined => {
    if (!value) return undefined
    const got = finishes.ref(value)
    if ('error' in got) {
      defect(id, 'invalid_color', got.error)
      return undefined
    }
    return got.ref
  }
  const paintContext = (levelId: string): AgentContext => ({
    ...context,
    activeLevelId: levelId,
    ...(finishes.materials ? { materials: finishes.materials } : {}),
  })

  // The draft: the scene without its levels, then everything the payload describes.
  const draft: Record<string, AnyNode> = {}
  for (const [id, node] of Object.entries(scene)) {
    if (node.type === 'level') continue
    const levelIds = new Set<string>(existingLevels.map((l) => l.id))
    if (node.parentId && levelIds.has(node.parentId)) continue
    draft[id] = node
  }
  const underLevel = new Set<string>()
  for (const node of Object.values(scene)) {
    let at = node.parentId
    while (at) {
      if (existingLevels.some((l) => l.id === at)) {
        underLevel.add(node.id)
        break
      }
      at = scene[at]?.parentId ?? null
    }
  }
  for (const id of underLevel) delete draft[id]
  const deleted = existingLevels.map((l) => l.id)

  const levelNodes: ReturnType<typeof LevelNode.parse>[] = []
  const itemNodeIds = new Map<string, string>()
  const itemFrames = new Map<string, Frame>()
  let untypedWindows = 0

  payload.levels.forEach((level, index) => {
    const levelNode = LevelNode.parse({
      object: 'node',
      type: 'level',
      id: mint('level'),
      parentId: building!.id,
      visible: true,
      metadata: { authorScene: { elevation: level.elevation } },
      name: level.name,
      level: index,
      children: [],
    })
    draft[levelNode.id] = levelNode
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
        id: mint('wall'),
        parentId: levelNode.id,
        visible: true,
        metadata: { authorScene: { id: w.spec.id } },
        children: [],
        start: w.start,
        end: w.end,
        height: w.spec.height,
        thickness: w.spec.thickness,
        frontSide: 'interior',
        backSide: 'exterior',
      })
      place(node)
      wallNodes.set(w.spec.id, { ...w, node })
      report.ids[w.spec.id] = node.id
      report.walls++
      // ---------- its openings ----------
      const length = dist(w.start, w.end)
      ;(w.spec.openings ?? []).forEach((o, i) => {
        const id = `${w.spec.id}/${i}`
        // A module builds the opening: its bounds are its size, its type and style do not apply.
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
          if (o.type || o.style)
            say(`${o.kind} ${id}: type and style ignored, its module builds it`)
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
          id: mint(o.kind),
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
                slots: matchScriptSlotsToLibrary(compiled.manifest),
              }
            : {}),
        }
        let opening: AnyNode
        if (o.kind === 'door') {
          const type = o.type && !compiled ? o.type : undefined
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
          const type = o.type && !compiled ? o.type : undefined
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
        id: mint('slab'),
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
        id: mint('column'),
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
          const left =
            -dz * (world[0] - hostWall.start[0]) + dx * (world[2] - hostWall.start[1]) >= 0
          const z = getWallLocalFaceZ(hostWall.node, left ? 'a' : 'b')
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
              compiled: { ...placed.compiled, nodeId: mint('item') },
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
            draft[node.id] =
              placed.wallT === undefined ? node : ({ ...node, wallT: placed.wallT } as AnyNode)
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

    // ---------- lights: on their fixture, else on the nearest item ----------
    for (const [i, light] of level.lights.entries()) {
      const id = `light/${index}/${i}`
      const at: Vec3 = [light.position[0]!, light.position[1]!, light.position[2]!]
      let hostKey = light.fixture && itemNodeIds.has(light.fixture) ? light.fixture : undefined
      if (!hostKey) {
        let best: { key: string; d: number } | null = null
        for (const [key, frame] of itemFrames) {
          const d = Math.hypot(frame.position[0] - at[0], frame.position[2] - at[2])
          if (!best || d < best.d) best = { key, d }
        }
        if (!best) {
          defect(
            id,
            'light_unhosted',
            'No item on this level to hold the light; Pascal keeps lights inside objects.',
          )
          continue
        }
        hostKey = best.key
        say(
          `light at [${at.join(', ')}] has no fixture: hosted on the nearest item ${hostKey} (${best.d.toFixed(2)} m away); moving that item moves the light`,
        )
      }
      const hostNode = draft[itemNodeIds.get(hostKey)!] as AnyNode & {
        asset: { interactive?: { controls: unknown[]; effects: unknown[] } }
      }
      // Where add_object keeps an object's lights: the asset's interactive block, with a toggle.
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
          offset: toLocal(itemFrames.get(hostKey)!, at),
        },
      ]
      draft[hostNode.id] = Object.assign({}, hostNode, {
        asset: { ...hostNode.asset, interactive: { controls, effects } },
      }) as unknown as AnyNode
      report.lights++
    }

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

  const create: NodeWrite[] = Object.values(structure.nodes)
    .filter((node) => !scene[node.id])
    .map((node) => ({ op: 'create', node, parentId: node.parentId ?? undefined }))
  return {
    result: report,
    changes: {
      ...(finishes.created.length ? { materials: finishes.created } : {}),
      delete: deleted,
      create: create.map((c) => ({
        node: (c as { node: AnyNode }).node,
        parentId: (c as { parentId?: string }).parentId,
      })),
    },
  }
}
