/**
 * The three paper-space kinds.
 *
 * These are PAPER objects: they live in the scene graph so they travel with
 * the scene file, but they have no 3D presence at all. Like `bones:framing`
 * they carry no `geometry`, no `renderer` and no `def.floorplan`, so the 3D
 * viewer and the 2D floor plan both ignore them (the registry only mounts a
 * renderer when `def.renderer` is set, and only draws in plan when
 * `def.floorplan` is set — see `floorplan-registry-layer.tsx`).
 */
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/* ------------------------------------------------------------ shared */

export const SheetAddress = z.object({
  street: z.string().default(''),
  city: z.string().default(''),
  state: z.string().default(''),
  zip: z.string().default(''),
})
export type SheetAddress = z.infer<typeof SheetAddress>

export const DocumentStatus = z.enum(['preliminary', 'permit-set', 'construction-set'])
export type DocumentStatus = z.infer<typeof DocumentStatus>

export const Revision = z.object({
  id: z.string().default(''),
  date: z.string().default(''),
  description: z.string().default(''),
  by: z.string().default(''),
})
export type Revision = z.infer<typeof Revision>

/* --------------------------------------------------- project record */

export const ProjectRecordNode = BaseNode.extend({
  id: objectId('projectrecord'),
  type: nodeType('sheets:project-record'),
  identity: z
    .object({
      projectName: z.string().default(''),
      projectNumber: z.string().default(''),
      apn: z.string().default(''),
      address: SheetAddress.default({ street: '', city: '', state: '', zip: '' }),
    })
    .default({
      projectName: '',
      projectNumber: '',
      apn: '',
      address: { street: '', city: '', state: '', zip: '' },
    }),
  designer: z
    .object({ name: z.string().default(''), license: z.string().default('') })
    .default({ name: '', license: '' }),
  firm: z
    .object({
      company: z.string().default(''),
      phone: z.string().default(''),
      email: z.string().default(''),
      logoText: z.string().default(''),
    })
    .default({ company: '', phone: '', email: '', logoText: '' }),
  owner: z.object({ name: z.string().default('') }).default({ name: '' }),
  engineer: z
    .object({ company: z.string().default(''), license: z.string().default('') })
    .default({ company: '', license: '' }),
  jurisdiction: z
    .object({
      city: z.string().default(''),
      county: z.string().default(''),
      state: z.string().default(''),
    })
    .default({ city: '', county: '', state: '' }),
  documentStatus: DocumentStatus.default('preliminary'),
  revisions: z.array(Revision).default([]),
  date: z.string().default(''),
  drawnBy: z.string().default(''),
}).describe(
  'The project record — who, where, for whom. One per scene, a child of the site node. Everything the title block prints.',
)
export type ProjectRecordNode = z.infer<typeof ProjectRecordNode>

/* ---------------------------------------------------------- sheet */

export const SheetSize = z.enum(['arch-d', 'arch-c', 'tabloid'])
export type SheetSize = z.infer<typeof SheetSize>

export const SheetNode = BaseNode.extend({
  id: objectId('sheet'),
  type: nodeType('sheets:sheet'),
  number: z.string().default('A0.0'),
  title: z.string().default('Untitled sheet'),
  size: SheetSize.default('arch-d'),
  order: z.number().default(0),
  /** Viewport node ids drawn on this sheet, in paint order. */
  items: z.array(z.string()).default([]),
}).describe('One sheet of paper in the set.')
export type SheetNode = z.infer<typeof SheetNode>

/* -------------------------------------------------------- viewport */

export const ViewportKind = z.enum([
  'plan',
  'site-plan',
  'section',
  'elevation',
  'view3d',
  'schedule',
  'notes',
  'image',
])
export type ViewportKind = z.infer<typeof ViewportKind>

/** The annotation-visibility record plus the sheet-only system toggles. */
export const ViewportLayers = z.object({
  automaticDimensions: z.boolean().default(true),
  contextualDimensions: z.boolean().default(false),
  manualDimensions: z.boolean().default(true),
  measurements: z.boolean().default(false),
  openingMarks: z.boolean().default(true),
  structuralGrids: z.boolean().default(true),
  roomLabels: z.boolean().default(true),
  stairAnnotations: z.boolean().default(true),
  furniture: z.boolean().default(false),
  mep: z.boolean().default(false),
  framing: z.boolean().default(false),
  electrical: z.boolean().default(false),
  plumbing: z.boolean().default(false),
  siteUtilities: z.boolean().default(true),
  terrain: z.boolean().default(true),
})
export type ViewportLayers = z.infer<typeof ViewportLayers>

export const DEFAULT_VIEWPORT_LAYERS: ViewportLayers = ViewportLayers.parse({})

export const WorldBounds = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
})
export type WorldBounds = z.infer<typeof WorldBounds>

export const CoverPose = z.union([
  z.literal('cover-front'),
  z.object({
    position: z.tuple([z.number(), z.number(), z.number()]),
    target: z.tuple([z.number(), z.number(), z.number()]),
  }),
])
export type CoverPose = z.infer<typeof CoverPose>

export const ViewportNode = BaseNode.extend({
  id: objectId('viewport'),
  type: nodeType('sheets:viewport'),
  sheetId: z.string().default(''),
  kind: ViewportKind.default('plan'),
  /** Placement on the sheet, in SHEET INCHES from the paper's top-left. */
  x: z.number().default(1),
  y: z.number().default(1),
  w: z.number().default(12),
  h: z.number().default(9),
  /**
   * Drawing scale as a plain world:paper ratio — 1/4"=1'-0" is 48,
   * 1/8"=1'-0" is 96, 1"=20' is 240. See `scale.ts`.
   */
  scale: z.number().positive().default(48),
  levelId: z.string().optional(),
  /** `ConstructionDrawingType` — floor-plan, foundation-plan, roof-plan… */
  drawingType: z.string().optional(),
  /** Section / elevation marker node id (WS6). */
  markerId: z.string().optional(),
  /** Elevation compass direction when there is no marker. */
  direction: z.enum(['north', 'east', 'south', 'west']).optional(),
  layers: ViewportLayers.default(DEFAULT_VIEWPORT_LAYERS),
  title: z.string().default(''),
  /** Locked viewports select but do not move or resize on the paper (default). */
  locked: z.boolean().default(true),
  /** Optional crop in WORLD metres; absent means "fit the drawing". */
  crop: WorldBounds.optional(),
  /** view3d only. */
  pose: CoverPose.optional(),
  /** schedule only: which table. */
  scheduleOf: z.enum(['doors', 'windows', 'rooms']).optional(),
  /** notes only. */
  text: z.string().default(''),
  /** image / captured view3d only. */
  dataUrl: z.string().default(''),
}).describe('A live window onto the model, placed on a sheet.')
export type ViewportNode = z.infer<typeof ViewportNode>

export const SHEETS_KINDS = [
  'sheets:project-record',
  'sheets:sheet',
  'sheets:viewport',
] as const
