import type { AssemblyHostConfig } from '../registry/types'
import { ASSEMBLY_TOLERANCE, type Assembly, type LayerRole } from '../schema/assembly'
import { getWallThickness } from '../systems/wall/wall-footprint'

/** Walls: layers stack from the front (or exterior) face; `thickness` holds their sum. */
export const wallAssemblyHost: AssemblyHostConfig = {
  reference: 'front',
  measure: 'normal',
  body: (node) => (node.type === 'wall' ? getWallThickness(node) : null),
}

/** Roofs: one contiguous stack inward from the covering-top plane; nothing stores the sum. */
export const roofAssemblyHost: AssemblyHostConfig = {
  reference: 'covering',
  measure: 'normal',
  body: () => null,
}

export type AssemblyDiagnosticCode =
  /**
   * The host's stored thickness is not the sum of its layers (a stale or
   * hand-edited value). The stack wins; hosts that draw from the stored
   * thickness keep their plain body until a writer re-derives it.
   */
  | 'assembly.thickness-mismatch'
  /** Nothing to stack: the layers sum to 0. */
  | 'assembly.empty'
  /** `backing` on a host that refuses it: ignored. */
  | 'assembly.backing-refused'

export type AssemblyDiagnostic = { code: AssemblyDiagnosticCode; message: string }

export type ResolvedAssemblyLayer = {
  id: string
  role: LayerRole
  /** Depth of the layer's reference-side face below the stack's first face, metres. */
  depth: number
  thickness: number
  core: boolean
  material?: string
  slot?: string
  src?: string
}

export type ResolvedAssembly = {
  layers: ResolvedAssemblyLayer[]
  /** Σ layer thickness: the host's body, which a wall stores as `thickness`. */
  total: number
  diagnostics: AssemblyDiagnostic[]
}

/**
 * Resolves the body stack of `assembly`, in the order it lists its layers.
 * The stack sets the body, so `total` is the thickness the host must store;
 * `host.body` is the value it stores today (`null` when it stores none, as a
 * roof) and only produces a diagnostic when it disagrees. Pure and total: it
 * never throws and never changes a declared thickness.
 */
export function resolveAssemblyStack(
  assembly: Assembly,
  host: { body: number | null; backing?: boolean },
): ResolvedAssembly {
  const diagnostics: AssemblyDiagnostic[] = []
  if (assembly.backing?.length && !host.backing) {
    diagnostics.push({
      code: 'assembly.backing-refused',
      message: 'This host has no backing; its backing layers are ignored.',
    })
  }

  let depth = 0
  const layers = assembly.layers.map((layer): ResolvedAssemblyLayer => {
    const resolved: ResolvedAssemblyLayer = {
      id: layer.id,
      role: layer.role,
      depth,
      thickness: layer.thickness,
      core: layer.core === true,
      ...(layer.material === undefined ? {} : { material: layer.material }),
      ...(layer.slot === undefined ? {} : { slot: layer.slot }),
      ...(layer.src === undefined ? {} : { src: layer.src }),
    }
    depth += layer.thickness
    return resolved
  })

  if (!(depth > 0)) {
    diagnostics.push({ code: 'assembly.empty', message: 'The layers sum to 0.' })
    return { layers: [], total: 0, diagnostics }
  }
  if (host.body !== null && Math.abs(host.body - depth) > ASSEMBLY_TOLERANCE) {
    diagnostics.push({
      code: 'assembly.thickness-mismatch',
      message: `The layers sum to ${depth} m but the host stores ${host.body} m.`,
    })
  }
  return { layers, total: depth, diagnostics }
}
