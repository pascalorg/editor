import { refuse } from '../agent-tools/refusal'
import { wallFaceScriptPaintRefusal } from '../lib/wall-face-script'
import type { MaterialSurface } from '../material-kinds'
import { GLAZED_ROOF_SLOTS, nodeSlotDeclarations } from '../node-slots'
import { nearestLibraryColorRef } from '../procedural-items/library-colors'
import {
  type AnyNode,
  getEffectiveSegmentSurfaceMaterial,
  getWallTrimSlotId,
  isGlazedRoofSegment,
  type MaterialSchema,
  type RoofNode,
  type RoofSegmentNode,
  type SceneMaterial,
  type WallFace,
  type WallNode,
  type WallTrimKind,
} from '../schema'
import { buildWallFinishLayout, getWallLevelZones } from '../systems/wall/wall-finish'
import { planWallPaint } from '../systems/wall/wall-paint-plan'
import { roomFaceCover } from '../systems/wall/wall-room-sides'
import { finishSurface, requireMaterialRef } from './material-refs'
import { resolveInlinePaintMaterial } from './scene-materials'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

/**
 * `paint`: a finish in one call, as the editor's Paint gives it. Through patches an agent once took
 * five tries to paint a pier grey: `material: {color}` was stored as `{}`, `materialPreset: null`
 * was refused and an unknown preset fell back to grey. A colour is the nearest of the library's
 * flat colours, said with how near; a native material is kept as a scene material. Slots are
 * written as the editor's slot paint writes them, a wall's faces through its paint plan, a roof's
 * role through its role field, on the roof: a roof shows one finish per surface, so a segment's
 * finish goes on its roof.
 */

type PaintInput = {
  targets: string[]
  role?: string
  color?: string
  material?: string | MaterialSchema
  materialName?: string
  erase?: true
}

const WALL_TRIMS: readonly WallTrimKind[] = ['skirting', 'crown', 'chairRail']

const ROOF_ROLES = ['top', 'edge', 'wall', 'fascia'] as const
type RoofRole = (typeof ROOF_ROLES)[number]
/** The surfaces the roof itself holds; its fascia is held by each of its segments. */
const SHELL_ROLES = ['top', 'edge', 'wall'] as const
type ShellRole = (typeof SHELL_ROLES)[number]

/** The surfaces painted when no role is named: what "paint the column" means. */
const DEFAULT_ROLES: Record<string, readonly string[]> = {
  wall: ['a', 'b', 'curtain-frame', 'curtain-solid'],
  column: ['shaft'],
  slab: ['surface'],
  ceiling: ['surface'],
  fence: ['posts', 'infill', 'base', 'rail'],
  door: ['panel', 'frame'],
  window: ['frame'],
  'roof-segment': ['glazing-frame', 'glazing-solid'],
  block: ['body'],
}

/** The roles painted without one named: the kind's defaults, or the one surface it has. */
function defaultRoles(type: string, ids: readonly string[]): string[] {
  const defaults = DEFAULT_ROLES[type]
  if (defaults) return defaults.filter((role) => ids.includes(role))
  return ids.length === 1 ? [...ids] : []
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

/** A node's role written as `<role>MaterialPreset`, its inline material for that role gone with it. */
function paintRoleField<T extends AnyNode>(node: T, role: RoofRole, ref: string | undefined): T {
  const next = { ...node } as Record<string, unknown>
  delete next[`${role}Material`]
  if (ref) next[`${role}MaterialPreset`] = ref
  else delete next[`${role}MaterialPreset`]
  return next as T
}

/**
 * A segment without a finish of its own for a role, so its roof's shows there. A catch-all finish
 * (`material`, `materialPreset`) goes too, written on the segment's other roles, which keep it.
 */
function withoutOwnRole(segment: RoofSegmentNode, role: ShellRole): RoofSegmentNode {
  const next = { ...segment } as Record<string, unknown>
  if (segment.material !== undefined || segment.materialPreset !== undefined) {
    for (const other of SHELL_ROLES) {
      if (other === role) continue
      const shown = getEffectiveSegmentSurfaceMaterial(segment, other)
      next[`${other}Material`] = shown.material
      next[`${other}MaterialPreset`] = shown.materialPreset
    }
    delete next.material
    delete next.materialPreset
  }
  delete next[`${role}Material`]
  delete next[`${role}MaterialPreset`]
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
  return next as RoofSegmentNode
}

/**
 * A wall face painted whole, as the editor's Paint paints each part of it: the face's own finish,
 * and the finish of each room it is turned to, which shows over the face's own. Painted parts
 * (regions) stay on top, as they do under a room's paint.
 */
function paintWallFace(
  nodes: SceneNodes,
  wall: WallNode,
  face: WallFace,
  ref: string | undefined,
): Record<string, AnyNode> {
  const plan = planWallPaint(nodes, wall, { kind: 'slot', slotId: face }, ref)
  const rooms = buildWallFinishLayout(wall, getWallLevelZones(wall, nodes)).spans[face]
  for (const zoneId of new Set(rooms.map((span) => span.zoneId))) {
    const scene = { ...nodes, ...plan }
    Object.assign(
      plan,
      planWallPaint(scene, scene[wall.id] as WallNode, { kind: 'room-face', zoneId, face }, ref),
    )
  }
  return plan
}

/**
 * The faces of a wall turned out of its rooms, or into them: by the rooms on its sides, else by
 * the sides it keeps (`frontSide` and `backSide`, as a generator or the room structure wrote
 * them). A partition, with a room on each face, is interior on both. A face rooms stand on only in
 * part (a wall running on past its rooms, into a garden) is both: it is refused, so the caller
 * names the face to paint whole.
 */
function wallFacesTurned(
  scene: SceneNodes,
  wall: WallNode,
  side: 'exterior' | 'interior',
): WallFace[] {
  const cover = roomFaceCover(scene as never, wall.id)
  const faces = ['a', 'b'] as const
  const part = faces.find((face) => cover[face] === 'part')
  if (part)
    refuse(
      'side_unknown',
      `Wall ${wall.id}'s face ${part} is in a room for part of its length and outside for the rest: name the face to paint whole, a or b.`,
      { target: wall.id },
    )
  if (cover.a === 'none' && cover.b === 'none')
    return faces.filter((face) => (face === 'a' ? wall.frontSide : wall.backSide) === side)
  return faces.filter((face) => (cover[face] === 'whole') === (side === 'interior'))
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
  const keptParts: string[] = []
  const throughRoof: string[] = []
  const modelRoles: string[] = []

  // A roof with glazed segments: its roles go on the roof for its standard segments, its glazing's
  // on each glazed segment; a role only one kind has paints that kind.
  const targets = [
    ...new Set(
      input.targets.flatMap((id) => {
        const node = nodes[id]
        if (node?.type !== 'roof') return [id]
        const segments = node.children
          .map((childId) => nodes[childId])
          .filter((child): child is RoofSegmentNode => child?.type === 'roof-segment')
        const glazed = segments.filter(isGlazedRoofSegment).map((segment) => segment.id)
        if (!glazed.length) return [id]
        const standard = glazed.length < segments.length
        const roles = [...(standard ? ROOF_ROLES : []), ...GLAZED_ROOF_SLOTS]
        if (input.role !== undefined && !roles.includes(input.role as never))
          refuse('unknown_role', `Roof ${id}'s roles are ${roles.join(', ')}.`, {
            target: id,
            roles,
          })
        const roofRole = input.role === undefined || ROOF_ROLES.includes(input.role as RoofRole)
        return [...(standard && roofRole ? [id] : []), ...(roofRole && input.role ? [] : glazed)]
      }),
    ),
  ]
  for (const id of targets) {
    const node = current(id)
    if (!node)
      refuse(
        'target_not_found',
        `Nothing to paint: ${id} is not in the scene (a room edit may have replaced its walls: read the scene again). Nothing was painted.`,
        { target: id },
      )

    if (node.type === 'roof' || (node.type === 'roof-segment' && !isGlazedRoofSegment(node))) {
      const role = (input.role ?? 'top') as RoofRole
      if (!ROOF_ROLES.includes(role))
        refuse('unknown_role', `A roof's roles are ${ROOF_ROLES.join(', ')}.`, {
          target: id,
          roles: [...ROOF_ROLES],
        })
      const roof = node.type === 'roof' ? node : current(node.parentId ?? '')
      if (roof?.type !== 'roof')
        refuse('not_paintable', `Roof segment ${id} has no roof to paint.`, { target: id })
      if (node.type === 'roof-segment') throughRoof.push(id)
      if (painted.some((entry) => entry.id === roof.id && entry.roles.includes(role))) continue
      const segments = roof.children.flatMap((childId) => {
        const segment = current(childId)
        return segment?.type === 'roof-segment' ? [segment] : []
      })
      if (role === 'fascia') {
        // Each segment holds its fascia: the boards take it on every segment of the roof.
        for (const segment of segments) written[segment.id] = paintRoleField(segment, role, ref)
      } else {
        written[roof.id] = paintRoleField(roof as RoofNode, role, ref)
        // The roof's finish shows on every segment: none keeps one of its own for the role.
        for (const segment of segments) written[segment.id] = withoutOwnRole(segment, role)
      }
      painted.push({ id: roof.id, roles: [role] })
      continue
    }

    // A catalog item's surfaces are its model's (slot_<id> materials), which an operation cannot
    // read: a host that has (assetViews) lets this name them; its role is written by name, as the
    // editor's Paint writes the one clicked.
    const declared = nodeSlotDeclarations(node)
    if (!declared && node.type === 'item') {
      const own = Object.keys((node as AnyNode & { slots?: Record<string, string> }).slots ?? {})
      if (!input.role) {
        const surfaces = context.assetViews?.[node.asset.id]?.surfaces ?? []
        const facts = [
          ...(surfaces.length ? [`its surfaces: ${surfaces.join(', ')}`] : []),
          ...(own.length ? [`painted so far: ${own.join(', ')}`] : []),
        ]
        refuse(
          'unknown_role',
          `Item ${id}'s surfaces are its model's: name one as role${facts.length ? ` (${facts.join('; ')})` : ''}.`,
          { target: id, roles: surfaces.length ? [...surfaces] : own },
        )
      }
      const slots = { ...((node as AnyNode & { slots?: Record<string, string> }).slots ?? {}) }
      if (ref) slots[input.role] = ref
      else delete slots[input.role]
      written[id] = { ...node, slots } as AnyNode
      modelRoles.push(`${id} ${input.role}`)
      painted.push({ id, roles: [input.role] })
      continue
    }
    if (!declared?.length)
      refuse(
        'not_paintable',
        `A ${node.type} has no surface paint gives: paint walls, slabs, ceilings, roofs, columns, fences, doors, windows, stairs, blocks, cabinets, shelves, items and the other built parts.`,
        { target: id, type: node.type },
      )
    const ids = declared.map((slot) => slot.slotId)
    let roles: string[]
    // On a wall, exterior and interior are its faces' sides; elsewhere they are slots by name.
    if (node.type === 'wall' && (input.role === 'exterior' || input.role === 'interior')) {
      // A curtain wall has frame, glass and panels where a wall has faces.
      if (!ids.includes('a'))
        refuse(
          'unknown_role',
          `A curtain wall has no ${input.role} face: its roles are ${ids.join(', ')}.`,
          { target: id, roles: ids },
        )
      roles = wallFacesTurned(scene(), node, input.role)
      if (!roles.length)
        refuse(
          'side_unknown',
          `Wall ${id} has no ${input.role} face by its rooms or its stored sides: name its face, a or b.`,
          { target: id },
        )
    } else if (node.type === 'wall' && WALL_TRIMS.includes(input.role as WallTrimKind)) {
      // A trim named without a face is the trim on both faces, as a wall without a role is.
      roles = (['a', 'b'] as const).map((face) =>
        getWallTrimSlotId(face, input.role as WallTrimKind),
      )
      if (!roles.every((role) => ids.includes(role)))
        refuse('unknown_role', `A ${node.type}'s roles are ${ids.join(', ')}.`, {
          target: id,
          roles: ids,
        })
    } else if (input.role) {
      if (!ids.includes(input.role))
        refuse('unknown_role', `A ${node.type}'s roles are ${ids.join(', ')}.`, {
          target: id,
          roles: ids,
        })
      roles = [input.role]
    } else roles = defaultRoles(node.type, ids)
    if (!roles.length)
      refuse('unknown_role', `Name the ${node.type}'s surface: its roles are ${ids.join(', ')}.`, {
        target: id,
        roles: ids,
      })

    for (const role of roles) {
      const target = current(id)!
      if (target.type === 'wall') {
        const face = role === 'a' || role === 'b' ? role : null
        const scripted = face ? wallFaceScriptPaintRefusal(target, face) : undefined
        if (scripted)
          refuse('face_built_by_script', `${scripted.message} Nothing was painted.`, {
            target: id,
            face,
          })
        Object.assign(
          written,
          face
            ? paintWallFace(scene(), target, face, ref)
            : planWallPaint(scene(), target, { kind: 'slot', slotId: role }, ref),
        )
        const parts =
          face && ref ? target.faceRegions?.filter((region) => region.face === face) : []
        if (parts?.length)
          keptParts.push(`${id} ${face}: ${parts.map((region) => region.id).join(', ')}`)
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
  const note = [
    finish.note,
    throughRoof.length &&
      `${throughRoof.join(', ')} ${throughRoof.length === 1 ? 'is a roof segment' : 'are roof segments'}: the finish went on the roof, which shows one finish per surface.`,
    keptParts.length && `Painted parts keep their own finish (${keptParts.join('; ')}).`,
    modelRoles.length &&
      `${modelRoles.join(', ')}: an item's surfaces are its model's, so a role its model lacks does not show.`,
  ]
    .filter(Boolean)
    .join(' ')
  return {
    result: {
      ok: true,
      painted,
      finish: ref ?? 'default',
      ...(finish.sceneMaterial
        ? { materialId: finish.sceneMaterial.id, material: finish.sceneMaterial.material }
        : {}),
      ...(createdMaterial ? { createdMaterial } : {}),
      ...(note ? { note } : {}),
    },
    changes: { update, ...(createdMaterial ? { materials: [createdMaterial] } : {}) },
  }
}
