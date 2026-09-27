import { z } from 'zod'
import type { WallNode } from '../schema/nodes/wall'
import { type DesignDiagnostic, validateDesign } from './design'
import { ProceduralItemNode } from './node'
import {
  isProceduralItem,
  proceduralLocalPose,
  type QueryNodes,
  validateProceduralRelations,
} from './query'
import { evaluateRecipe, parseRecipe, type Vec3 } from './recipe'
import { boundsOf, boxCorners, frame, transformPoint } from './spatial'

/**
 * Where and how to create one design instance, in today's hosting fields:
 * - floor designs: `hostId` is a level, or a slab or zone of it (the level becomes the parent),
 *   or a design whose named `surfaceId` it rests on; `position` is in that frame, y up;
 * - wall-side designs: `hostId` is a straight wall, `position` is [along, height, offset] of
 *   the mounting reference from the wall start on `side`;
 * - ceiling designs: `hostId` is a ceiling, `position` is the plan [x, 0, z] of the reference.
 * `rotation` is a yaw in radians (not for wall-side designs, which face away from the wall).
 */
export type DesignPlacementRequest = {
  design: unknown
  hostId: string
  position: Vec3
  rotation?: number
  side?: 'front' | 'back'
  surfaceId?: string
  parameters?: Record<string, number>
  slots?: Record<string, string>
  name?: string
  /** A new id; whether it is free is the writer's check (the MCP patch guards). */
  id?: string
}

export type DesignPlacementRefusal =
  | 'invalid_design'
  | 'invalid_placement'
  | 'host_not_found'
  | 'wrong_host'
  | 'unknown_surface'
  | 'does_not_fit'

/** A typed refusal; the message starts with the code because some clients only show messages. */
export class DesignPlacementError extends Error {
  constructor(
    readonly code: DesignPlacementRefusal,
    detail: string,
    readonly diagnostics: DesignDiagnostic[] = [],
  ) {
    super(`${code}: ${detail}`)
    this.name = 'DesignPlacementError'
  }
}

export type DesignPlacement = {
  node: ProceduralItemNode
  parentId: string
  /** The surface host's attachment map after placement, when the design rests on a design surface. */
  hostUpdate?: { id: string; attachments: Record<string, string> }
}

const round = (value: number) => Math.round(value * 1000) / 1000

function wallRange(node: ProceduralItemNode, wall: WallNode, nodes: QueryNodes) {
  const pose = proceduralLocalPose({ ...node, position: [0, 0, 0] }, nodes)
  const e = evaluateRecipe(node.recipe, node.parameters)
  const b = boundsOf(
    boxCorners(e.min, e.max).map((p) => transformPoint(frame(pose.position, pose.rotation), p)),
  )
  const level = wall.parentId ? nodes[wall.parentId] : undefined
  const height = wall.height ?? (level?.type === 'level' ? level.height : 2.5) ?? 2.5
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  return `the reference fits along ${round(-b.min[0])}–${round(length - b.max[0])} m and at height ${round(-b.min[1])}–${round(height - b.max[1])} m on this wall`
}

/**
 * Plan a create-only placement of a design: validate it (the same authority as
 * `validateDesign`), resolve its host from its mounting, build the node and run the
 * procedural relation checks without the node registry. Throws `DesignPlacementError`.
 */
export function planDesignPlacement(
  nodes: QueryNodes,
  request: DesignPlacementRequest,
): DesignPlacement {
  const { hostId, position, rotation = 0, side, surfaceId, parameters = {} } = request
  const check = validateDesign(request.design, { parameters })
  if (!check.valid) {
    const errors = check.diagnostics.filter((d) => d.severity === 'error')
    throw new DesignPlacementError(
      'invalid_design',
      `${errors[0]?.message ?? 'Invalid design'}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`,
      errors,
    )
  }
  const recipe = parseRecipe(
    typeof request.design === 'string' ? JSON.parse(request.design) : request.design,
  )
  let host = nodes[hostId]
  if (!host) throw new DesignPlacementError('host_not_found', `No node ${hostId}`)

  const mounting = recipe.mounting?.attachTo ?? 'floor'
  const expected = {
    ceiling: 'a ceiling',
    'wall-side': 'a straight wall',
    floor: 'a level, slab, zone or design surface',
  }[mounting]
  if (mounting === 'floor' && (host.type === 'slab' || host.type === 'zone')) {
    const level = host.parentId ? nodes[host.parentId] : undefined
    if (level?.type !== 'level')
      throw new DesignPlacementError('wrong_host', `${hostId} is not on a level`)
    host = level
  }
  const hostKind = mounting === 'ceiling' ? 'ceiling' : mounting === 'wall-side' ? 'wall' : null
  const surfaceHost = mounting === 'floor' && isProceduralItem(host) ? host : undefined
  const onSurface = surfaceHost !== undefined
  if (hostKind ? host.type !== hostKind : !(host.type === 'level' || onSurface))
    throw new DesignPlacementError(
      'wrong_host',
      `This ${mounting} design needs ${expected}, not a ${host.type}`,
    )
  if (surfaceId !== undefined && !onSurface)
    throw new DesignPlacementError('invalid_placement', 'surfaceId only applies to a design host')
  if (side !== undefined && mounting !== 'wall-side')
    throw new DesignPlacementError('invalid_placement', 'side only applies to wall-side designs')
  if (mounting === 'wall-side' && rotation !== 0)
    throw new DesignPlacementError(
      'invalid_placement',
      'Wall-side designs face away from the wall; use side instead of rotation',
    )
  if ((mounting === 'ceiling' || onSurface) && position[1] !== 0)
    throw new DesignPlacementError(
      'invalid_placement',
      `${onSurface ? 'Designs rest on a surface' : 'Ceiling designs hang flush'}: position[1] must be 0`,
    )
  if (surfaceHost) {
    if (surfaceId === undefined)
      throw new DesignPlacementError(
        'invalid_placement',
        'Pass the surfaceId of the design surface to rest on',
      )
    const surfaces = evaluateRecipe(surfaceHost.recipe, surfaceHost.parameters).surfaces.map(
      (s) => s.id,
    )
    if (!surfaces.includes(surfaceId))
      throw new DesignPlacementError(
        'unknown_surface',
        `${hostId} has no surface ${surfaceId}; it has ${surfaces.join(', ') || 'none'}`,
      )
  }

  let node: ProceduralItemNode
  try {
    node = ProceduralItemNode.parse({
      ...(request.id !== undefined ? { id: request.id } : {}),
      recipe,
      name: request.name ?? recipe.name,
      parameters,
      slots: request.slots ?? {},
      parentId: host.id,
      position,
      rotation: [0, rotation, 0],
      ...(mounting === 'wall-side' ? { wallId: host.id, side: side ?? 'front' } : {}),
    })
  } catch (error) {
    throw new DesignPlacementError(
      'invalid_placement',
      error instanceof z.ZodError
        ? error.issues.map((i) => `${i.path.join('.') || 'node'}: ${i.message}`).join('; ')
        : String(error),
    )
  }

  const hostNext = surfaceHost
    ? {
        ...surfaceHost,
        children: [...surfaceHost.children, node.id],
        attachments: { ...surfaceHost.attachments, [node.id]: surfaceId! },
      }
    : undefined
  const next: QueryNodes = {
    ...nodes,
    [node.id]: node,
    ...(hostNext && { [hostNext.id]: hostNext }),
  }
  try {
    validateProceduralRelations(node, next)
    if (hostNext) validateProceduralRelations(hostNext, next)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const hint =
      host.type === 'wall' && !host.curveOffset ? `; ${wallRange(node, host, nodes)}` : ''
    throw new DesignPlacementError('does_not_fit', `${detail}${hint}`)
  }
  return {
    node,
    parentId: host.id,
    ...(hostNext && { hostUpdate: { id: hostNext.id, attachments: hostNext.attachments } }),
  }
}
