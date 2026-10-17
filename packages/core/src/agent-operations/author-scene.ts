import type { AuthorScenePayload } from '../agent-tools/author-scene'
import { refuse } from '../agent-tools/refusal'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import { nearestLibraryColorRef } from '../procedural-items/library-colors'
import {
  type AnyNode,
  ColumnNode,
  type CompiledGeometryScript,
  DoorNode,
  LevelNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import { migrateRoomZones } from '../utils/room-zone-migration'
import { addObject } from './add-object'
import { paint } from './paint'
import type { AgentContext, AgentOperationOutcome, NodeWrite, SceneNodes } from './types'

/**
 * `author_scene`: a whole design, read by its author from the three.js module it wrote, handed
 * over as a payload and written as native Pascal nodes in one step. Not in AGENT_OPERATIONS: the
 * host compiles every item's module first (the MCP on its server, the chat in its worker) and
 * passes the results as `compiled`, keyed by the payload's item ids; an item whose compile failed
 * is absent there and comes back in the report with the host's reason.
 *
 * The policy, decided with the owner: accept and report. Everything valid is written; every
 * defect comes back by the payload's own id with a reason; the one correction Pascal makes
 * itself is its join rule (a wall end within reach of another wall's centerline snaps onto it),
 * reported per wall. Ids are derived from the payload, so the same payload writes the same scene.
 */
export type AuthorSceneInput = {
  payload: AuthorScenePayload
  compiled: Record<string, CompiledGeometryScript>
  /** Why an item's module did not compile, by the payload's item id, for the report. */
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
  defects: AuthorSceneDefect[]
  notes: string[]
  /** The payload's own ids (walls, `wall/i` openings, `room/level/i`, items) to the nodes written. */
  ids: Record<string, string>
}

const JOIN_REACH = 0.3

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

/** The point on segment ab nearest to p, and how far p is from it. */
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

function finishRef(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('library:') || value.startsWith('scene:')) return value
  return nearestLibraryColorRef(value)?.ref
}

function pointInPolygon(point: readonly number[], polygon: readonly (readonly number[])[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = [polygon[i]![0]!, polygon[i]![1]!]
    const [xj, zj] = [polygon[j]![0]!, polygon[j]![1]!]
    if (
      zi > point[1]! !== zj > point[1]! &&
      point[0]! < ((xj - xi) * (point[1]! - zi)) / (zj - zi) + xi
    )
      inside = !inside
  }
  return inside
}

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
    defects: [],
    notes: [...payload.notes],
    ids: {},
  }
  const defect = (id: string, code: string, message: string) =>
    report.defects.push({ id, code, message })

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
  const itemPositions = new Map<string, [number, number, number]>()

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
    const wallNodes = new Map<string, ReturnType<typeof WallNode.parse>>()
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
      wallNodes.set(w.spec.id, node)
      report.ids[w.spec.id] = node.id
      report.walls++
      // ---------- its openings ----------
      const length = dist(w.start, w.end)
      ;(w.spec.openings ?? []).forEach((o, i) => {
        const id = `${w.spec.id}/${i}`
        if (o.width > length + 0.01) {
          defect(
            id,
            'opening_wider_than_wall',
            `${o.kind} ${o.width} m wide on a ${length.toFixed(2)} m wall.`,
          )
          return
        }
        const x = Math.min(Math.max(o.along, o.width / 2), length - o.width / 2)
        if (Math.abs(x - o.along) > 0.01)
          report.notes.push(
            `${id}: ${o.kind} moved ${Math.abs(x - o.along).toFixed(2)} m along the wall to fit inside it.`,
          )
        const common = {
          object: 'node',
          id: mint(o.kind),
          parentId: node.id,
          visible: true,
          metadata: { authorScene: { id, color: o.color ?? null } },
          wallId: node.id,
          width: o.width,
          height: o.height,
          rotation: [0, 0, 0],
          ...(o.name ? { name: o.name } : {}),
        }
        const opening =
          o.kind === 'door'
            ? DoorNode.parse({
                ...common,
                type: 'door',
                position: [x, o.height / 2, 0],
                ...(o.hinge ? { hingesSide: o.hinge === 'start' ? 'left' : 'right' } : {}),
                ...(o.swing ? { swingDirection: o.swing === 'back' ? 'outward' : 'inward' } : {}),
              })
            : WindowNode.parse({
                ...common,
                type: 'window',
                position: [x, o.sill + o.height / 2, 0],
              })
        draft[opening.id] = opening
        report.ids[id] = opening.id
        node.children.push(opening.id as never)
        if (o.kind === 'door') report.doors++
        else report.windows++
      })
    }

    // ---------- slabs and columns ----------
    for (const s of level.slabs ?? []) {
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
        ...(finishRef(s.finish) ? { slots: { surface: finishRef(s.finish) } } : {}),
        ...(s.railing?.length
          ? { railing: s.railing.map((r) => ({ start: r.start, end: r.end })) }
          : {}),
      })
      place(node)
      report.slabs++
    }
    for (const c of level.columns ?? []) {
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
      report.columns++
    }

    // ---------- items, hosts first ----------
    const pending = [...(level.items ?? [])]
    let progress = true
    while (pending.length && progress) {
      progress = false
      for (const item of [...pending]) {
        const hostId = item.host ? itemNodeIds.get(item.host) : undefined
        if (item.host && !hostId) continue
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
        const hostPosition = hostId ? itemPositions.get(item.host!) : undefined
        const position: [number, number, number] = hostPosition
          ? [
              item.position[0]! - hostPosition[0],
              item.position[1]! - hostPosition[1],
              item.position[2]! - hostPosition[2],
            ]
          : [item.position[0]!, item.position[1]!, item.position[2]!]
        try {
          const outcome = addObject(
            draft,
            {
              compiled: { ...compiled, nodeId: mint('item') },
              name: item.name,
              category: item.category,
              reason: `author_scene: ${item.name}`,
              position,
              rotation: item.rotation,
              parentId: hostId ?? levelNode.id,
            },
            { ...context, activeLevelId: levelNode.id },
          )
          for (const { node, parentId } of outcome.changes?.create ?? []) {
            draft[node.id] = node
            const parent = draft[parentId ?? levelNode.id] as AnyNode & { children?: string[] }
            parent.children = [...(parent.children ?? []), node.id]
            itemNodeIds.set(item.id, node.id)
            report.ids[item.id] = node.id
            itemPositions.set(item.id, [item.position[0]!, item.position[1]!, item.position[2]!])
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
      let hostKey = light.fixture && itemNodeIds.has(light.fixture) ? light.fixture : undefined
      if (!hostKey) {
        let best: { key: string; d: number } | null = null
        for (const [key, pos] of itemPositions) {
          const d = Math.hypot(pos[0] - light.position[0]!, pos[2] - light.position[2]!)
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
        report.notes.push(
          `${id}: no fixture given, attached to ${hostKey} ${best.d.toFixed(2)} m away; moving that item moves the light.`,
        )
      }
      const hostNode = draft[itemNodeIds.get(hostKey)!] as AnyNode & {
        asset: { interactive?: { controls: unknown[]; effects: unknown[] } }
      }
      const hostPos = itemPositions.get(hostKey)!
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
          offset: [
            light.position[0]! - hostPos[0],
            light.position[1]! - hostPos[1],
            light.position[2]! - hostPos[2],
          ],
        },
      ]
      draft[hostNode.id] = Object.assign({}, hostNode, {
        asset: { ...hostNode.asset, interactive: { controls, effects } },
      }) as unknown as AnyNode
      report.lights++
    }

    // ---------- wall paint, through the editor's paint ----------
    for (const w of walls) {
      const node = wallNodes.get(w.spec.id)
      if (!node || !w.spec.color) continue
      try {
        const { changes } = paint(
          draft,
          { targets: [node.id], color: w.spec.color },
          { ...context, activeLevelId: levelNode.id },
        )
        for (const u of changes?.update ?? [])
          draft[u.id] = { ...draft[u.id], ...u.data } as AnyNode
      } catch (error) {
        defect(w.spec.id, 'paint_refused', (error as Error).message)
      }
    }
  })
  report.levels = levelNodes.length

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
      const zone = zones.find(
        (z) => z.parentId === levelNode.id && pointInPolygon(room.seed, z.polygon),
      )
      // Two seeds in one enclosure: the walls do not separate the rooms the payload names.
      if (zone && claimed.has(zone.id)) {
        defect(
          `room/${index}/${i}`,
          'room_shares_enclosure',
          `"${room.name}" and "${claimed.get(zone.id)}" are one enclosure: no wall separates them.`,
        )
        continue
      }
      if (!zone) {
        defect(
          `room/${index}/${i}`,
          'room_not_enclosed',
          `No closed room around (${room.seed[0]}, ${room.seed[1]}) "${room.name}": its walls do not meet.`,
        )
        continue
      }
      const finish = finishRef(room.floor)
      const regions = room.floorRegions.map((r, k) => ({
        id: `region_${k}`,
        polygon: r.polygon,
        finish: finishRef(r.finish) ?? r.finish,
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
      report.ids[`room/${index}/${i}`] = zone.id
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
      delete: deleted,
      create: create.map((c) => ({
        node: (c as { node: AnyNode }).node,
        parentId: (c as { parentId?: string }).parentId,
      })),
    },
  }
}
