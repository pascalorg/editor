import { z } from 'zod'
import { GeometrySourceMeta } from './geometry-metadata'

/** Source code is stored separately from the scene; bound its upload size. */
export const GEOMETRY_SCRIPT_MAX_BYTES = 48 * 1024
/** The manifest rides inline in the node; the compiler keeps it under this. */
export const GEOMETRY_MANIFEST_MAX_BYTES = 24 * 1024
export const GEOMETRY_SCRIPT_MIME_TYPE = 'text/javascript'

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
  slots: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().optional(),
        color: z.string().optional(),
        roughness: finite.optional(),
        metalness: finite.optional(),
        transparent: z.boolean().optional(),
        emissive: z.boolean().optional(),
      }),
    )
    .default([]),
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
  /**
   * Downward-facing areas ceiling items hang from (a vault plane, a soffit, a
   * beam): XZ outline and the plane a·x + b·y + c·z + d = 0, so a sloped
   * underside gives its height anywhere inside the outline.
   */
  undersides: z
    .array(
      z.object({
        part: z.string().optional(),
        polygon: z.array(z.tuple([finite, finite])),
        plane: z.tuple([finite, finite, finite, finite]),
      }),
    )
    .default([]),
  /** The module's AnimationClips; `open`, `close` and `loop` drive the object's controls. */
  animations: z.array(z.object({ name: z.string(), duration: finite })).default([]),
  /** Vertical cutter footprints in the normalized artifact frame. Absent in older artifacts. */
  cutters: z
    .array(
      z.object({
        host: z.enum(['mounted', 'wall', 'ceiling', 'slab']),
        polygon: z.array(z.array(finite).length(2)).min(3),
        minY: finite,
        maxY: finite,
      }),
    )
    .optional(),
  cutout: z.boolean().default(false),
  collider: z.boolean().default(false),
  triangles: z.number().int().nonnegative(),
})
export type GeometryArtifactManifest = z.infer<typeof GeometryArtifactManifest>

export const GeometryScriptMount = z.enum(['floor', 'wall', 'wall-side', 'ceiling'])
export type GeometryScriptMount = z.infer<typeof GeometryScriptMount>

/** What a compile hands the scene: the artifact's hash, how it mounts, the resolved params and the manifest. */
export type CompiledGeometryScript = {
  /** The destination identity reserved before artifact uploads. */
  nodeId?: string
  /** sha256 of the GLB. */
  sha256: string
  /** sha256 of the module text that produced it. */
  script: string
  mount: GeometryScriptMount
  params: Record<string, GeometryScriptParamValue>
  manifest: GeometryArtifactManifest
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/)

/**
 * Geometry authored as a plain three.js module (`export const params`,
 * `export default function build({ params, inputs, THREE, lib })`). The
 * compiled artifact is what renders; the code only re-runs on an edit.
 */
export const GeometryScriptSource = z.object({
  kind: z.literal('script'),
  meta: GeometrySourceMeta.optional(),
  language: z.literal('three').default('three'),
  /** sha256 of the module's UTF-8 text, a `text/javascript` artifact: the code never rides in the scene. */
  script: sha256,
  params: z.record(z.string(), GeometryScriptParamValue).default({}),
  /** sha256 of the GLB the current code + params compiled to. */
  artifact: sha256,
  manifest: GeometryArtifactManifest,
  /**
   * The thumbnail and the top-down floor-plan image an editor took of a GLB,
   * as image artifacts. They describe the node only while `artifact` is still
   * the GLB they were taken of.
   */
  images: z.object({ artifact: sha256, thumbnail: sha256, floorPlan: sha256 }).optional(),
})
export type GeometryScriptSource = z.infer<typeof GeometryScriptSource>
