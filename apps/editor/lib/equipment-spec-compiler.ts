import type { AnyNodeId, EquipmentParamValue, EquipmentSpec, NodeRegistry, Vec3 } from '@pascal-app/core'
import {
  createEquipmentSpecFromV2Binding,
  resolveEquipmentBinding,
  type EquipmentSourcePreset,
  type EquipmentSourceStation,
} from './equipment-binding-resolver'
import {
  createEquipmentNodePatch,
  createGenericEquipmentDraft,
  type EquipmentNodeCreatePatch,
  type GenericEquipmentDraft,
} from './equipment-node-patches'
import type {
  IndustryPackV2Manifest,
  IndustryPackV2ValidationProfile,
} from './industry-pack-v2'

export type EquipmentCompileInput = {
  manifest: IndustryPackV2Manifest
  profiles: IndustryPackV2ValidationProfile[]
  prompt?: string
  station?: EquipmentSourceStation
  preset?: EquipmentSourcePreset
  parentId?: AnyNodeId | string | null
  position?: Vec3
  rotation?: Vec3
  paramOverrides?: Record<string, EquipmentParamValue>
  metadata?: Record<string, EquipmentParamValue>
  registry?: NodeRegistry
}

export type EquipmentCompileResult =
  | {
      kind: 'equipment-node'
      spec: EquipmentSpec
      patch: EquipmentNodeCreatePatch
    }
  | {
      kind: 'generic-equipment-draft'
      draft: GenericEquipmentDraft
    }

function compileEquipmentFromSource(
  source: GenericEquipmentDraft['source'],
  input: EquipmentCompileInput,
): EquipmentCompileResult {
  const resolution = resolveEquipmentBinding({
    manifest: input.manifest,
    profiles: input.profiles,
    prompt: input.prompt,
    station: input.station,
    preset: input.preset,
    source,
    registry: input.registry,
  })
  if (!resolution) {
    return {
      kind: 'generic-equipment-draft',
      draft: createGenericEquipmentDraft({
        source,
        prompt: input.prompt,
        stationId: input.station?.id,
        presetId: input.preset?.id,
        reason: 'No registered equipment binding matched the requested device.',
      }),
    }
  }

  const spec = createEquipmentSpecFromV2Binding({
    resolution,
    position: input.position,
    rotation: input.rotation,
    paramOverrides: { ...(input.preset?.params ?? {}), ...(input.paramOverrides ?? {}) },
    metadata: input.metadata,
  })
  if (!spec) {
    return {
      kind: 'generic-equipment-draft',
      draft: createGenericEquipmentDraft({
        source,
        prompt: input.prompt,
        stationId: input.station?.id,
        presetId: input.preset?.id,
        reason: `Equipment binding "${resolution.binding.profileId}" could not produce a complete EquipmentSpec.`,
      }),
    }
  }

  return {
    kind: 'equipment-node',
    spec,
    patch: createEquipmentNodePatch({
      spec,
      parentId: input.parentId,
      registry: input.registry,
    }),
  }
}

export function compileSingleEquipmentPrompt(input: EquipmentCompileInput): EquipmentCompileResult {
  return compileEquipmentFromSource('prompt', input)
}

export function compileProcessStationEquipment(
  input: EquipmentCompileInput & { station: EquipmentSourceStation },
): EquipmentCompileResult {
  return compileEquipmentFromSource('process-station', input)
}

export function compileManualEquipmentPreset(
  input: EquipmentCompileInput & { preset: EquipmentSourcePreset },
): EquipmentCompileResult {
  return compileEquipmentFromSource('manual-preset', input)
}
