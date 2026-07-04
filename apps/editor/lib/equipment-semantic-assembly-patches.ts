import {
  assertSemanticRecipeComposeResult,
  semanticRecipeRegistry,
  type EquipmentParamValue,
} from '@pascal-app/core'
import { composePartPrimitives, type PartComposeInput } from '@pascal-app/core/lib/part-compose'
import {
  type PrimitiveShapeInput,
  resolvePrimitiveWorldTransforms,
} from '@pascal-app/core/lib/primitive-compose'
import {
  computeGeneratedAssemblyPosition,
  createGeneratedGeometryId,
  formatGeneratedShapeDetails,
  type GeneratedGeometryArtifact,
  inferGeneratedAssemblyName,
} from '../../../packages/editor/src/lib/ai-generated-geometry-core'
import {
  buildGeneratedGeometryCreatePatches,
  type GeneratedGeometryPatchPlan,
  type GeneratedGeometryPlacementSpec,
} from '../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import type { SemanticEquipmentSpec } from './equipment-binding-resolver'

function numberParam(params: Record<string, EquipmentParamValue>, key: string, fallback: number) {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function colorParam(params: Record<string, EquipmentParamValue>, key: string, fallback: string) {
  const value = params[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function createSemanticAssemblyPatchPlan(input: {
  spec: SemanticEquipmentSpec
  placement?: GeneratedGeometryPlacementSpec
  prompt?: string
}): GeneratedGeometryPatchPlan | null {
  const recipe = semanticRecipeRegistry.get(input.spec.recipeId)
  if (!recipe) return null
  const length = numberParam(input.spec.params, 'length', recipe.defaultEnvelope?.length ?? 2)
  const width = numberParam(
    input.spec.params,
    'width',
    numberParam(input.spec.params, 'diameter', recipe.defaultEnvelope?.width ?? 1),
  )
  const height = numberParam(input.spec.params, 'height', recipe.defaultEnvelope?.height ?? 1.5)
  const result = recipe.compose({
    params: input.spec.params,
    profileId: input.spec.profileId,
    envelope: { length, width, height },
  })
  assertSemanticRecipeComposeResult(recipe, result)
  if (!result.parts.length) return null
  const sourceArgs: PartComposeInput = {
    name:
      typeof input.spec.params.name === 'string'
        ? input.spec.params.name
        : recipe.label,
    family: recipe.family,
    category: recipe.label,
    detail: 'high',
    length,
    width,
    depth: width,
    height,
    parts: result.parts,
    autoComplete: false,
    enhanceVisualDetails: false,
    registryPartPlan: true,
    primaryColor: colorParam(input.spec.params, 'casingColor', colorParam(input.spec.params, 'shellColor', '#cbd5e1')),
    metalColor: '#cbd5e1',
    darkColor: '#1f2937',
    accentColor: '#f59e0b',
  } as PartComposeInput
  const shapes = composePartPrimitives(sourceArgs) as PrimitiveShapeInput[]
  if (!shapes.length) return null
  const artifactShapes: GeneratedGeometryArtifact['shapes'] = shapes.map((shape) => ({
    ...shape,
    position: shape.position ?? [0, 0, 0],
    rotation: shape.rotation ?? [0, 0, 0],
  }))
  const transforms = resolvePrimitiveWorldTransforms(artifactShapes, {
    positionMode: 'world-center',
  })
  const assemblyPosition = computeGeneratedAssemblyPosition(transforms)
  const artifact: GeneratedGeometryArtifact = {
    id: createGeneratedGeometryId(),
    title: sourceArgs.name ?? recipe.label,
    sourceTool: 'semantic_recipe',
    sourceArgs: {
      profileId: input.spec.profileId,
      recipeId: input.spec.recipeId,
      family: recipe.family,
      length,
      width,
      height,
      primarySemanticRole: result.primarySemanticRole,
      recipeParams: input.spec.params,
    },
    userPrompt: input.prompt ?? input.spec.profileId,
    version: 1,
    createdAt: new Date().toISOString(),
    shapes: artifactShapes,
    transforms,
    assemblyName: inferGeneratedAssemblyName(
      'semantic_recipe',
      sourceArgs as Record<string, unknown>,
      artifactShapes,
    ),
    assemblyPosition,
    createdNames: artifactShapes.map((shape) => shape.name ?? shape.kind),
    shapeDetails: formatGeneratedShapeDetails(artifactShapes, transforms),
    geometryBrief: {
      category: recipe.family,
      units: 'meters',
      expectedDimensions: { length, width, height },
      requiredRoles: [...(result.corePartRoles ?? recipe.corePartRoles ?? [])],
      semanticRoles: [...(result.corePartRoles ?? recipe.corePartRoles ?? [])],
    },
  }
  const placement = input.placement ?? {}
  return buildGeneratedGeometryCreatePatches(artifact, {
    ...placement,
    position: input.spec.position ?? placement.position,
    rotation: input.spec.rotation ?? placement.rotation,
    metadata: {
      generatedBy: 'equipment-spec-compiler',
      equipmentProfileId: input.spec.profileId,
      recipeId: input.spec.recipeId,
      resolver: 'semantic-assembly',
      resolverReason: 'equipment binding compiled to editable semantic assembly',
      equipmentAssembly: {
        kind: 'semantic-assembly',
        profileId: input.spec.profileId,
        recipeId: input.spec.recipeId,
        recipeSource: 'industry-binding',
        equipmentFamily: recipe.family,
        params: input.spec.params,
        primarySemanticRole: result.primarySemanticRole,
        envelope: { length, width, height, origin: 'profile' },
        ports: result.ports ?? [],
        editableParams: [
          ...(result.editableParams ?? recipe.editableParams ?? []),
        ],
        editablePartRoles: [...(result.editablePartRoles ?? recipe.editablePartRoles ?? [])],
      },
      equipmentContract: {
        profileId: input.spec.profileId,
        recipeId: input.spec.recipeId,
        equipmentFamily: recipe.family,
        scaleClass: 'industry-profile',
        envelope: { length, width, height, origin: 'profile' },
        ports: result.ports ?? [],
      },
      ...(input.spec.metadata ?? {}),
    },
  })
}
