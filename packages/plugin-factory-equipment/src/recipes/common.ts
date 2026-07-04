import type { EquipmentParamValue, SemanticRecipePart } from '@pascal-app/core'

export function stringParam(
  params: Record<string, EquipmentParamValue> | undefined,
  key: string,
  fallback: string,
) {
  const value = params?.[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function numberParam(
  params: Record<string, EquipmentParamValue> | undefined,
  key: string,
  fallback: number,
) {
  const value = params?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export type FactorySemanticRecipePart = SemanticRecipePart & Record<string, unknown>
