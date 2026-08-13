import {
  applyPartOverrides,
  type FaceGangs,
  type FormworkPart,
  type FormworkPartSpec,
  type FormworkSystem,
  type PressureEnvelope,
  partMark,
  type ShutterElevation,
  type StripPack,
  type TieField,
} from '@pascal-app/core/formwork'
import type { Group, Mesh } from 'three'
import type { FormworkAssemblyNode } from './schema'

/**
 * How a builder emits a part and its mesh together.
 *
 * The single enumeration is the whole point. A parts table written beside the
 * builders — walking the same catalog and repeating the same placement loops — is a
 * second enumeration, and two enumerations of the same shutter disagree the first
 * time one of them is edited: the BOM orders five panels for a run the model draws
 * six on, and neither side is obviously wrong. `design.ts` exists for exactly this
 * reason on the structural side ("Solving it twice — once per surface, off two
 * argument lists — is how a drawing and a panel come to disagree about the tie
 * spacing of the same wall"), and the parts list is the same hazard one layer down.
 *
 * So a builder does not return geometry and then get counted. It calls `emit` once
 * per part, with the spec and the mesh that draws it, and the collector produces
 * both: the group goes on screen and the marked list goes to the table, the BOM and
 * the inspector. A part with no mesh — a consumable, a hire item — passes none; a
 * mesh with no part goes through `add`, which is for the members that genuinely are
 * not shutter parts.
 *
 * Marks land on `mesh.userData.formworkPartMark` rather than in `mesh.name`. The
 * names are the existing part taxonomy — `panel-front-c0-2`, `tie-7`,
 * `corner-inside-a-start-owned-0-front` — and they are what a reader of the scene
 * graph already recognises. A mark is an additional identity, not a rename.
 */

export interface PartCollector {
  /** Adds a part, and the mesh that draws it where it has one. Returns the mark. */
  emit: (spec: FormworkPartSpec, mesh?: Mesh) => string
  /**
   * Records what the shutter was designed *from*, for the validator.
   *
   * Three of the invariants cannot run on a parts list: an unformable strip is a
   * property of the pack, a code-envelope breach is a property of the pressure
   * solve, and neither survives into the marks. They are carried out of the build
   * for the same reason the parts are — a validator that re-packed the runs itself
   * would be a second layout, and the first thing a second layout does is disagree
   * with the one on screen about which run has the open strip.
   */
  evidence: (found: Partial<ShutterEvidence>) => void
  /**
   * Adds another mesh drawing a part already emitted. One part is not always one
   * box: a panel crossed by a window is drawn as a band under the sill and a band
   * over the head, and it is still one panel off the rack. Both bands carry the one
   * mark, so clicking either selects the panel and the BOM counts it once.
   */
  tag: (mark: string, mesh: Mesh) => void
  /** Adds a mesh that is not a shutter part — a scaffold tube, an access platform. */
  add: (mesh: Mesh) => void
  /**
   * Records the face as a shop drawing, for the builders that have one.
   *
   * Off the same loops that place the meshes and emit the parts, for the reason the parts
   * themselves are: an elevation drawn from the layout a second time is a second layout, and
   * the first thing a second layout does is put a tie in a panel the model draws whole.
   * Nothing here is a new figure — every rectangle is a piece already emitted, in the pour's
   * own frame rather than the element's.
   */
  draw: (drawing: ShutterElevation) => void
  /** The group and the marked parts, overrides applied. */
  finish: () => BuiltFormwork
}

/**
 * What the shutter was designed from, as far as the validator needs it.
 *
 * Not the design — the report already prints that, off `design.ts`. This is the
 * subset an invariant asserts against and which the parts list does not preserve:
 * the packed runs behind the panel marks, and the pressure envelope behind the
 * member sizes.
 */
export interface ShutterEvidence {
  /** Every face run packed for this pour, in the order the faces were laid out. */
  packs: StripPack[]
  /**
   * What gets craned as one piece, per face run — for the gang × crane check.
   *
   * Carried rather than derived for the reason the packs are, in its sharpest form: a
   * gang boundary is a joint that every course shares, so a validator that grouped a
   * face itself would be grouping a second layout, and the pick it reported would put
   * the hook over a panel the model draws whole. Empty on a conventional shutter, which
   * is struck panel by panel and has no assembly to lift.
   */
  gangs?: FaceGangs[]
  /** The envelope the members were sized on, where the kind has one. */
  envelope?: PressureEnvelope
  /**
   * The catalog system the panels and ties came from, where one answered.
   *
   * Recorded per shutter and not read from the settings, because `systemId` is a
   * field on the assembly: one wall on a job can be formed in Framax and the next
   * in TRIO, and a tie-reach check run against the wrong one of those is a check
   * against hardware that is not on the wall.
   */
  system?: FormworkSystem
  /**
   * Where a tie could pass, over each stretch the panels form — for the ties ×
   * openings clash.
   *
   * Recorded *before* the openings take stations away, because the loss is what the
   * check is about: the builder drops a tie landing in a void, correctly, and the
   * band of concrete that leaves untied is reported by nothing the parts list
   * carries. The emitted ties cannot answer it — a tie never drawn has no part —
   * and the hole grid can.
   *
   * One entry per panelled stretch, so a corner unit's blocked stretch is not in
   * any of them: the unit ties through its own holes on the catalog's spacing, and
   * a band under it is not short of a tie the panels would have brought.
   */
  tieFields?: TieField[]
}

export interface BuiltFormwork {
  group: Group
  /** Every part of this shutter, marked, with the assembly's overrides applied. */
  parts: FormworkPart[]
  evidence: ShutterEvidence
  /**
   * The shutter as a shop elevation, where the kind has one.
   *
   * Walls only, and that is the shape of the thing rather than a gap: a slab is decked to a
   * plan and a column clamped to a schedule, and neither is an elevation of a face. Absent
   * on a wall too where nothing was formed — a drawing of no panels reads as a wall that
   * needs none.
   */
  elevation?: ShutterElevation
}

/**
 * A collector writing into `group`.
 *
 * Overrides are applied at the end rather than per part, because an override can
 * change a part's provenance and the parts list is what carries that — see
 * `applyPartOverrides`. An omitted part keeps its mesh: the geometry is what the crew
 * is looking at, and a panel that vanishes from the model when somebody ticks "omit"
 * in a table reads as a bug rather than as their own edit. The list carries the flag
 * and the table shows it struck out.
 */
export function collectParts(group: Group, node: FormworkAssemblyNode): PartCollector {
  const parts: FormworkPart[] = []
  const found: ShutterEvidence = { packs: [] }
  let drawing: ShutterElevation | undefined
  return {
    draw(elevation) {
      drawing = elevation
    },
    evidence(more) {
      if (more.packs) found.packs.push(...more.packs)
      if (more.gangs) found.gangs = [...(found.gangs ?? []), ...more.gangs]
      if (more.envelope) found.envelope = more.envelope
      if (more.system) found.system = more.system
      if (more.tieFields) found.tieFields = [...(found.tieFields ?? []), ...more.tieFields]
    },
    emit(spec, mesh) {
      const mark = partMark(spec)
      parts.push({ ...spec, mark })
      if (mesh) {
        mesh.userData.formworkPartMark = mark
        group.add(mesh)
      }
      return mark
    },
    tag(mark, mesh) {
      mesh.userData.formworkPartMark = mark
      group.add(mesh)
    },
    add(mesh) {
      group.add(mesh)
    },
    finish() {
      return {
        group,
        parts: applyPartOverrides(parts, node.partOverrides),
        evidence: found,
        ...(drawing ? { elevation: drawing } : {}),
      }
    },
  }
}
