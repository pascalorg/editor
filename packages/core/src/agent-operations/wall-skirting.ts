import { refuse } from '../agent-tools/refusal'
import {
  type AnyNode,
  getWallTrimFaces,
  getWallTrimSlotId,
  WALL_SURFACE_SLOT_DEFAULTS,
  type WallFace,
  type WallNode,
  type WallTrimKind,
  type WallTrimProfile,
  type WallTrimSpan,
} from '../schema'
import { roomFaceCover } from '../systems/wall/wall-room-sides'
import { subtractTrimSpans, wallTrimPatch } from '../systems/wall/wall-trim'
import { paint } from './paint'
import { roomWallFaces } from './room-faces'
import type { AgentContext, AgentOperation, SceneChanges, SceneNodes } from './types'

export type SetWallTrimInput = {
  kind: WallTrimKind
  wallIds?: string[]
  zoneIds?: string[]
  roomId?: string
  /** Planner-only filter for room layers; unlike wallIds, never expands to whole faces. */
  roomWallIds?: string[]
  enabled?: boolean
  height?: number
  depth?: number
  offsetY?: number
  profile?: WallTrimProfile
  faces?: 'a' | 'b' | 'both'
  finish?: string
}

export type SetWallSkirtingInput = Omit<
  SetWallTrimInput,
  'kind' | 'zoneIds' | 'roomId' | 'roomWallIds'
> & {
  wallIds: string[]
}

/** Room-facing sides, falling back to the wall's stored classification. */
function roomFaces(nodes: SceneNodes, wall: WallNode): WallFace[] {
  const cover = roomFaceCover(nodes, wall.id)
  const faces = (['a', 'b'] as const).filter((face) => cover[face] !== 'none')
  if (faces.length) return faces
  const interior = (['a', 'b'] as const).filter(
    (face) => (face === 'a' ? wall.frontSide : wall.backSide) === 'interior',
  )
  if (interior.length) return interior
  refuse('side_unknown', `Wall ${wall.id} has no room on either face: name a, b or both.`, {
    target: wall.id,
  })
}

const wallTarget = (nodes: SceneNodes, id: string): WallNode => {
  const wall = nodes[id]
  if (wall?.type !== 'wall')
    refuse('target_not_found', `${id} is not a wall in the scene: nothing was changed.`, {
      target: id,
    })
  if (wall.wallType === 'curtain' || wall.wallType === 'railing')
    refuse(`${wall.wallType}_wall`, `Wall ${id} is a ${wall.wallType} wall: it has no trim face.`, {
      target: id,
    })
  return wall
}

/** One field-level update per changed node on a scratch scene. */
export function sceneUpdates(
  nodes: SceneNodes,
  scratch: Readonly<Record<string, AnyNode>>,
): NonNullable<SceneChanges['update']> {
  return Object.keys(scratch).flatMap((id) => {
    const [before, after] = [nodes[id], scratch[id]] as Record<string, unknown>[]
    if (before === after) return []
    const data = Object.fromEntries(
      [...new Set([...Object.keys(before!), ...Object.keys(after!)])]
        .filter((key) => JSON.stringify(before![key]) !== JSON.stringify(after![key]))
        .map((key) => [key, after![key]]),
    )
    return Object.keys(data).length ? [{ id, data: data as Partial<AnyNode> }] : []
  })
}

/** Paint only the selected trim slots, with paint's existing colour/ref semantics. */
export function paintTrim(
  scratch: Record<string, AnyNode>,
  kind: WallTrimKind,
  walls: readonly { id: string; faces: readonly WallFace[] }[],
  finish: string | undefined,
  context: AgentContext,
): string | undefined {
  if (finish === undefined) return undefined
  const as = /^#[0-9a-fA-F]{6}$/.test(finish) ? { color: finish } : { material: finish }
  let note: string | undefined
  for (const face of ['a', 'b'] as const) {
    const targets = walls.filter((wall) => wall.faces.includes(face)).map((wall) => wall.id)
    if (!targets.length) continue
    const painted = paint(scratch, { targets, role: getWallTrimSlotId(face, kind), ...as }, context)
    for (const { id, data } of painted.changes?.update ?? [])
      scratch[id] = { ...scratch[id], ...data } as AnyNode
    note ??= painted.result.note as string | undefined
  }
  return note
}

/** A room edit cannot change a wall-wide moulding under another retained stretch. */
export const setWallTrim: AgentOperation<SetWallTrimInput> = (nodes, input, context) => {
  const { kind } = input
  for (const [field, value] of [
    ['height', input.height],
    ['depth', input.depth],
    ['offsetY', input.offsetY],
  ] as const)
    if (
      value !== undefined &&
      !(Number.isFinite(value) && (field === 'offsetY' ? value >= 0 : value > 0))
    )
      refuse(
        'invalid_size',
        `A trim's ${field} must be ${field === 'offsetY' ? 'at least' : 'above'} 0 m.`,
        { field },
      )
  const rooms = [...new Set([...(input.zoneIds ?? []), ...(input.roomId ? [input.roomId] : [])])]
  if (!input.wallIds?.length && !rooms.length)
    refuse('target_required', 'Name wallIds, zoneIds or roomId: nothing was changed.')
  const named = input.faces === undefined ? undefined : getWallTrimFaces(input.faces)
  const direct = new Set(input.wallIds ?? [])
  const targets = new Map<string, WallTrimSpan[]>()
  for (const id of direct) {
    const wall = wallTarget(nodes, id)
    targets.set(
      id,
      (named ?? roomFaces(nodes, wall)).map((face) => ({ face })),
    )
  }
  for (const id of rooms) {
    const zone = nodes[id]
    if (zone?.type !== 'zone')
      refuse('target_not_found', `${id} is not a room in the scene.`, { target: id })
    // Validate before roomWallFaces filters walls that cannot carry finishes.
    for (const wallId of zone.boundaryWallIds ?? [])
      if (!input.roomWallIds || input.roomWallIds.includes(wallId)) wallTarget(nodes, wallId)
    const stretches = roomWallFaces(nodes, zone).filter(
      (span) =>
        (!named || named.includes(span.face)) &&
        (!input.roomWallIds || input.roomWallIds.includes(span.wallId)),
    )
    if (!stretches.length)
      refuse('no_walls', `Room ${zone.name} has no selected wall faces.`, { target: id })
    for (const stretch of stretches) {
      if (stretch.curved && !stretch.whole)
        refuse(
          'curved_wall',
          `Wall ${stretch.wallId} is curved: bounded room trim is not supported.`,
          { target: stretch.wallId },
        )
      const spans = targets.get(stretch.wallId) ?? []
      if (
        !spans.some(
          (span) => span.face === stretch.face && span.u0 === undefined && span.u1 === undefined,
        )
      )
        spans.push({
          face: stretch.face,
          ...(stretch.whole ? {} : { u0: stretch.u0, u1: stretch.u1 }),
        })
      targets.set(stretch.wallId, spans)
    }
  }

  const scratch: Record<string, AnyNode> = { ...nodes }
  const walls: { id: string; faces: WallFace[] }[] = []
  const retained = new Map<string, WallTrimSpan[]>()
  for (const [id, requested] of targets) {
    const wall = wallTarget(nodes, id)
    const before = wallTrimPatch(wall, kind, {})[kind]
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const existing: WallTrimSpan[] = before.enabled
      ? (before.spans?.filter((span) => getWallTrimFaces(before.sides).includes(span.face)) ??
        getWallTrimFaces(before.sides).map((face) => ({ face })))
      : []
    const outside = direct.has(id) ? [] : subtractTrimSpans(existing, requested, length)
    retained.set(id, outside)
    const list = [...new Set(requested.map((span) => span.face))].sort()
    const next = wallTrimPatch(wall, kind, {
      enabled: input.enabled ?? true,
      ...(input.height === undefined ? {} : { height: input.height }),
      ...(input.depth === undefined ? {} : { proud: input.depth }),
      ...(input.offsetY === undefined ? {} : { offsetY: input.offsetY }),
      ...(input.profile === undefined ? {} : { profile: input.profile }),
    })[kind]
    if (
      outside.length &&
      ['height', 'proud', 'profile', 'offsetY'].some(
        (key) => before[key as keyof typeof before] !== next[key as keyof typeof next],
      )
    )
      refuse(
        'trim_conflict',
        `Wall ${id} holds one ${kind}: these settings would change another stretch.`,
        { target: id, kind },
      )
    if (input.enabled === false) {
      if (!direct.has(id) && outside.length) {
        next.enabled = true
        next.spans = outside
        const kept = [...new Set(outside.map((span) => span.face))]
        next.sides = kept.length === 2 ? 'both' : kept[0]!
      }
      // Hiding the last stretch retains its settings, bounds and sides for showing again.
    } else {
      const spans = direct.has(id) ? requested : [...existing, ...requested]
      const faces = [...new Set(spans.map((span) => span.face))]
      next.sides = faces.length === 2 ? 'both' : faces[0]!
      next.spans = spans.every((span) => span.u0 === undefined && span.u1 === undefined)
        ? undefined
        : [...new Map(spans.map((span) => [JSON.stringify(span), span])).values()]
    }
    scratch[id] = { ...wall, [kind]: next }
    walls.push({ id, faces: list })
  }
  const note = paintTrim(scratch, kind, walls, input.finish, context)
  for (const [id, outside] of retained) {
    for (const face of new Set(outside.map((span) => span.face))) {
      const slot = getWallTrimSlotId(face, kind)
      const before = (nodes[id] as WallNode).slots?.[slot] ?? WALL_SURFACE_SLOT_DEFAULTS[slot]
      const after = (scratch[id] as WallNode).slots?.[slot] ?? WALL_SURFACE_SLOT_DEFAULTS[slot]
      if (before !== after)
        refuse(
          'trim_conflict',
          `Wall ${id}'s ${kind} finish is shared with another stretch on face ${face}.`,
          { target: id, kind, face },
        )
    }
  }
  return {
    result: {
      ok: true,
      kind,
      walls: walls.map(({ id, faces: targetFaces }) => {
        const wall = scratch[id] as WallNode
        const trim = wall[kind]!
        const faces = getWallTrimFaces(trim.sides)
        return {
          id,
          faces,
          targetFaces,
          enabled: trim.enabled,
          height: trim.height,
          depth: trim.proud,
          profile: trim.profile,
          ...(trim.offsetY === undefined ? {} : { offsetY: trim.offsetY }),
          ...(trim.spans === undefined ? {} : { spans: trim.spans }),
          finishes: Object.fromEntries(
            faces.map((face) => {
              const slot = getWallTrimSlotId(face, kind)
              return [face, wall.slots?.[slot] ?? WALL_SURFACE_SLOT_DEFAULTS[slot]]
            }),
          ),
        }
      }),
      ...(note ? { note } : {}),
    },
    changes: { update: sceneUpdates(nodes, scratch) },
  }
}

/** The existing conversion API retains its skirting-only contract. */
export const setWallSkirting: AgentOperation<SetWallSkirtingInput> = (nodes, input, context) => {
  const outcome = setWallTrim(nodes, { ...input, kind: 'skirting' }, context)
  const { kind: _kind, ...result } = outcome.result
  const walls = result.walls as {
    id: string
    targetFaces: WallFace[]
    height: number
    depth: number
  }[]
  return {
    ...outcome,
    result: {
      ...result,
      walls: walls.map(({ id, targetFaces: faces, height, depth }) => ({
        id,
        faces,
        height,
        depth,
      })),
    },
  }
}
