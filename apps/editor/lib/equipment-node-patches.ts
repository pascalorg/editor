import type {
  AnyNode,
  AnyNodeId,
  EquipmentParamValue,
  EquipmentSpec,
  NodeRegistry,
} from '@pascal-app/core'
import { nodeRegistry } from '@pascal-app/core'

export type EquipmentNodeCreatePatch = {
  op: 'create'
  node: AnyNode
  parentId?: AnyNodeId
}

export type GenericEquipmentDraft = {
  kind: 'generic-equipment-draft'
  reason: string
  source: 'prompt' | 'process-station' | 'manual-preset'
  prompt?: string
  stationId?: string
  presetId?: string
}

function metadataFor(spec: EquipmentSpec): Record<string, EquipmentParamValue> {
  const metadata: Record<string, EquipmentParamValue> = {
    generatedBy: 'equipment-spec-compiler',
    equipmentProfileId: spec.profileId,
  }
  for (const [key, value] of Object.entries((spec.metadata ?? {}) as Record<string, unknown>)) {
    const jsonValue = equipmentParamValue(value)
    if (jsonValue !== undefined) metadata[key] = jsonValue
  }
  return metadata
}

function equipmentParamValue(value: unknown): EquipmentParamValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const jsonValue = equipmentParamValue(item)
      return jsonValue === undefined ? [] : [jsonValue]
    })
  }
  if (typeof value === 'object') {
    const record: Record<string, EquipmentParamValue> = {}
    for (const [key, item] of Object.entries(value)) {
      const jsonValue = equipmentParamValue(item)
      if (jsonValue !== undefined) record[key] = jsonValue
    }
    return record
  }
  return undefined
}

export function createEquipmentNodePatch(input: {
  spec: EquipmentSpec
  parentId?: AnyNodeId | string | null
  registry?: NodeRegistry
}): EquipmentNodeCreatePatch {
  const registry = input.registry ?? nodeRegistry
  const def = registry.get(input.spec.nodeKind)
  if (!def) {
    throw new Error(`Cannot compile equipment spec: nodeKind "${input.spec.nodeKind}" is not registered.`)
  }

  const node = def.schema.parse({
    type: input.spec.nodeKind,
    ...input.spec.params,
    ...(input.spec.position ? { position: input.spec.position } : {}),
    ...(input.spec.rotation ? { rotation: input.spec.rotation } : {}),
    metadata: metadataFor(input.spec),
  }) as AnyNode
  const parentId = input.parentId == null ? undefined : (input.parentId as AnyNodeId)
  return { op: 'create', node, ...(parentId ? { parentId } : {}) }
}

export function createGenericEquipmentDraft(input: {
  reason: string
  source: GenericEquipmentDraft['source']
  prompt?: string
  stationId?: string
  presetId?: string
}): GenericEquipmentDraft {
  return {
    kind: 'generic-equipment-draft',
    reason: input.reason,
    source: input.source,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.stationId ? { stationId: input.stationId } : {}),
    ...(input.presetId ? { presetId: input.presetId } : {}),
  }
}
