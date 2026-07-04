import type { AnyNode } from '@pascal-app/core'
import type { ObjectCapabilityProfile } from '../../../lib/object-capabilities'

export type AnyRecord = Record<string, unknown>
export type LensNodeMap = Record<string, AnyNode | undefined>

export function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function vector3(value: unknown): [number, number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 3 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number'
  ) {
    return [value[0], value[1], value[2]]
  }
  return undefined
}

export function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function metadataOf(node: AnyNode | undefined) {
  const metadata = (node as unknown as { metadata?: unknown })?.metadata
  return isRecord(metadata) ? metadata : {}
}

export function equipmentAssemblyOf(metadata: AnyRecord) {
  return isRecord(metadata.equipmentAssembly) ? metadata.equipmentAssembly : undefined
}

export function stationIdOf(node: AnyNode | undefined) {
  const metadata = metadataOf(node)
  const assembly = equipmentAssemblyOf(metadata)
  return stringValue(metadata.stationId) ?? stringValue(assembly?.stationId)
}

export function processIdOf(node: AnyNode | undefined) {
  return stringValue(metadataOf(node).processId)
}

export function nodeBasePosition(node: AnyNode | undefined): [number, number, number] {
  if (!node) return [0, 0, 0]
  return vector3((node as unknown as AnyRecord).position) ?? [0, 0, 0]
}

export function compactId(value: string | undefined) {
  if (!value) return undefined
  const parts = value.split(':')
  return parts[parts.length - 1] || value
}

export function uniqueStrings(values: readonly string[], limit = values.length) {
  return values.filter((value, index) => values.indexOf(value) === index).slice(0, limit)
}

export function isEquipmentProfile(profile: ObjectCapabilityProfile) {
  return (
    profile.sources.includes('semantic-assembly') ||
    profile.sources.includes('factory-equipment') ||
    Boolean(profile.recipeId || profile.equipmentFamily)
  )
}

export function estimateEquipmentHeight(
  node: AnyNode | undefined,
  profile: ObjectCapabilityProfile,
  fallback = 2.4,
) {
  if (!node) return fallback
  const record = node as unknown as AnyRecord
  if (profile.equipmentFamily === 'column') return 7.5
  if (profile.equipmentFamily === 'tank') return 3.2
  if (profile.equipmentFamily === 'pump') return 1.6
  return numberValue(record.height) ?? fallback
}
