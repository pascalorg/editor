import {
  assertSemanticRecipeComposeResult,
  semanticRecipeRegistry,
  type SemanticRecipeComposeResult,
} from '@pascal-app/core'
import type {
  ProcessConnectionMedium,
  ProcessEquipmentContract,
  ProcessEquipmentEnvelope,
  ProcessEquipmentPort,
  ProcessEquipmentPortSide,
} from './process-line-types'
import { ensureFactorySemanticRecipesRegistered } from './factory-semantic-recipe-registry'

const PROCESS_MEDIUMS = new Set<ProcessConnectionMedium>([
  'water',
  'hydrogen',
  'oxygen',
  'power',
  'cooling',
  'material',
  'gas',
  'molten_metal',
])

const PROCESS_PORT_SIDES = new Set<ProcessEquipmentPortSide>([
  'left',
  'right',
  'front',
  'back',
  'top',
])

function processMedium(value: string | undefined, fallback: ProcessConnectionMedium): ProcessConnectionMedium {
  return value && PROCESS_MEDIUMS.has(value as ProcessConnectionMedium)
    ? (value as ProcessConnectionMedium)
    : fallback
}

function processSide(value: string, fallback: ProcessEquipmentPortSide): ProcessEquipmentPortSide {
  return PROCESS_PORT_SIDES.has(value as ProcessEquipmentPortSide)
    ? (value as ProcessEquipmentPortSide)
    : fallback
}

function recipeEnvelope(
  fallback: ProcessEquipmentEnvelope,
  result: SemanticRecipeComposeResult,
): ProcessEquipmentEnvelope {
  return {
    length: result.envelope?.length ?? fallback.length,
    width: result.envelope?.width ?? fallback.width,
    height: result.envelope?.height ?? fallback.height,
    origin: fallback.origin,
    tolerance: result.envelope?.tolerance ?? fallback.tolerance,
  }
}

function recipePorts(
  fallback: ProcessEquipmentPort[],
  result: SemanticRecipeComposeResult,
): ProcessEquipmentPort[] {
  if (!result.ports?.length) return fallback
  const fallbackMedium = fallback[0]?.medium ?? 'material'
  return result.ports.map((port) => ({
    id: port.id,
    medium: processMedium(port.medium, fallbackMedium),
    side: processSide(port.side, fallback[0]?.side ?? 'left'),
    height: port.height,
    ...(typeof port.offset === 'number' ? { offset: port.offset } : {}),
    ...(port.direction ? { direction: port.direction } : {}),
  }))
}

export type CompiledEquipmentRecipe = {
  recipeId: string
  recipe: NonNullable<ReturnType<typeof semanticRecipeRegistry.get>>
  result: SemanticRecipeComposeResult
  contract: ProcessEquipmentContract
}

export function compileEquipmentRecipeContract(
  contract: ProcessEquipmentContract,
): CompiledEquipmentRecipe | null {
  ensureFactorySemanticRecipesRegistered()
  const recipeId = contract.recipeId
  if (!recipeId) return null
  const recipe = semanticRecipeRegistry.get(recipeId)
  if (!recipe) return null
  const result = recipe.compose({
    params: contract.recipeParams,
    profileId: contract.profileId,
    envelope: contract.envelope,
    medium: contract.ports[0]?.medium,
  })
  assertSemanticRecipeComposeResult(recipe, result)
  return {
    recipeId,
    recipe,
    result,
    contract: {
      ...contract,
      envelope: recipeEnvelope(contract.envelope, result),
      ports: recipePorts(contract.ports, result),
      requiredRoles: [...(result.editablePartRoles ?? recipe.editablePartRoles ?? contract.requiredRoles ?? [])],
      primarySemanticRole:
        result.primarySemanticRole ?? contract.primarySemanticRole ?? recipe.corePartRoles?.[0],
      profileParts: result.parts.map((part) => ({ ...part })),
      editableParams: result.editableParams ?? recipe.editableParams,
      recipeSource: contract.recipeSource ?? 'plugin-recipe',
    },
  }
}
