import type { FormworkPart } from '@pascal-app/core/formwork'
import type { GeometryContext } from '@pascal-app/core/registry'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import type { CastableHostNode } from './attach'
import { formworkAssembliesOnHost } from './dirty-scope'
import { buildFormwork } from './geometry'
import type { FormworkAssemblyNode } from './schema'

/**
 * One shutter, solved: the assembly and the parts it is made of.
 */
export interface SolvedShutter {
  assembly: FormworkAssemblyNode
  parts: FormworkPart[]
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
    if (built) shutters.push({ assembly, parts: built.parts })
  }
  return shutters.sort(
    (a, b) =>
      a.assembly.segmentIndex - b.assembly.segmentIndex ||
      a.assembly.liftIndex - b.assembly.liftIndex,
  )
}
