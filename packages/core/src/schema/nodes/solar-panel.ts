import dedent from 'dedent'
import { z } from 'zod'
import { SolarPanelPresetKey } from '../../solar-panel-presets'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const SolarPanelMaterialRole = z.enum(['frame', 'panel'])
export type SolarPanelMaterialRole = z.infer<typeof SolarPanelMaterialRole>

export const SolarPanelNode = BaseNode.extend({
  id: objectId('solarpanel'),
  type: nodeType('solar-panel'),

  // Frame / rail material — aluminum mounting rails.
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Panel surface material — dark photovoltaic glass.
  panelMaterial: MaterialSchema.optional(),
  panelMaterialPreset: z.string().optional(),

  // Visual preset that drove panelWidth / panelHeight / frameThickness /
  // frameDepth. Cleared whenever any of those four is edited manually.
  panelTypePreset: SolarPanelPresetKey.optional(),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  // Grid layout.
  rows: z.number().int().min(1).max(20).default(2),
  columns: z.number().int().min(1).max(20).default(3),

  // Individual panel dimensions (meters). Defaults match the 'residential' preset.
  panelWidth: z.number().default(1.0),
  panelHeight: z.number().default(1.65),

  // Gaps between panels.
  gapX: z.number().default(0.02),
  gapY: z.number().default(0.02),

  // Mounting type — flush (flat on the slope) or tilted (angled up).
  mountingType: z.enum(['flush', 'tilted']).default('flush'),
  tiltAngle: z.number().default(15),
  standoffHeight: z.number().default(0.05),

  // Frame.
  frameThickness: z.number().default(0.04),
  frameDepth: z.number().default(0.04),

  // Surface normal at placement point (segment-local). Captured from a
  // raycast on the shingle surface during placement / move. Falls back
  // to the analytical normal in the renderer if absent.
  surfaceNormal: z.tuple([z.number(), z.number(), z.number()]).optional(),
}).describe(
  dedent`
  Solar panel array — a grid of photovoltaic panels mounted on a roof
  segment. Position is segment-local (x along width, z along depth);
  the Y component is captured from the raycast hit on the shingle
  surface, with an analytical fallback in the renderer when it's 0.
  `,
)

export type SolarPanelNode = z.infer<typeof SolarPanelNode>
