import { z } from 'zod'

/** A script source is persisted inline; this caps one node's share of a scene operation. */
export const GEOMETRY_SCRIPT_MAX_BYTES = 48 * 1024

const finite = z.number().finite()
const vec3 = z.tuple([finite, finite, finite])

export const GeometryScriptParamValue = z.union([finite, z.boolean(), z.string()])
export type GeometryScriptParamValue = z.infer<typeof GeometryScriptParamValue>

/** A control the script declares in `export const params`. */
export const GeometryScriptParamSpec = z.object({
  id: z.string(),
  label: z.string().optional(),
  kind: z.enum(['number', 'boolean', 'string']),
  default: GeometryScriptParamValue,
  min: finite.optional(),
  max: finite.optional(),
  step: finite.optional(),
  unit: z.string().optional(),
  options: z.array(z.string()).optional(),
})
export type GeometryScriptParamSpec = z.infer<typeof GeometryScriptParamSpec>

/**
 * What the compiler read from the script's output, by naming convention:
 * `part:<id>` objects, `slot_<id>` materials, `anchor:<id>` empties, lights
 * (`light:<id>` empties or three.js lights), a `cutout` mesh and a `collider`
 * mesh. Positions are in the artifact's frame (bottom-centre origin).
 */
export const GeometryArtifactManifest = z.object({
  bounds: z.object({ min: vec3, max: vec3 }),
  params: z.array(GeometryScriptParamSpec).default([]),
  parts: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().optional(),
        /** What the part is, for queries ("column", "beam", "slab"); from `userData.type`. */
        type: z.string().optional(),
        bounds: z.object({ min: vec3, max: vec3 }).optional(),
      }),
    )
    .default([]),
  /** Upward-facing flat areas things can rest on, e.g. a porch landing: height and XZ outline. */
  surfaces: z
    .array(
      z.object({
        part: z.string().optional(),
        y: finite,
        polygon: z.array(z.tuple([finite, finite])),
      }),
    )
    .default([]),
  slots: z.array(z.object({ id: z.string(), label: z.string().optional() })).default([]),
  anchors: z
    .array(z.object({ id: z.string(), position: vec3, normal: vec3.optional() }))
    .default([]),
  lights: z
    .array(
      z.object({
        id: z.string(),
        position: vec3,
        color: z.string(),
        intensity: finite,
        distance: finite.optional(),
      }),
    )
    .default([]),
  /** The module's AnimationClips; `open`, `close` and `loop` drive the object's controls. */
  animations: z.array(z.object({ name: z.string(), duration: finite })).default([]),
  cutout: z.boolean().default(false),
  collider: z.boolean().default(false),
  triangles: z.number().int().nonnegative(),
})
export type GeometryArtifactManifest = z.infer<typeof GeometryArtifactManifest>

export const GeometryScriptMount = z.enum(['floor', 'wall', 'wall-side', 'ceiling'])
export type GeometryScriptMount = z.infer<typeof GeometryScriptMount>

/** What a compile hands the scene: the artifact's hash, how it mounts, the resolved params and the manifest. */
export type CompiledGeometryScript = {
  sha256: string
  mount: GeometryScriptMount
  params: Record<string, GeometryScriptParamValue>
  manifest: GeometryArtifactManifest
}

/**
 * Geometry authored as a plain three.js module (`export const params`,
 * `export default function build({ params, inputs, THREE, lib })`). The
 * compiled artifact is what renders; the code only re-runs on an edit.
 */
export const GeometryScriptSource = z.object({
  kind: z.literal('script'),
  language: z.literal('three').default('three'),
  code: z
    .string()
    .min(1)
    .refine(
      (code) => new TextEncoder().encode(code).byteLength <= GEOMETRY_SCRIPT_MAX_BYTES,
      `Script source exceeds ${GEOMETRY_SCRIPT_MAX_BYTES / 1024} KiB`,
    ),
  params: z.record(z.string(), GeometryScriptParamValue).default({}),
  /** sha256 of the GLB the current code + params compiled to. */
  artifact: z.string().regex(/^[0-9a-f]{64}$/),
  manifest: GeometryArtifactManifest,
})
export type GeometryScriptSource = z.infer<typeof GeometryScriptSource>
