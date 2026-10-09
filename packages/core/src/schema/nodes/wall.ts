import dedent from 'dedent'
import { z } from 'zod'
import { Assembly } from '../assembly'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { CurtainWallConfig } from './curtain-wall'
import { DoorNode } from './door'
import { ItemNode } from './item'
import { LeanToExtensionNode } from './lean-to-extension'
import { WindowNode } from './window'

// Geometric faces: `a` is left of start → end, `b` is right (wall-frame convention).
// `interior` / `exterior` are legacy semantic values the M1 load migration maps
// onto a face; a runtime writer that still sends one renders on its canonical
// face (interior → a, exterior → b).
export const WallTreatmentSide = z.enum(['a', 'b', 'both', 'interior', 'exterior'])
export type WallTreatmentSide = z.infer<typeof WallTreatmentSide>

export const WallTrimProfile = z.enum([
  'flat',
  'bevel',
  'triangle',
  'cove',
  'bullnose',
  'base-modern',
  'base-colonial',
  'base-shoe',
  'base-ogee',
  'crown-cove',
  'crown-ogee',
  'crown-craftsman',
  'crown-layered',
  'rail-rounded',
  'rail-ogee',
  'rail-picture',
  'rail-stepped',
])
export type WallTrimProfile = z.infer<typeof WallTrimProfile>

export const WallTrimConfig = z.object({
  enabled: z.boolean().default(false),
  sides: WallTreatmentSide.default('both'),
  height: z.number().default(0.1),
  proud: z.number().default(0.015),
  profile: WallTrimProfile.default('flat'),
  offsetY: z.number().optional(),
})
export type WallTrimConfig = z.infer<typeof WallTrimConfig>

export const WALL_SKIRTING_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.12,
  proud: 0.02,
  profile: 'flat',
}

export const WALL_CROWN_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.12,
  proud: 0.055,
  profile: 'flat',
}

export const WALL_CHAIR_RAIL_DEFAULT: WallTrimConfig = {
  enabled: false,
  sides: 'both',
  height: 0.055,
  proud: 0.026,
  profile: 'flat',
  offsetY: 0.9,
}

export const WALL_TRIM_DEFAULTS = {
  skirting: WALL_SKIRTING_DEFAULT,
  crown: WALL_CROWN_DEFAULT,
  chairRail: WALL_CHAIR_RAIL_DEFAULT,
} as const

export const WALL_SKIRTING_SLOT_DEFAULT = 'library:preset-softwhite'
export const WALL_CROWN_SLOT_DEFAULT = 'library:preset-white'
export const WALL_CHAIR_RAIL_SLOT_DEFAULT = 'library:preset-cream'

export const WALL_SURFACE_SLOT_DEFAULTS = {
  a: 'library:concrete-drywall',
  b: 'library:concrete-drywall',
  aSkirting: WALL_SKIRTING_SLOT_DEFAULT,
  bSkirting: WALL_SKIRTING_SLOT_DEFAULT,
  aCrown: WALL_CROWN_SLOT_DEFAULT,
  bCrown: WALL_CROWN_SLOT_DEFAULT,
  aChairRail: WALL_CHAIR_RAIL_SLOT_DEFAULT,
  bChairRail: WALL_CHAIR_RAIL_SLOT_DEFAULT,
  // The foundation under a wall's underpinning (see WallNode.underpinning):
  // the concrete stemwall between the finish carried down over the floor
  // platform and the ground.
  foundation: 'library:concrete-raw',
} as const

export type WallSurfaceSlotId = keyof typeof WALL_SURFACE_SLOT_DEFAULTS
export type WallFace = 'a' | 'b'

export const WALL_FACE_REGION_LIMIT = 8

// A paint region overrides one face's finish inside a rectangle without cutting
// the wall. `u` is metres from the wall start along the reference line (along
// the chord for curved walls); `v` is metres above the face's own base. An
// absent bound runs to that edge, so a wainscot stretches with the wall.
export const WallFaceRegion = z.object({
  id: z.string(),
  face: z.enum(['a', 'b']),
  u0: z.number().finite().optional(),
  u1: z.number().finite().optional(),
  v0: z.number().finite().optional(),
  v1: z.number().finite().optional(),
  finish: z.string(),
})
export type WallFaceRegion = z.infer<typeof WallFaceRegion>

const WallSurfaceMaterialSpecSchema = z.object({
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
})

/**
 * What a wall carries BELOW its base on a house standing above the ground:
 * `rim` metres of its exterior finish continued down over the floor
 * platform's edge (subfloor, rim joist, mudsill), then the foundation —
 * the concrete stemwall, painted through the `foundation` slot — `stem`
 * metres more to the ground (with `fillToTerrain`, to the terrain wherever
 * that is lower). The wall body, its top and its openings are unchanged,
 * and the framers ignore it (a framing plugin pours its own stemwall
 * from the building's foundation record). `openings` are the holes through the
 * stem — a crawl space's vents and its access (IRC R408) — `u` metres
 * along the wall from its start (the opening's centre), `top` and `bottom`
 * in metres below the wall base.
 */
export const WallUnderpinningOpening = z.object({
  u: z.number(),
  width: z.number().positive(),
  top: z.number().min(0),
  bottom: z.number().min(0),
})
export type WallUnderpinningOpening = z.infer<typeof WallUnderpinningOpening>

export const WallUnderpinning = z.object({
  rim: z.number().min(0),
  stem: z.number().min(0),
  openings: z.array(WallUnderpinningOpening).optional(),
})
export type WallUnderpinning = z.infer<typeof WallUnderpinning>

// ---------------------------------------------------------------------------
// Wall assembly (WS5), legacy shape
// ---------------------------------------------------------------------------
// The four-slot stack #937 stored in `wall.assembly`. Walls now store F2
// layers (`Assembly`, schema/assembly.ts); scenes saved with this shape are
// converted on load (`migrateWallAssemblies`, `wallAssemblyFromLegacy`), and
// the inspector edits F2 stacks through this view (`wallAssemblyToLegacy`).

export const WallAssemblyExteriorFinish = z.enum([
  'siding',
  'stucco',
  'brick',
  'stone',
  'fiber-cement',
  'none',
])
export type WallAssemblyExteriorFinish = z.infer<typeof WallAssemblyExteriorFinish>

export const WallAssemblySheathingMaterial = z.enum(['osb', 'plywood', 'gypsum', 'none'])
export type WallAssemblySheathingMaterial = z.infer<typeof WallAssemblySheathingMaterial>

export const WallAssemblyFramingKind = z.enum(['wood', 'lgs', 'cmu', 'icf'])
export type WallAssemblyFramingKind = z.infer<typeof WallAssemblyFramingKind>

export const WallAssemblyInteriorFinish = z.enum(['drywall', 'plaster', 'none'])
export type WallAssemblyInteriorFinish = z.infer<typeof WallAssemblyInteriorFinish>

/** @deprecated The WS5 shape, kept for the load migration and the inspector view. */
export const WallAssembly = z
  .object({
    /** Id of a `WALL_ASSEMBLY_PRESETS` entry this stack was seeded from. */
    preset: z.string().optional(),
    /** Outermost cladding. For `brick` the thickness INCLUDES the air space. */
    exterior: z
      .object({
        finish: WallAssemblyExteriorFinish,
        thickness: z.number().nonnegative(),
      })
      .optional(),
    sheathing: z
      .object({
        material: WallAssemblySheathingMaterial,
        thickness: z.number().nonnegative(),
      })
      .optional(),
    /** The structural core. Always present — it is what makes a wall a wall. */
    framing: z.object({
      kind: WallAssemblyFramingKind,
      depth: z.number().nonnegative(),
    }),
    interior: z
      .object({
        finish: WallAssemblyInteriorFinish,
        thickness: z.number().nonnegative(),
      })
      .optional(),
    /** Free-text cavity insulation note (e.g. 'R-21 batt'). No geometry. */
    cavityInsulation: z.string().optional(),
  })
  .describe(
    dedent`
    Layered wall assembly, all thicknesses in metres, ordered outside -> inside:
    exterior finish, sheathing, framing, interior finish.
    - When present, this is the SINGLE SOURCE OF TRUTH for wall thickness:
      wall.thickness MUST equal assemblyThickness(assembly) and is rewritten on
      every assembly edit. Consumers keep reading wall.thickness as the total.
    - A stack with neither exterior nor sheathing is a PARTITION: the interior
      finish is applied to BOTH faces (total = 2 x interior + framing).
    - Which face is exterior comes from wall.frontSide / wall.backSide;
      frontSide is the +normal side, normal = perp(end - start).
    - The weather-resistive barrier (IRC R703.2) is intentionally not modelled:
      it is a film with no drawable thickness.
    `,
  )
export type WallAssembly = z.infer<typeof WallAssembly>

export const WallNode = BaseNode.extend({
  id: objectId('wall'),
  type: nodeType('wall'),
  wallType: z.enum(['standard', 'curtain']).optional(),
  curtainWall: CurtainWallConfig.optional(),
  children: z
    .array(
      z.union([
        ItemNode.shape.id,
        objectId('procedural-item'),
        DoorNode.shape.id,
        WindowNode.shape.id,
        LeanToExtensionNode.shape.id,
      ]),
    )
    .default([]),
  // Legacy single-material wall finish. Read for backward compatibility only.
  material: MaterialSchema.optional(),
  // Legacy single-material wall finish preset. Read for backward compatibility only.
  materialPreset: z.string().optional(),
  interiorMaterial: MaterialSchema.optional(),
  interiorMaterialPreset: z.string().optional(),
  exteriorMaterial: MaterialSchema.optional(),
  exteriorMaterialPreset: z.string().optional(),
  // Per-slot material overrides on the unified slot model, mirroring
  // `SlabNode.slots`. Key = geometric slot id (`a` / `b` faces, `aSkirting` …
  // trims), value = a `MaterialRef` (`library:<id>` / `scene:<id>`). Absent =
  // the declared slot default (`WALL_SLOT_DEFAULT`). Legacy `interior` /
  // `exterior` keys are rewritten by the M1 load migration.
  slots: z.record(z.string(), z.string()).optional(),
  // Legacy per-face inline finish, written only by the M1 load migration from
  // `interiorMaterial*` / `exteriorMaterial*` so a face keeps the fallback it
  // rendered with. Read after `slots[face]`, before `material` / `materialPreset`.
  legacyFaceMaterials: z
    .object({
      a: WallSurfaceMaterialSpecSchema.optional(),
      b: WallSurfaceMaterialSpecSchema.optional(),
    })
    .optional(),
  // Later entries win; at most WALL_FACE_REGION_LIMIT per face.
  faceRegions: z
    .array(WallFaceRegion)
    .superRefine((regions, ctx) => {
      for (const face of ['a', 'b'] as const) {
        if (regions.filter((region) => region.face === face).length > WALL_FACE_REGION_LIMIT)
          ctx.addIssue({
            code: 'custom',
            message: `At most ${WALL_FACE_REGION_LIMIT} paint regions per wall face`,
          })
      }
    })
    .optional(),
  // TOTAL wall thickness in metres — the one number every consumer reads.
  // The sum of `assembly`'s layers whenever an assembly is present.
  thickness: z.number().optional(),
  // Layered construction stack (F2). Optional: absent = a single unspecified
  // slab of `thickness`. Present = the stack sets `thickness`: edit the layers
  // and write their sum (`wallAssemblyPatch`), never `thickness` alone.
  assembly: Assembly.optional(),
  // Absent centers the body; a/b place it left/right of the stored start → end line.
  justification: z.enum(['a', 'b']).optional(),
  height: z.number().optional(),
  tilt: z.number().default(0),
  curveOffset: z.number().optional(),
  // Persisted slab-support host — see ItemNode.supportSlabId for the rules.
  supportSlabId: z.string().optional(),
  // Vertical offset from the elected support surface. Ground-hosted chained
  // walls use this to preserve one construction plane without copying terrain.
  supportOffset: z.number().finite().optional(),
  // Extend downward from the authored wall base to the terrain while keeping
  // the wall body height and top unchanged.
  fillToTerrain: z.boolean().optional(),
  // The finish and the foundation carried below the base — see WallUnderpinning.
  underpinning: WallUnderpinning.optional(),
  skirting: WallTrimConfig.optional(),
  crown: WallTrimConfig.optional(),
  chairRail: WallTrimConfig.optional(),
  // e.g., start/end points for path
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  // Derived room classification per face, still written by the structure
  // kernel for cutaway and dimension readers. Wall finishes never read it.
  frontSide: z.enum(['interior', 'exterior', 'unknown']).default('unknown'),
  backSide: z.enum(['interior', 'exterior', 'unknown']).default('unknown'),
}).describe(
  dedent`
  Wall node - used to represent a wall in the building
  - thickness: TOTAL thickness in meters (all assembly layers together)
  - assembly: optional layered construction stack; when present it is the single
    source of truth and thickness is re-derived from it on every edit
  - height: height in meters
  - fillToTerrain: extends the wall downward to the terrain without changing its authored height
  - underpinning: { rim, stem } — the finish carried rim metres below the base over the floor
    platform's edge, then stem metres of concrete stemwall to the ground (the foundation slot)
  - curveOffset: midpoint sagitta offset used to bend the wall into an arc
  - start: start point of the wall in level coordinate system
  - end: end point of the wall in level coordinate system
  - size: size of the wall in grid units
  - frontSide: whether the front side faces interior, exterior, or unknown
  - backSide: whether the back side faces interior, exterior, or unknown
  `,
)
export type WallNode = z.infer<typeof WallNode>

/** Legacy semantic side, read only by load migrations. */
export type WallSurfaceSide = 'interior' | 'exterior'

// Declared default appearance for an unpainted wall face in colored mode —
// visual parity with the retired DEFAULT_WALL_MATERIAL. Lives in core so the
// slot declaration (nodes) and the material resolver (viewer) share one value.
// May be a `#rrggbb` colour or a `library:<id>` ref. Textures-off still
// collapses to the themed wall role (the escape hatch).
export const WALL_SLOT_DEFAULT: Record<WallFace, string> = {
  a: WALL_SURFACE_SLOT_DEFAULTS.a,
  b: WALL_SURFACE_SLOT_DEFAULTS.b,
}

export type WallTrimKind = 'skirting' | 'crown' | 'chairRail'
export type WallTrimSlotId = `${WallFace}${'Skirting' | 'Crown' | 'ChairRail'}`

export function getWallTrimSlotId(face: WallFace, kind: WallTrimKind): WallTrimSlotId {
  return `${face}${kind === 'skirting' ? 'Skirting' : kind === 'crown' ? 'Crown' : 'ChairRail'}`
}

/** Faces a trim config draws on. Legacy semantic values use their canonical face. */
export function getWallTrimFaces(sides: WallTreatmentSide | undefined): WallFace[] {
  if (sides === 'a' || sides === 'interior') return ['a']
  if (sides === 'b' || sides === 'exterior') return ['b']
  return ['a', 'b']
}

export type WallSurfaceMaterialSpec = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
}

type WallSurfaceMaterialSource = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
  interiorMaterial?: z.infer<typeof MaterialSchema>
  interiorMaterialPreset?: string
  exteriorMaterial?: z.infer<typeof MaterialSchema>
  exteriorMaterialPreset?: string
}

function getConfiguredWallSurfaceMaterial(
  wall: WallSurfaceMaterialSource,
  side: WallSurfaceSide,
): WallSurfaceMaterialSpec {
  if (side === 'interior') {
    return {
      material: wall.interiorMaterial,
      materialPreset: wall.interiorMaterialPreset,
    }
  }

  return {
    material: wall.exteriorMaterial,
    materialPreset: wall.exteriorMaterialPreset,
  }
}

function hasSurfaceMaterial(spec: WallSurfaceMaterialSpec): boolean {
  return spec.material !== undefined || typeof spec.materialPreset === 'string'
}

export function getEffectiveWallSurfaceMaterial(
  wall: WallSurfaceMaterialSource,
  side: WallSurfaceSide,
): WallSurfaceMaterialSpec {
  const configured = getConfiguredWallSurfaceMaterial(wall, side)
  if (hasSurfaceMaterial(configured)) {
    return configured
  }

  return {
    material: wall.material,
    materialPreset: wall.materialPreset,
  }
}

type WallFaceMaterialSource = WallSurfaceMaterialSource & {
  legacyFaceMaterials?: WallNode['legacyFaceMaterials']
}

/** A face's legacy inline finish: its migrated per-face spec, else the wall-wide legacy fields. */
export function getEffectiveWallFaceMaterial(
  wall: WallFaceMaterialSource,
  face: WallFace,
): WallSurfaceMaterialSpec {
  const configured = wall.legacyFaceMaterials?.[face]
  if (configured && hasSurfaceMaterial(configured)) {
    return { material: configured.material, materialPreset: configured.materialPreset }
  }
  return { material: wall.material, materialPreset: wall.materialPreset }
}

export function getWallSurfaceMaterialSignature(spec: WallSurfaceMaterialSpec): string {
  return JSON.stringify({
    material: spec.material ?? null,
    materialPreset: spec.materialPreset ?? null,
  })
}
