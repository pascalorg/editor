import { ASSEMBLY_TOLERANCE, type Assembly, type LayerRole } from '../schema/assembly'

export type AssemblyDiagnosticCode =
  /**
   * The host's stored thickness is not the sum of its layers (a stale or
   * hand-edited value). The stack wins; hosts that draw from the stored
   * thickness keep their plain body until a writer re-derives it.
   */
  | 'assembly.thickness-mismatch'
  /** Nothing to stack: body and backing both sum to 0. */
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
  /** Backing only: as declared (`inset`, `bottom`, `lift`). */
  inset?: number
  bottom?: number
  lift?: number
}

export type ResolvedAssembly = {
  layers: ResolvedAssemblyLayer[]
  /** Σ layer thickness: the host's body, which a wall stores as `thickness`. */
  total: number
  /**
   * Backing layers on a host that accepts them, `depth` measured from the
   * body's far face outward; empty otherwise.
   */
  backing: ResolvedAssemblyLayer[]
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

  const layers = stackLayers(assembly.layers)
  const total = layers.reduce((sum, layer) => sum + layer.thickness, 0)
  const backing = host.backing ? stackLayers(assembly.backing ?? []) : []
  const backingTotal = backing.reduce((sum, layer) => sum + layer.thickness, 0)

  if (!(total > 0) && !(backingTotal > 0)) {
    diagnostics.push({ code: 'assembly.empty', message: 'The layers sum to 0.' })
    return { layers: [], total: 0, backing: [], diagnostics }
  }
  if (host.body !== null && Math.abs(host.body - total) > ASSEMBLY_TOLERANCE) {
    diagnostics.push({
      code: 'assembly.thickness-mismatch',
      message: `The layers sum to ${total} m but the host stores ${host.body} m.`,
    })
  }
  return { layers, total, backing, diagnostics }
}

function stackLayers(layers: readonly Assembly['layers'][number][]): ResolvedAssemblyLayer[] {
  let depth = 0
  return layers.map((layer): ResolvedAssemblyLayer => {
    const resolved: ResolvedAssemblyLayer = {
      id: layer.id,
      role: layer.role,
      depth,
      thickness: layer.thickness,
      core: layer.core === true,
      ...(layer.material === undefined ? {} : { material: layer.material }),
      ...(layer.slot === undefined ? {} : { slot: layer.slot }),
      ...(layer.src === undefined ? {} : { src: layer.src }),
      ...(layer.inset === undefined ? {} : { inset: layer.inset }),
      ...(layer.bottom === undefined ? {} : { bottom: layer.bottom }),
      ...(layer.lift === undefined ? {} : { lift: layer.lift }),
    }
    depth += layer.thickness
    return resolved
  })
}
