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
import type { AnyNode, ColumnNode, FenceNode, MaterialSchema, WallNode } from '../schema'
import { planWallPaint } from '../systems/wall/wall-paint-plan'
import { roomSideFaces } from '../systems/wall/wall-room-sides'
import { finishSurface, requireMaterialRef } from './material-refs'
import { registerBuildPath } from './reference-items'
import { resolveInlinePaintMaterial } from './scene-materials'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

/**
 * `paint` (L46): a finish in one call, as the editor's paint gives it. Run 3 took five attempts to
 * paint a pier grey through patches: `material: {color}` was stored as `{}`, `materialPreset:
 * null` was refused, and an unknown preset fell back to grey. A colour is the nearest of the
 * library's flat colours, said with how near; inline PBR is persisted as a native scene material.
 * Existing refs are checked when the host supplies its registry; slots are written
 * as the editor's slot paint writes them, a wall's faces through its paint plan, a roof's role
 * through its role field.
 */

type PaintInput = {
  targets: string[]
  role?: string
  color?: string
  material?: string | MaterialSchema
  materialName?: string
  erase?: true
}

// An approximated or impossible finish in a reference inventory points here (L60).
registerBuildPath('material', {
  tool: 'paint',
  how: 'paint gives it a library material or the nearest library colour: paint {targets, material | color}',
})
registerBuildPath('roof', {
  tool: 'paint',
  how: "paint gives a roof's top, edge or wall a library material or a colour: paint {targets, role, material | color}",
})

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

/** The finish asked for, as the ref written, or undefined to erase; refused when it is unknown. */
function finishOf(input: PaintInput, surface: MaterialSurface | undefined, context: AgentContext) {
  const given = [input.color, input.material, input.erase].filter((value) => value !== undefined)
  if (given.length !== 1)
    refuse(
      'finish_required',
      'Give one finish: color (#rrggbb), material (an existing ref or native MaterialSchema), or erase: true.',
    )
  if (
    input.materialName !== undefined &&
    (typeof input.material !== 'object' ||
      !input.materialName.trim() ||
      input.materialName.trim().length > 120)
  )
    refuse(
      'invalid_material_name',
      'materialName (1–120 characters) is only for an inline material.',
    )
  if (input.erase) return { ref: undefined, note: null }
  if (input.color) {
    const match = nearestLibraryColorRef(input.color)
    if (!match) refuse('invalid_color', `${input.color} is no colour: give #rrggbb.`)
    return {
      ref: match.ref,
      note: `${input.color}: nearest library colour ${match.name} (${match.color}), ΔE ${Math.round(match.distance)}.`,
    }
  }
  if (typeof input.material === 'object') {
    const resolution = resolveInlinePaintMaterial(
      context.materials,
      input.material,
      input.materialName?.trim(),
    )
    return { ...resolution, note: null }
  }
  const ref = requireMaterialRef(input.material!, undefined, surface, {
    paint: true,
    materials: context.materials,
  })
  return {
    ref,
    note: null,
    sceneMaterial:
      context.materials &&
      Object.values(context.materials).find((entry) => `scene:${entry.id}` === ref),
    created: false,
  }
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

export const paint: AgentOperation<PaintInput> = (nodes, input, context) => {
  if (!input.targets.length) refuse('target_not_found', 'Give at least one node to paint.')
  // A refused material's nearest are the first target's kind: a roof is offered roofing.
  const first = input.targets[0] ? nodes[input.targets[0]] : undefined
  const finish = finishOf(input, first && finishSurface(first.type, input.role), context)
  const { ref, note } = finish
  const sceneMaterial = 'sceneMaterial' in finish ? finish.sceneMaterial : undefined
  const written: Record<string, AnyNode> = {}
  const current = (id: string) => (written[id] ?? nodes[id]) as AnyNode | undefined
  const scene = () => ({ ...nodes, ...written }) as SceneNodes
  const painted: { id: string; roles: string[] }[] = []

  for (const id of input.targets) {
    const node = current(id)
    if (!node)
      refuse(
        'target_not_found',
        `Nothing to paint: ${id} is not in the current scene. Read the current scene for native target IDs before retrying; room edits may retire earlier wall IDs. Nothing in this paint call was applied.`,
        { target: id },
      )

    if (node.type === 'roof' || node.type === 'roof-segment') {
      const role = (input.role ?? 'top') as RoofRole
      if (!ROOF_ROLES.includes(role))
        refuse('unknown_role', `A roof's roles are ${ROOF_ROLES.join(', ')}.`, {
          target: id,
          roles: [...ROOF_ROLES],
        })
      const field = `${role}MaterialPreset`
      // A segment's own role, then its catch-all, come before its roof's.
      if (node.type === 'roof') {
        const hiding = (node.children as string[]).flatMap((childId) => {
          const segment = current(childId) as (AnyNode & Record<string, unknown>) | undefined
          return segment
            ? [field, 'materialPreset']
                .filter((key) => typeof segment[key] === 'string' && segment[key])
                .map((key) => `${segment.id}.${key}`)
            : []
        })
        if (hiding.length)
          refuse(
            'shadowed_field',
            `The roof's ${role} would not show: ${hiding.join(', ')} hides it. Paint the segments, or clear those fields (null).`,
            { target: id, fields: hiding },
          )
      }
      const next = { ...node } as Record<string, unknown>
      if (ref) next[field] = ref
      else delete next[field]
      written[id] = next as AnyNode
      painted.push({ id, roles: [role] })
      continue
    }

    const slots = slotsOf(node)
    if (!slots)
      refuse(
        'not_paintable',
        `A ${node.type} has no finish paint gives: paint walls, columns, slabs, ceilings, fences, doors, windows or roofs.`,
        {
          target: id,
          type: node.type,
        },
      )
    const ids = slots.map((slot) => slot.slotId)
    let roles: string[]
    if (input.role === 'exterior' || input.role === 'interior') {
      if (node.type !== 'wall')
        refuse(
          'unknown_role',
          `Only a wall has an ${input.role}: a ${node.type}'s roles are ${ids.join(', ')}.`,
          {
            target: id,
            roles: ids,
          },
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
  if ('created' in finish && finish.created && !update.length)
    refuse(
      'no_paint_effect',
      'No surface changed, so the inline material was not created. Name a paintable role explicitly.',
    )
  const createdMaterial =
    'created' in finish && finish.created && update.length ? sceneMaterial : undefined
  return {
    result: {
      ok: true,
      painted,
      finish: ref ?? 'default',
      ...(sceneMaterial ? { materialId: sceneMaterial.id, material: sceneMaterial.material } : {}),
      ...(createdMaterial ? { createdMaterial } : {}),
      ...(note ? { note } : {}),
    },
    changes: {
      update,
      ...(createdMaterial ? { materials: [createdMaterial] } : {}),
    },
  }
}
