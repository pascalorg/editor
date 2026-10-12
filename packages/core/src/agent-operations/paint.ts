import { refuse } from '../agent-tools/refusal'
import type { MaterialSurface } from '../material-library'
import {
  ceilingSlots,
  columnSlots,
  doorSlots,
  fenceSlots,
  slabSlots,
  wallSlots,
  windowSlots,
} from '../node-slots'
import { nearestLibraryColorRef } from '../procedural-items/library-colors'
import type { SlotDeclaration } from '../registry/types'
import {
  type AnyNode,
  type ColumnNode,
  type FenceNode,
  getEffectiveSegmentSurfaceMaterial,
  type MaterialSchema,
  type RoofSegmentNode,
  type SceneMaterial,
  type WallNode,
} from '../schema'
import { planWallPaint } from '../systems/wall/wall-paint-plan'
import { roomSideFaces } from '../systems/wall/wall-room-sides'
import { finishSurface, requireMaterialRef } from './material-refs'
import { resolveInlinePaintMaterial } from './scene-materials'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

/**
 * `paint`: a finish in one call, as the editor's Paint gives it. Through patches an agent once took
 * five tries to paint a pier grey: `material: {color}` was stored as `{}`, `materialPreset: null`
 * was refused and an unknown preset fell back to grey. A colour is the nearest of the library's
 * flat colours, said with how near; a native material is kept as a scene material. Slots are
 * written as the editor's slot paint writes them, a wall's faces through its paint plan, a roof's
 * role through its role field.
 */

type PaintInput = {
  targets: string[]
  role?: string
  color?: string
  material?: string | MaterialSchema
  materialName?: string
  erase?: true
}

const ROOF_ROLES = ['top', 'edge', 'wall'] as const
type RoofRole = (typeof ROOF_ROLES)[number]

/** The surfaces painted when no role is named: what "paint the column" means. */
const DEFAULT_ROLES: Record<string, readonly string[]> = {
  wall: ['a', 'b', 'curtain-frame', 'curtain-solid'],
  column: ['shaft'],
  slab: ['surface'],
  ceiling: ['surface'],
  fence: ['posts', 'infill', 'base', 'rail'],
  door: ['panel', 'frame'],
  window: ['frame'],
}

function slotsOf(node: AnyNode): SlotDeclaration[] | null {
  switch (node.type) {
    case 'wall':
      return wallSlots(node as WallNode)
    case 'column':
      return columnSlots(node as ColumnNode)
    case 'slab':
      return slabSlots()
    case 'ceiling':
      return ceilingSlots()
    case 'fence':
      return fenceSlots(node as FenceNode)
    case 'door':
      return doorSlots()
    case 'window':
      return windowSlots()
    default:
      return null
  }
}

type Finish = {
  /** The ref written, or undefined to erase. */
  ref: string | undefined
  note?: string
  sceneMaterial?: SceneMaterial
  created?: boolean
}

/** The finish asked for, as the ref it writes; refused when it is unknown. */
function finishOf(
  input: PaintInput,
  surface: MaterialSurface | undefined,
  context: AgentContext,
): Finish {
  const given = [input.color, input.material, input.erase].filter((value) => value !== undefined)
  if (given.length !== 1)
    refuse(
      'finish_required',
      'Give one finish: color (#rrggbb), material (a library or scene ref, or a native material), or erase: true.',
    )
  if (input.materialName !== undefined && typeof input.material !== 'object')
    refuse('invalid_material_name', 'materialName names a native material only.')
  if (input.erase) return { ref: undefined }
  if (input.color) {
    const match = nearestLibraryColorRef(input.color)
    if (!match) refuse('invalid_color', `${input.color} is no colour: give #rrggbb.`)
    return {
      ref: match.ref,
      note: `${input.color}: nearest library colour ${match.name} (${match.color}), ΔE ${Math.round(match.distance)}.`,
    }
  }
  if (typeof input.material === 'object')
    return resolveInlinePaintMaterial(context.materials, input.material, input.materialName)
  const ref = requireMaterialRef(input.material!, undefined, surface, {
    paint: true,
    materials: context.materials,
  })
  const sceneMaterial = context.materials
    ? Object.values(context.materials).find((entry) => `scene:${entry.id}` === ref)
    : undefined
  return { ref, ...(sceneMaterial ? { sceneMaterial } : {}) }
}

/** A node's data for an update: what changed, and `undefined` for the fields it lost. */
function changedData(before: AnyNode, after: AnyNode): Partial<AnyNode> {
  const data: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const [a, b] = [
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
    ]
    if (JSON.stringify(a) !== JSON.stringify(b)) data[key] = b
  }
  return data as Partial<AnyNode>
}

/** A roof's or a segment's role written, its inline material for that role gone with it. */
function paintRoofRole(node: AnyNode, role: RoofRole, ref: string | undefined): AnyNode {
  const next = { ...node } as Record<string, unknown>
  delete next[`${role}Material`]
  if (ref) next[`${role}MaterialPreset`] = ref
  else delete next[`${role}MaterialPreset`]
  return next as AnyNode
}

export const paint: AgentOperation<PaintInput> = (nodes, input, context) => {
  // A refused material's nearest are the first target's kind: a roof is offered roofing.
  const first = input.targets[0] ? nodes[input.targets[0]] : undefined
  const finish = finishOf(input, first && finishSurface(first.type, input.role), context)
  const { ref } = finish
  const written: Record<string, AnyNode> = {}
  const current = (id: string) => (written[id] ?? nodes[id]) as AnyNode | undefined
  const scene = () => ({ ...nodes, ...written }) as SceneNodes
  const painted: { id: string; roles: string[] }[] = []

  for (const id of input.targets) {
    const node = current(id)
    if (!node)
      refuse(
        'target_not_found',
        `Nothing to paint: ${id} is not in the scene (a room edit may have replaced its walls: read the scene again). Nothing was painted.`,
        { target: id },
      )

    if (node.type === 'roof' || node.type === 'roof-segment') {
      const role = (input.role ?? 'top') as RoofRole
      if (!ROOF_ROLES.includes(role))
        refuse('unknown_role', `A roof's roles are ${ROOF_ROLES.join(', ')}.`, {
          target: id,
          roles: [...ROOF_ROLES],
        })
      if (node.type === 'roof') {
        // A segment's own finish for the role, or its catch-all, shows over its roof's.
        const shadowing = node.children.filter((childId) => {
          const segment = current(childId)
          if (segment?.type !== 'roof-segment') return false
          const own = getEffectiveSegmentSurfaceMaterial(segment as RoofSegmentNode, role)
          return own.material !== undefined || own.materialPreset !== undefined
        })
        if (shadowing.length)
          refuse(
            'shadowed_field',
            `The roof's ${role} would not show: segments ${shadowing.join(', ')} have their own. Paint the segments instead.`,
            { target: id, segments: shadowing },
          )
      }
      written[id] = paintRoofRole(node, role, ref)
      painted.push({ id, roles: [role] })
      continue
    }

    const slots = slotsOf(node)
    if (!slots)
      refuse(
        'not_paintable',
        `A ${node.type} has no finish paint gives: paint walls, columns, slabs, ceilings, fences, doors, windows or roofs.`,
        { target: id, type: node.type },
      )
    const ids = slots.map((slot) => slot.slotId)
    let roles: string[]
    if (input.role === 'exterior' || input.role === 'interior') {
      if (node.type !== 'wall')
        refuse(
          'unknown_role',
          `Only a wall has an ${input.role} face: a ${node.type}'s roles are ${ids.join(', ')}.`,
          { target: id, roles: ids },
        )
      const sides = roomSideFaces(scene() as never, id)
      const face = input.role === 'interior' ? sides.inside : sides.outside
      if (!face)
        refuse(
          'side_unknown',
          `Wall ${id} has rooms on both sides or none: name its face, a or b.`,
          { target: id },
        )
      roles = [face]
    } else if (input.role) {
      if (!ids.includes(input.role))
        refuse('unknown_role', `A ${node.type}'s roles are ${ids.join(', ')}.`, {
          target: id,
          roles: ids,
        })
      roles = [input.role]
    } else roles = (DEFAULT_ROLES[node.type] ?? []).filter((role) => ids.includes(role))
    if (!roles.length)
      refuse('unknown_role', `Name the ${node.type}'s surface: its roles are ${ids.join(', ')}.`, {
        target: id,
        roles: ids,
      })

    for (const role of roles) {
      const target = current(id)!
      if (target.type === 'wall') {
        Object.assign(written, planWallPaint(scene(), target, { kind: 'slot', slotId: role }, ref))
        continue
      }
      const next = { ...((target as AnyNode & { slots?: Record<string, string> }).slots ?? {}) }
      if (ref) next[role] = ref
      else delete next[role]
      written[id] = { ...target, slots: next } as AnyNode
    }
    painted.push({ id, roles })
  }

  const update = Object.entries(written).flatMap(([id, node]) => {
    const data = changedData(nodes[id]!, node)
    return Object.keys(data).length ? [{ id, data }] : []
  })
  const createdMaterial = finish.created ? finish.sceneMaterial : undefined
  return {
    result: {
      ok: true,
      painted,
      finish: ref ?? 'default',
      ...(finish.sceneMaterial
        ? { materialId: finish.sceneMaterial.id, material: finish.sceneMaterial.material }
        : {}),
      ...(createdMaterial ? { createdMaterial } : {}),
      ...(finish.note ? { note: finish.note } : {}),
    },
    changes: { update, ...(createdMaterial ? { materials: [createdMaterial] } : {}) },
  }
}
