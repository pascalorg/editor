import { z } from 'zod'

export const CEILING_MEDALLION_STYLES = [
  'haussmann-acanthe',
  'empire-palmette',
  'classique-godrons',
  'art-deco-radial',
  'moulure-anneaux',
] as const

export const CeilingMedallionStyle = z.enum(CEILING_MEDALLION_STYLES)
export type CeilingMedallionStyle = z.infer<typeof CeilingMedallionStyle>

export const CeilingMedallionConfig = z.object({
  enabled: z.boolean().default(true),
  style: CeilingMedallionStyle.default('haussmann-acanthe'),
  diameter: z.number().min(0.25).max(3.0).default(0.9),
  relief: z.number().min(0.015).max(0.12).default(0.045),
  /** Optional [dx, dz] offset in metres from the room ceiling centre. */
  offset: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  /** Optional explicit level-plan [x, z] placement in metres. */
  at: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  /** Optional library:/scene: finish ref; defaults to the ceiling finish or plaster white. */
  finish: z.string().optional(),
})
export type CeilingMedallionConfig = z.infer<typeof CeilingMedallionConfig>

export const CEILING_FRAME_STYLES = [
  'haussmann-cadre',
  'classique-filet',
  'double-cadre',
  'caissons',
] as const

export const CeilingFrameStyle = z.enum(CEILING_FRAME_STYLES)
export type CeilingFrameStyle = z.infer<typeof CeilingFrameStyle>

export const CeilingFrameConfig = z.object({
  enabled: z.boolean().default(true),
  style: CeilingFrameStyle.default('haussmann-cadre'),
  /** Distance in metres from the ceiling perimeter walls to the outer moulding edge. */
  inset: z.number().min(0.08).max(2.0).default(0.42),
  /** Moulding band width in metres. */
  width: z.number().min(0.025).max(0.3).default(0.085),
  /** Moulding drop height in metres beneath the ceiling underside. */
  relief: z.number().min(0.01).max(0.12).default(0.032),
  /** Haussmannian concave quarter-circle re-entrant corners with sculpted corner rosettes. */
  notchedCorners: z.boolean().default(true),
  /** Optional library:/scene: finish ref; defaults to the ceiling finish or plaster white. */
  finish: z.string().optional(),
})
export type CeilingFrameConfig = z.infer<typeof CeilingFrameConfig>
