import { z } from 'zod'

export const CurtainGrid = z.object({
  layout: z.enum(['count', 'maximum-spacing', 'fixed-spacing']).default('maximum-spacing'),
  count: z.number().int().min(1).max(32).default(3),
  spacing: z.number().finite().min(0.2).max(100).default(1.5),
  alignment: z.enum(['start', 'center', 'end']).default('center'),
})
export type CurtainGrid = z.infer<typeof CurtainGrid>

export const CurtainPanelType = z.enum(['glass', 'solid', 'empty'])
export type CurtainPanelType = z.infer<typeof CurtainPanelType>

export const CurtainWallConfig = z.object({
  construction: z.enum(['stick', 'unitized']).default('stick'),
  framing: z
    .enum(['capped', 'vertical-caps', 'horizontal-caps', 'structural-glazing'])
    .default('capped'),
  columns: CurtainGrid.prefault({}),
  rows: CurtainGrid.prefault({ layout: 'count', count: 2 }),
  mullionWidth: z.number().finite().min(0.01).max(0.3).default(0.05),
  transomWidth: z.number().finite().min(0.01).max(0.3).default(0.05),
  perimeterWidth: z.number().finite().min(0.01).max(0.3).default(0.05),
  jointWidth: z.number().finite().min(0.002).max(0.05).default(0.01),
  glassThickness: z.number().finite().min(0.004).max(0.08).default(0.024),
  panelType: CurtainPanelType.default('glass'),
  spandrel: z.enum(['none', 'bottom', 'top']).default('none'),
  frameColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#303942'),
  glassColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#a9d5df'),
  solidColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#53616d'),
  glassOpacity: z.number().finite().min(0.05).max(1).default(0.3),
  glassRoughness: z.number().finite().min(0).max(1).default(0.12),
  panels: z
    .array(
      z.object({
        column: z.number().int().min(0).max(31),
        row: z.number().int().min(0).max(31),
        type: CurtainPanelType,
      }),
    )
    .max(1024)
    .default([]),
})
export type CurtainWallConfig = z.infer<typeof CurtainWallConfig>

export const DEFAULT_CURTAIN_WALL = CurtainWallConfig.parse({})

export function getCurtainWallConfig(wall: { curtainWall?: CurtainWallConfig }): CurtainWallConfig {
  return wall.curtainWall ?? DEFAULT_CURTAIN_WALL
}

export function curtainGridPositions(length: number, grid: CurtainGrid): number[] {
  if (!Number.isFinite(length) || length <= 0) return [0]
  const count = grid.layout === 'count' ? grid.count : Math.ceil(length / grid.spacing)
  const bounded = Math.max(1, Math.min(32, count))
  if (grid.layout !== 'fixed-spacing' || count > 32) {
    return Array.from({ length: bounded + 1 }, (_, index) => (length * index) / bounded)
  }
  const whole = Math.floor(length / grid.spacing)
  const remainder = length - whole * grid.spacing
  const offset =
    grid.alignment === 'start' ? 0 : grid.alignment === 'end' ? remainder : remainder / 2
  const positions = [0]
  for (let index = 0; index <= whole; index++) {
    const value = offset + index * grid.spacing
    if (value > 1e-6 && value < length - 1e-6) positions.push(value)
  }
  positions.push(length)
  // A centered remainder can introduce two edge cells.
  return positions.length <= 33
    ? positions
    : Array.from({ length: 33 }, (_, i) => (length * i) / 32)
}
