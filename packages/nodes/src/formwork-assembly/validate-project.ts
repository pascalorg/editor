import type {
  FormworkSystem,
  PressureEnvelope,
  StripPack,
  ValidationReport,
} from '@pascal-app/core/formwork'
import { validateFormwork } from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import type { ProjectFormworkScope } from './solve-project'
import { solveProjectFormwork } from './solve-project'

/**
 * The scene, validated — with the evidence the shutters were actually built from.
 *
 * `validateFormwork` can run on nodes alone, and three of its fourteen invariants
 * come back `notChecked` when it does: an unformable strip is a property of the
 * packed run, a code-envelope breach a property of the pressure solve, and a tie
 * that reaches nothing a property of the catalog system. None of those survive into
 * the node graph, so a validator handed only nodes cannot see them.
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
 * so. That is the honest answer rather than a degraded one: those three invariants
 * are about a layout, and an element nobody has formed has no layout to fault.
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

  const packs = new Map<AnyNodeId, readonly StripPack[]>()
  const envelopes = new Map<AnyNodeId, PressureEnvelope>()
  const systems = new Map<AnyNodeId, FormworkSystem>()
  for (const element of solution.elements) {
    const id = element.host.id as AnyNodeId
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
  }

  return {
    report: validateFormwork(Object.values(nodes), {
      parentId: scope.parentId as AnyNodeId | undefined,
      elementIds: scope.hostIds as readonly AnyNodeId[] | undefined,
      packs,
      envelopes,
      systems,
    }),
    shutteredIds: solution.elements.map((element) => element.host.id as AnyNodeId),
  }
}
