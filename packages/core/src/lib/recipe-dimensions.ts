import type { IndustrialArchetypeRecipeId } from './industrial-archetype-registry'

export type RecipeDimensionSize = 'small' | 'medium' | 'large'

export interface RecipeDimensions {
  length: number
  width: number
  height: number
  [key: string]: number
}

export interface RecipeDimensionParams {
  size?: string
  sizeScale?: number
  length?: number
  width?: number
  height?: number
}

export const INDUSTRIAL_RECIPE_DIMENSIONS: Record<
  IndustrialArchetypeRecipeId,
  Record<RecipeDimensionSize, RecipeDimensions>
> = {
  'machineTool.lathe': {
    small: { length: 2.2, width: 1.35, height: 1.45 },
    medium: { length: 2.8, width: 1.8, height: 1.8 },
    large: { length: 3.6, width: 2.2, height: 2.1 },
  },
  'machineTool.machiningCenter': {
    small: { length: 1.9, width: 1.7, height: 2.0 },
    medium: { length: 2.4, width: 2.2, height: 2.4 },
    large: { length: 3.1, width: 2.7, height: 2.9 },
  },
  'machineTool.laserCutter': {
    small: { length: 2.2, width: 1.4, height: 1.1 },
    medium: { length: 3.0, width: 1.8, height: 1.3 },
    large: { length: 4.0, width: 2.2, height: 1.55 },
  },
  'forming.injectionMolding': {
    small: { length: 3.2, width: 1.1, height: 1.5 },
    medium: { length: 4.5, width: 1.4, height: 1.8 },
    large: { length: 6.0, width: 1.8, height: 2.2 },
  },
  'forming.hydraulicPress': {
    small: { length: 1.2, width: 0.95, height: 1.8 },
    medium: { length: 1.6, width: 1.2, height: 2.4 },
    large: { length: 2.2, width: 1.6, height: 3.2 },
  },
  'materialHandling.beltConveyor': {
    small: { length: 2.4, width: 0.55, height: 0.85 },
    medium: { length: 4.0, width: 0.8, height: 1.1 },
    large: { length: 5.8, width: 1.1, height: 1.35 },
  },
  'fluidMachine.centrifugalPump': {
    small: { length: 0.75, width: 0.36, height: 0.5 },
    medium: { length: 1.1, width: 0.5, height: 0.7 },
    large: { length: 1.6, width: 0.75, height: 1.0 },
  },
  'process.heatExchanger': {
    small: { length: 1.8, width: 0.65, height: 0.75 },
    medium: { length: 3.0, width: 1.0, height: 1.1 },
    large: { length: 4.8, width: 1.45, height: 1.55 },
  },
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function resolveRecipeSizeKey(size: unknown): RecipeDimensionSize {
  if (typeof size !== 'string') return 'medium'
  const normalized = size.trim().toLowerCase()
  if (/^(tiny|mini|compact|small|s|low)$/.test(normalized)) return 'small'
  if (/^(large|big|xl|oversized|high)$/.test(normalized)) return 'large'
  return 'medium'
}

export function resolveRecipeDimensions(
  recipeId: IndustrialArchetypeRecipeId,
  params: RecipeDimensionParams = {},
): RecipeDimensions {
  const base = INDUSTRIAL_RECIPE_DIMENSIONS[recipeId][resolveRecipeSizeKey(params.size)]
  const scale = finitePositive(params.sizeScale) ?? 1
  return {
    length: finitePositive(params.length) ?? base.length * scale,
    width: finitePositive(params.width) ?? base.width * scale,
    height: finitePositive(params.height) ?? base.height * scale,
  }
}
