import type { FormworkPart, ShutterElevation } from '@pascal-app/core/formwork'
import type { GeometryContext } from '@pascal-app/core/registry'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import type { CastableHostNode } from './attach'
import { formworkAssembliesOnHost } from './dirty-scope'
import { buildFormwork } from './geometry'
import type { ShutterEvidence } from './parts'
import type { FormworkAssemblyNode } from './schema'

/**
 * One shutter, solved: the assembly, the parts it is made of, and what it was
 * designed from.
 */
export interface SolvedShutter {
  assembly: FormworkAssemblyNode
  parts: FormworkPart[]
  /**
   * The pack and the envelope behind the parts, for the validator.
   *
   * Carried rather than re-derived for the same reason the parts are: a validator
   * that packed the runs itself would be a second layout, and two layouts of one
   * face disagree about which run has the open strip the first time either changes.
   */
  evidence: ShutterEvidence
  /**
   * The shop elevation, on the kinds that have one — walls.
   *
   * Carried out of the build rather than derived from the parts, which could not be done at
   * all: a part carries its own position and not its extent, so a panel's rectangle is not
   * in the list, and a tie station the wall could not use has no part to be absent from.
   */
  elevation?: ShutterElevation
}

/**
 * The pour this shutter covers, in one wording.
 *
 * Here rather than beside the parts table because four surfaces name the same pour — the table,
 * the elevation's face selector, the title on the issued drawing and the AI's reply — and a
 * pour called "Pour 2, lift 1" on the screen and "segment 1 lift 0" in the reply is two pours
 * as far as the reader is concerned. Also here rather than in a panel file because the server
 * needs it: a route handler is a Server Component and a `'use client'` module in its import
 * graph is a build failure.
 */
export function shutterLabel(assembly: FormworkAssemblyNode): string {
  return `Pour ${assembly.segmentIndex + 1}, lift ${assembly.liftIndex + 1}`
}

/**
 * Every shutter on one host, solved from the scene.
 *
 * Pure and here rather than in the panel because three callers need the same answer:
 * the parts table, the part inspector, and the chat tool that reads a bill on the
 * server against a plain `SceneGraph`. A second implementation for the server is how
 * the AI comes to quote a panel count the user's own screen does not show.
 *
 * The `GeometryContext` is synthesised rather than taken from the geometry system,
 * which only builds one while it is rendering. The builders read `ctx.parent` for the
 * host and `ctx.resolve` to reach the level, the host's siblings and their openings,
 * so a resolver over the whole node map satisfies all of it.
 *
 * The geometry the solve also produces is dropped. Its meshes are never added to a
 * scene, so nothing reaches the GPU and nothing needs disposing — and building it is
 * exactly what guarantees the bill and the shutter on screen came out of one pass.
 */
export function solveShuttersForHost(
  host: CastableHostNode,
  nodes: Record<string, AnyNode>,
): SolvedShutter[] {
  const ctx = {
    parent: host as AnyNode,
    resolve: (id: AnyNodeId) => nodes[id],
  } as unknown as GeometryContext

  const shutters: SolvedShutter[] = []
  for (const assemblyId of formworkAssembliesOnHost(host.id as string, nodes)) {
    const assembly = nodes[assemblyId] as unknown as FormworkAssemblyNode | undefined
    if (!assembly) continue
    const built = buildFormwork(assembly, ctx)
    if (built) {
      shutters.push({
        assembly,
        parts: built.parts,
        evidence: built.evidence,
        ...(built.elevation ? { elevation: built.elevation } : {}),
      })
    }
  }
  return shutters.sort(
    (a, b) =>
      a.assembly.segmentIndex - b.assembly.segmentIndex ||
      a.assembly.liftIndex - b.assembly.liftIndex,
  )
}
