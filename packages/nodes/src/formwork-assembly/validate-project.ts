import type {
  FaceGangs,
  FormworkSystem,
  PressureEnvelope,
  RiseRateLimit,
  StripPack,
  TieField,
  ValidationReport,
} from '@pascal-app/core/formwork'
import {
  formworkSettingsFor,
  pourLimitsFromSettings,
  validateFormwork,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import type { ProjectFormworkScope } from './solve-project'
import { solveProjectFormwork } from './solve-project'

/**
 * The scene, validated — with the evidence the shutters were actually built from.
 *
 * `validateFormwork` can run on nodes alone, and nine of its twenty-two invariants
 * come back `notChecked` when it does: an unformable strip is a property of the packed
 * run, a code-envelope breach a property of the pressure solve, a tie that reaches
 * nothing a property of the catalog system, and a band beside an opening with no tie
 * in it — like a waterstop with a drilled tie hole in it — a property of where the
 * frames were drilled. Two more are properties of a *gang*, which is a grouping of the
 * layout the geometry produced: what one pick weighs, and how much height its slings
 * want. Another is a property of the panels the layout chose: what they are rated for, and
 * so how fast the pour may rise before it is over that. The last is not a property of a
 * layout at all: a set-count shortage is a peak
 * against the yard's rack, which needs the programme and the bill together. None of
 * them survive into the node graph, so a validator handed only nodes cannot see them.
 *
 * It could re-derive them. That is the option this module exists to avoid. Packing
 * the runs a second time inside the validator would produce a second layout of every
 * face, and two layouts of one wall disagree about which run has the open strip the
 * first time either of them changes — the same hazard `parts.ts` was written against
 * one layer down, and `solve.ts` one layer up. So the shutters are solved once,
 * through the same `solveShuttersForHost` the panels and the chat tools read, and the
 * pack and the envelope come *out* of that build as `ShutterEvidence`.
 *
 * Which means a scope with no shutters yet is validated on its nodes alone and says
 * so. That is the honest answer rather than a degraded one: most of them are about a
 * layout, and an element nobody has formed has no layout to fault. Two are exceptions
 * of two different kinds. The shortage's silence has three unrelated causes — no pour
 * dated, no rack recorded, or a programme too partial to sweep — so it names the
 * inputs rather than a cause it cannot distinguish. The crane's has two that *can* be
 * told apart, and both reach the report separately: a scope nobody has formed has no
 * gang to weigh, and a project with no load chart has nothing to weigh one against.
 */

export interface ProjectValidation {
  report: ValidationReport
  /** Elements in scope carrying a shutter — the ones whose layout was examined. */
  shutteredIds: AnyNodeId[]
}

/**
 * Validate a level, a selection, or the whole scene.
 *
 * The scope narrows the *findings* while the topology still reads the whole scene,
 * which is `validateFormwork`'s own contract: an element outside a level still buries
 * the face of one inside it, and a junction check that saw only the level would report
 * a free end where the storey below stands.
 */
export function validateProjectFormwork(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope = {},
): ProjectValidation {
  const solution = solveProjectFormwork(nodes, scope)
  const settings = formworkSettingsFor(Object.values(nodes))

  const packs = new Map<AnyNodeId, readonly StripPack[]>()
  const envelopes = new Map<AnyNodeId, PressureEnvelope>()
  const systems = new Map<AnyNodeId, FormworkSystem>()
  const tieFields = new Map<AnyNodeId, readonly TieField[]>()
  const gangs = new Map<AnyNodeId, readonly FaceGangs[]>()
  const riseRates = new Map<AnyNodeId, RiseRateLimit>()
  // A shortage names a catalog id and the pours that overlap on it, and a pour id is an
  // assembly id — which the validator never sees, because it reads castable elements. This
  // is the only layer that holds both, the same reason `bomHire`'s `targetsByMark` is built
  // here rather than in core.
  const elementIdByPourId = new Map<string, AnyNodeId>()
  for (const element of solution.elements) {
    const id = element.host.id as AnyNodeId
    for (const shutter of element.shutters) {
      elementIdByPourId.set(shutter.assembly.id as string, id)
    }
    // Every shutter on the element, not one of them. A 9 m wall in three lifts is
    // three packs, and the open strip may be in any of them — taking only the first
    // would check the base lift and report a pass for the two above it.
    const runs = element.shutters.flatMap((shutter) => shutter.evidence.packs)
    if (runs.length > 0) packs.set(id, runs)
    // The base lift's envelope is the element's worst: pressure grows with the head
    // above the point, and the base lift carries the deepest concrete. A lift higher
    // up cannot be outside a code envelope the base one is inside.
    const envelope = element.shutters.find((shutter) => shutter.evidence.envelope)?.evidence
      .envelope
    if (envelope) envelopes.set(id, envelope)
    // The element's own system, from its own shutters — `systemId` is a field on the
    // assembly, so this is the catalog the hardware on that wall actually comes from
    // rather than whatever the project defaults to.
    const system = element.shutters.find((shutter) => shutter.evidence.system)?.evidence.system
    if (system) systems.set(id, system)
    // Every shutter's fields, and all of them: each one covers only the stretch it
    // forms, so a lift or a segment left out is a stretch reported as unexamined
    // where it was examined, and one merged across shutters is a band called tied by
    // a hole in a different pour. The check reads them as the separate stretches
    // they are, so concatenating is not merging.
    const fields = element.shutters.flatMap((shutter) => shutter.evidence.tieFields ?? [])
    if (fields.length > 0) tieFields.set(id, fields)
    // Every shutter's gangs, like the packs and unlike the envelope: a 9 m wall in three
    // lifts is three sets of picks and the heavy one may be in any of them. Not deduped
    // across lifts either — two lifts of identical panels are two separate assemblies,
    // each lifted in on its own day, and merging them would report one pick where the
    // crane makes two.
    const faces = element.shutters.flatMap((shutter) => shutter.evidence.gangs ?? [])
    if (faces.length > 0) gangs.set(id, faces)
    // The base lift's, like the envelope and for the same reason: pressure grows with the
    // head above the point, so the lift with the deepest concrete overloads a panel first,
    // and a lift above it cannot be over a rating the base one is under.
    const riseRate = element.shutters.find((shutter) => shutter.evidence.riseRate)?.evidence
      .riseRate
    if (riseRate) riseRates.set(id, riseRate)
  }

  return {
    report: validateFormwork(Object.values(nodes), {
      parentId: scope.parentId as AnyNodeId | undefined,
      elementIds: scope.hostIds as readonly AnyNodeId[] | undefined,
      packs,
      envelopes,
      systems,
      tieFields,
      gangs,
      riseRates,
      // The project's permitted joints, so the off-permitted-elevation check reads the
      // same data the split snapped to — the wire that made a dormant check real.
      limits: pourLimitsFromSettings(settings),
      // The scene's crane, read here and not per element: a load chart is a fact about the
      // site, and the same machine lifts every gang on it. Absent where nobody recorded one,
      // which the report says rather than checking every pick against a machine on hire
      // somewhere else.
      ...(settings.crane === undefined ? {} : { crane: settings.crane }),
      // The solve's own acquisition, not a second one. Absent for three unrelated reasons —
      // no pour dated, no rack recorded, or a programme too partial to sweep — and the check
      // reports itself unavailable for all three rather than reading a scene as stocked.
      ...(solution.acquisition === undefined ? {} : { acquisition: solution.acquisition }),
      elementIdByPourId,
    }),
    shutteredIds: solution.elements.map((element) => element.host.id as AnyNodeId),
  }
}
