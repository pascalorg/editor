import { z } from 'zod'
import { CurtainGrid, CurtainPanelType } from './curtain-wall'

export const RoofSystemType = z.enum(['standard', 'glazed'])
export type RoofSystemType = z.infer<typeof RoofSystemType>

export const RoofGlazing = z.object({
  across: CurtainGrid.prefault({}),
  along: CurtainGrid.prefault({}),
  frameWidth: z.number().finite().positive().default(0.05),
  frameDepth: z.number().finite().positive().default(0.08),
  glassThickness: z.number().finite().positive().default(0.008),
  frameColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#303942'),
  glassColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#a9d5df'),
  glassOpacity: z.number().finite().min(0.05).max(1).default(0.3),
  glassRoughness: z.number().finite().min(0).max(1).default(0.12),
  glazedEnds: z.boolean().default(true),
  panelType: CurtainPanelType.default('glass'),
  panels: z
    .array(
      z.object({
        face: z
          .string()
          .regex(/^(front|back|slope|end-left|end-right|barrel-([0-9]|[12][0-9]|3[01]))$/),
        column: z.number().int().min(0).max(31),
        row: z.number().int().min(0).max(31),
        type: CurtainPanelType,
      }),
    )
    .max(5120)
    .default([]),
})
export type RoofGlazing = z.infer<typeof RoofGlazing>
export const DEFAULT_ROOF_GLAZING = RoofGlazing.parse({})
