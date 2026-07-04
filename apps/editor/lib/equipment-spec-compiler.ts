import type { AnyNodeId, EquipmentParamValue, SemanticRecipeRegistry, Vec3 } from '@pascal-app/core'
import {
  createEquipmentSpecFromV2Binding,
  resolveEquipmentBinding,
  type SemanticEquipmentSpec,
  type EquipmentSourcePreset,
  type EquipmentSourceStation,
} from './equipment-binding-resolver'
import {
  createGenericEquipmentDraft,
  type GenericEquipmentDraft,
} from './equipment-node-patches'
import { createSemanticAssemblyPatchPlan } from './equipment-semantic-assembly-patches'
import type { GeneratedGeometryPatchPlan } from '../../../packages/editor/src/lib/ai-generated-geometry-nodes'
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
  registry?: SemanticRecipeRegistry
}

export type EquipmentCompileResult =
  | {
      kind: 'semantic-assembly'
      spec: SemanticEquipmentSpec
      patchPlan: GeneratedGeometryPatchPlan
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

  const patchPlan = createSemanticAssemblyPatchPlan({
    spec,
    prompt: input.prompt,
    placement: {
      parentId: input.parentId ?? undefined,
      position: input.position,
      rotation: input.rotation,
    },
  })
  if (!patchPlan) {
    return {
      kind: 'generic-equipment-draft',
      draft: createGenericEquipmentDraft({
        source,
        prompt: input.prompt,
        stationId: input.station?.id,
        presetId: input.preset?.id,
        reason: `Equipment recipe "${spec.recipeId}" could not produce a semantic assembly.`,
      }),
    }
  }

  return {
    kind: 'semantic-assembly',
    spec,
    patchPlan,
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
