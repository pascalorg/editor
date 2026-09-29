import { z } from 'zod'
import { SourceRefString } from './source-ref'

/**
 * Assembly layers (F2). Wall and roof kinds that declare `capabilities.assembly`
 * store one optional `assembly` field. Saved WS5 wall assemblies migrate to this
 * shape, and wall readers and renderers consume it. Nodes without an assembly
 * keep their existing geometry.
 *
 * The stack sets the body (the WS5 rule): a host's thickness is the sum of its
 * body layers, and a writer that edits the layers writes that sum to the host's
 * thickness field in the same patch. Body layers run from the host's reference
 * face inward (walls: the front face, +n, or the exterior face with
 * `face: 'exterior'`; roofs: the covering-top plane). Thickness is measured
 * along the host's `measure` axis.
 *
 * Thickness, preset ids and cavity notes keep WS5's unbounded valid values
 * so migration never rejects or truncates a saved wall.
 */

export const LayerRole = z.enum([
  'finish',
  'lining',
  'substrate',
  'sheathing',
  'membrane',
  'underlay',
  'insulation',
  'air',
  'furring',
  'structure',
  'deck',
  'covering',
  'fill',
  'shell',
  'glazing',
])
export type LayerRole = z.infer<typeof LayerRole>

/**
 * Unique within its host (layers and backing together) and stable across
 * edits: parts, claddings, quantities and the `#layer:<id>` address refer to
 * it. The character set keeps the address grammar unambiguous.
 */
export const AssemblyLayerId = z.string().regex(/^[A-Za-z0-9._-]{1,40}$/)

export const AssemblyLayer = z.object({
  id: AssemblyLayerId,
  role: LayerRole,
  /** Metres along the host's measure axis. */
  thickness: z.number().finite().nonnegative(),
  /** Body only, at most one: the structural layer (framing, block), the one generators frame. */
  core: z.literal(true).optional(),
  /**
   * What the layer is built of, as a construction-material kind
   * (`stucco`, `siding`, `osb`, `wood`, `cmu`, `drywall`, …). A label for
   * schedules and the inspector; the look comes from `slot`.
   */
  material: z.string().min(1).max(40).optional(),
  /** Key into `host.slots`; absent = `layer:<id>`, then the role default. */
  slot: z.string().min(1).max(40).optional(),
  /** Walls: the finish wraps free ends and reveals. */
  returns: z.boolean().optional(),
  display: z.enum(['finished', 'construction']).optional(),
  /** Backing only. */
  inset: z.number().min(-1).max(5).optional(),
  /** Backing only: fill down to a level-local datum. */
  bottom: z.number().finite().optional(),
  /** Backing only: display courses. */
  lift: z.number().positive().max(2).optional(),
  /**
   * Provenance of this layer: one source reference, `<ns>:<id>[::<sub>]`
   * (`SourceRefString`). Content, never a node id; preset capture strips it.
   */
  src: SourceRefString.optional(),
})
export type AssemblyLayer = z.infer<typeof AssemblyLayer>

const BACKING_ONLY = ['inset', 'bottom', 'lift'] as const
/** Roles a `core` layer may take: framing or block, a deck, a basin shell. */
const STRUCTURAL_ROLES = new Set<LayerRole>(['structure', 'deck', 'shell'])

export const Assembly = z
  .object({
    /** Body layers, from the reference face inward. Empty only when `backing` carries the stack. */
    layers: z.array(AssemblyLayer).max(12),
    /** Layers behind the body, from its far face outward (slab fill, ceiling insulation). */
    backing: z.array(AssemblyLayer).max(8).optional(),
    /**
     * Which face `layers` start from: `front` (+n, the default) or `exterior`,
     * resolved from the host's `frontSide` / `backSide` with the front as the
     * fallback, so the stack follows the outside when rooms are re-detected.
     */
    face: z.enum(['front', 'exterior']).optional(),
    presetId: z.string().optional(),
    /** A note on cavity insulation (`R-21 batt`); no geometry. */
    cavityInsulation: z.string().optional(),
  })
  .superRefine((assembly, ctx) => {
    if (assembly.layers.length === 0 && !assembly.backing?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'An assembly needs at least one body or backing layer',
        path: ['layers'],
      })
    }
    const seen = new Set<string>()
    const lists = [
      ['layers', assembly.layers],
      ['backing', assembly.backing ?? []],
    ] as const
    for (const [list, layers] of lists) {
      layers.forEach((layer, index) => {
        if (seen.has(layer.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate layer id "${layer.id}"`,
            path: [list, index, 'id'],
          })
        }
        seen.add(layer.id)
      })
    }

    assembly.layers.forEach((layer, index) => {
      if (layer.core && !STRUCTURAL_ROLES.has(layer.role)) {
        ctx.addIssue({
          code: 'custom',
          message: `The core is the structural layer: role ${[...STRUCTURAL_ROLES].join(', ')}`,
          path: ['layers', index, 'core'],
        })
      }
    })
    const cores = assembly.layers.flatMap((layer, index) => (layer.core ? [index] : []))
    for (const index of cores.slice(1)) {
      ctx.addIssue({
        code: 'custom',
        message: 'At most one body layer is the core',
        path: ['layers', index, 'core'],
      })
    }
    assembly.layers.forEach((layer, index) => {
      for (const field of BACKING_ONLY) {
        if (layer[field] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `"${field}" applies to backing layers only`,
            path: ['layers', index, field],
          })
        }
      }
    })
    assembly.backing?.forEach((layer, index) => {
      if (layer.core) {
        ctx.addIssue({
          code: 'custom',
          message: 'A backing layer is never the core',
          path: ['backing', index, 'core'],
        })
      }
    })
  })
export type Assembly = z.infer<typeof Assembly>

/** 1 µm, the planar kernel's snap. */
export const ASSEMBLY_TOLERANCE = 1e-6
