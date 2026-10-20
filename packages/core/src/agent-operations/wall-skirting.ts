import { refuse } from '../agent-tools/refusal'
import {
  type AnyNode,
  getWallTrimFaces,
  getWallTrimSlotId,
  type WallFace,
  type WallNode,
  type WallTrimProfile,
} from '../schema'
import { roomFaceCover } from '../systems/wall/wall-room-sides'
import { wallTrimPatch } from '../systems/wall/wall-trim'
import { paint } from './paint'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

export type SetWallSkirtingInput = {
  wallIds: string[]
  /** False hides the skirting and keeps its settings; absent or true shows it. */
  enabled?: boolean
  /** Metres up the face from its base. */
  height?: number
  /** Metres it stands proud of the face (stored as `proud`). */
  depth?: number
  profile?: WallTrimProfile
  /** The faces it runs along; absent, the faces a room stands on. */
  faces?: 'a' | 'b' | 'both'
  /** A `library:` / `scene:` ref or a `#rrggbb` colour, painted as `paint` paints it; absent keeps the skirting's finish. */
  finish?: string
}

/**
 * The faces a wall's skirting runs along when none are named: those a room stands on, else those
 * its stored sides call interior. A wall with neither is refused, so the caller names its faces.
 */
function roomFaces(nodes: SceneNodes, wall: WallNode): WallFace[] {
  const cover = roomFaceCover(nodes, wall.id)
  const faces = (['a', 'b'] as const).filter((face) => cover[face] !== 'none')
  if (faces.length) return faces
  const interior = (['a', 'b'] as const).filter(
    (face) => (face === 'a' ? wall.frontSide : wall.backSide) === 'interior',
  )
  if (interior.length) return interior
  refuse(
    'side_unknown',
    `Wall ${wall.id} has no room on either face: name the faces its skirting runs along, a, b or both.`,
    { target: wall.id },
  )
}

const positive = (value: number | undefined, field: string) => {
  if (value !== undefined && !(Number.isFinite(value) && value > 0))
    refuse('invalid_size', `A skirting's ${field} is a length above 0 m.`, { field })
}

/**
 * `setWallSkirting`: a wall's skirting (baseboard) shown, sized and finished in one write, the one
 * the wall panel makes. It is a property of the wall, so it follows the wall wherever the wall
 * goes, steps with its base and breaks at its doors and floor-length openings. The finish is the
 * skirting slot of each face it runs along, painted through `paint`.
 */
export const setWallSkirting: AgentOperation<SetWallSkirtingInput> = (nodes, input, context) => {
  positive(input.height, 'height')
  positive(input.depth, 'depth')
  const scratch: Record<string, AnyNode> = { ...nodes }
  const walls: { id: string; faces: WallFace[]; height: number; depth: number }[] = []
  for (const id of new Set(input.wallIds)) {
    const wall = nodes[id]
    if (wall?.type !== 'wall')
      refuse('target_not_found', `${id} is not a wall in the scene: nothing was changed.`, {
        target: id,
      })
    if (wall.wallType === 'curtain')
      refuse('curtain_wall', `Wall ${id} is a curtain wall: it has no skirting.`, { target: id })
    const faces = input.faces === undefined ? roomFaces(nodes, wall) : getWallTrimFaces(input.faces)
    const { skirting } = wallTrimPatch(wall, 'skirting', {
      enabled: input.enabled ?? true,
      sides: faces.length === 2 ? 'both' : faces[0],
      ...(input.height === undefined ? {} : { height: input.height }),
      ...(input.depth === undefined ? {} : { proud: input.depth }),
      ...(input.profile === undefined ? {} : { profile: input.profile }),
    })
    scratch[id] = { ...wall, skirting }
    walls.push({ id, faces, height: skirting.height, depth: skirting.proud })
  }

  let note: string | undefined
  if (input.finish !== undefined) {
    const finish = /^#[0-9a-fA-F]{6}$/.test(input.finish)
      ? { color: input.finish }
      : { material: input.finish }
    for (const face of ['a', 'b'] as const) {
      const targets = walls.filter((wall) => wall.faces.includes(face)).map((wall) => wall.id)
      if (!targets.length) continue
      const painted = paint(
        scratch,
        { targets, role: getWallTrimSlotId(face, 'skirting'), ...finish },
        context,
      )
      for (const { id, data } of painted.changes?.update ?? [])
        scratch[id] = { ...scratch[id], ...data } as AnyNode
      note ??= painted.result.note as string | undefined
    }
  }

  const update: NonNullable<SceneChanges['update']> = Object.keys(scratch).flatMap((id) => {
    const [before, after] = [
      nodes[id] as Record<string, unknown>,
      scratch[id] as Record<string, unknown>,
    ]
    if (before === after) return []
    const data = Object.fromEntries(
      Object.keys(after)
        .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        .map((key) => [key, after[key]]),
    )
    return Object.keys(data).length ? [{ id, data: data as Partial<AnyNode> }] : []
  })
  return {
    result: { ok: true, walls, ...(note ? { note } : {}) },
    changes: { update },
  }
}
