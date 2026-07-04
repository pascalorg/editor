import type { EquipmentParamValue } from '../equipment'
import type { PartComposePartInput } from '../lib/part-compose'
import type { Vec3 } from '../lib/primitive-compose'

export type SemanticRecipeId = string

export type SemanticRecipePortSide = 'left' | 'right' | 'front' | 'back' | 'top' | 'bottom'

export type SemanticRecipePort = {
  id: string
  role?: string
  medium?: string
  side: SemanticRecipePortSide
  height: number
  offset?: number
  direction?: Vec3
}

export type SemanticRecipeEnvelope = {
  length: number
  width: number
  height: number
  tolerance?: number
}

export type SemanticRecipePart = PartComposePartInput & {
  semanticRole?: string
}

export type SemanticRecipeComposeInput = {
  params?: Record<string, EquipmentParamValue>
  envelope?: Partial<SemanticRecipeEnvelope>
  profileId?: string
  stationId?: string
  medium?: string
}

export type SemanticRecipeComposeResult = {
  parts: SemanticRecipePart[]
  ports?: SemanticRecipePort[]
  envelope?: SemanticRecipeEnvelope
  editableParams?: readonly SemanticRecipeEditableParam[]
  editablePartRoles?: readonly string[]
  corePartRoles?: readonly string[]
  primarySemanticRole?: string
}

export type SemanticRecipeEditableParamKind = 'number' | 'color' | 'boolean' | 'enum'

export type SemanticRecipeEditableParamEffect =
  | {
      kind: 'set-param'
      param?: string
    }
  | {
      kind: 'set-part-material'
      partRole: string
      property: 'color' | 'opacity' | 'roughness' | 'metalness' | 'transparent'
      transparentWhenBelowOne?: boolean
    }
  | {
      kind: 'set-part-dynamic-level'
      partRole: string
      geometryRef: 'dynamicLevelGeometry'
      minSize?: number
    }

export type SemanticRecipeEditableParam = {
  key: string
  label?: string
  kind: SemanticRecipeEditableParamKind
  min?: number
  max?: number
  step?: number
  precision?: number
  unit?: string
  defaultValue?: EquipmentParamValue
  options?: readonly string[]
  effects?: readonly SemanticRecipeEditableParamEffect[]
}

export type SemanticRecipeDefinition = {
  id: SemanticRecipeId
  label: string
  family: string
  acceptsProfiles?: readonly string[]
  paramSchema?: unknown
  defaultEnvelope?: SemanticRecipeEnvelope
  editableParams?: readonly SemanticRecipeEditableParam[]
  editablePartRoles?: readonly string[]
  corePartRoles?: readonly string[]
  compose: (input: SemanticRecipeComposeInput) => SemanticRecipeComposeResult
}

export type SemanticRecipeRegistry = {
  has: (id: SemanticRecipeId) => boolean
  get: (id: SemanticRecipeId) => SemanticRecipeDefinition | undefined
  entries: () => IterableIterator<[SemanticRecipeId, SemanticRecipeDefinition]>
  findByProfile: (profileId: string) => SemanticRecipeDefinition | undefined
  get size(): number
}

export type SemanticRecipeValidationIssue = {
  code: string
  message: string
  path: string
}

const EDITABLE_MATERIAL_PROPERTIES = new Set([
  'color',
  'opacity',
  'roughness',
  'metalness',
  'transparent',
])

function pushIssue(
  issues: SemanticRecipeValidationIssue[],
  code: string,
  path: string,
  message: string,
) {
  issues.push({ code, path, message })
}

function validateEditableParam(
  issues: SemanticRecipeValidationIssue[],
  param: SemanticRecipeEditableParam,
  index: number,
) {
  const path = `editableParams.${index}`
  if (typeof param.key !== 'string' || param.key.trim().length === 0) {
    pushIssue(issues, 'editable_param_key_missing', `${path}.key`, 'Editable param key must be non-empty.')
  }
  if (param.kind === 'number') {
    if (param.min != null && (!Number.isFinite(param.min) || typeof param.min !== 'number')) {
      pushIssue(issues, 'editable_param_min_invalid', `${path}.min`, 'Number param min must be finite.')
    }
    if (param.max != null && (!Number.isFinite(param.max) || typeof param.max !== 'number')) {
      pushIssue(issues, 'editable_param_max_invalid', `${path}.max`, 'Number param max must be finite.')
    }
    if (
      typeof param.min === 'number' &&
      typeof param.max === 'number' &&
      param.min > param.max
    ) {
      pushIssue(issues, 'editable_param_range_invalid', path, 'Number param min must not exceed max.')
    }
    if (param.step != null && (typeof param.step !== 'number' || param.step <= 0)) {
      pushIssue(issues, 'editable_param_step_invalid', `${path}.step`, 'Number param step must be positive.')
    }
  }
  if (param.kind === 'enum') {
    if (!param.options?.length) {
      pushIssue(issues, 'editable_param_enum_options_missing', `${path}.options`, 'Enum param must define options.')
    }
    if (
      typeof param.defaultValue === 'string' &&
      param.options?.length &&
      !param.options.includes(param.defaultValue)
    ) {
      pushIssue(
        issues,
        'editable_param_enum_default_invalid',
        `${path}.defaultValue`,
        'Enum defaultValue must be one of the options.',
      )
    }
  }
  if (param.kind === 'boolean' && param.defaultValue != null && typeof param.defaultValue !== 'boolean') {
    pushIssue(issues, 'editable_param_boolean_default_invalid', `${path}.defaultValue`, 'Boolean defaultValue must be boolean.')
  }
  const effects = param.effects ?? [{ kind: 'set-param' as const }]
  effects.forEach((effect, effectIndex) => {
    const effectPath = `${path}.effects.${effectIndex}`
    if (effect.kind === 'set-param') {
      if (effect.param != null && effect.param.trim().length === 0) {
        pushIssue(issues, 'editable_effect_param_invalid', `${effectPath}.param`, 'set-param target must be non-empty.')
      }
      return
    }
    if (effect.kind === 'set-part-material') {
      if (effect.partRole.trim().length === 0) {
        pushIssue(issues, 'editable_effect_part_role_missing', `${effectPath}.partRole`, 'Material effect partRole must be non-empty.')
      }
      if (!EDITABLE_MATERIAL_PROPERTIES.has(effect.property)) {
        pushIssue(issues, 'editable_effect_material_property_invalid', `${effectPath}.property`, `Unsupported material property: ${effect.property}.`)
      }
      return
    }
    if (effect.kind === 'set-part-dynamic-level') {
      if (effect.partRole.trim().length === 0) {
        pushIssue(issues, 'editable_effect_part_role_missing', `${effectPath}.partRole`, 'Dynamic level effect partRole must be non-empty.')
      }
      if (effect.geometryRef !== 'dynamicLevelGeometry') {
        pushIssue(issues, 'editable_effect_geometry_ref_invalid', `${effectPath}.geometryRef`, 'Dynamic level effect must target dynamicLevelGeometry.')
      }
      if (effect.minSize != null && (typeof effect.minSize !== 'number' || effect.minSize <= 0)) {
        pushIssue(issues, 'editable_effect_min_size_invalid', `${effectPath}.minSize`, 'Dynamic level minSize must be positive.')
      }
      return
    }
    pushIssue(issues, 'editable_effect_kind_invalid', `${effectPath}.kind`, 'Unsupported editable effect kind.')
  })
}

export function validateSemanticRecipeDefinition(
  recipe: SemanticRecipeDefinition,
): SemanticRecipeValidationIssue[] {
  const issues: SemanticRecipeValidationIssue[] = []
  if (typeof recipe.id !== 'string' || recipe.id.length === 0) {
    pushIssue(issues, 'recipe_id_missing', 'id', 'Semantic recipe id must be a non-empty string.')
  }
  if (typeof recipe.compose !== 'function') {
    pushIssue(issues, 'recipe_compose_missing', 'compose', `Semantic recipe "${recipe.id}" must provide compose().`)
  }
  const keys = new Set<string>()
  ;(recipe.editableParams ?? []).forEach((param, index) => {
    validateEditableParam(issues, param, index)
    if (param.key && keys.has(param.key)) {
      pushIssue(issues, 'editable_param_key_duplicate', `editableParams.${index}.key`, `Duplicate editable param key: ${param.key}.`)
    }
    if (param.key) keys.add(param.key)
  })
  return issues
}

function semanticPartRoles(parts: readonly SemanticRecipePart[]) {
  return new Set(
    parts
      .map((part) => part.semanticRole)
      .filter((role): role is string => typeof role === 'string' && role.length > 0),
  )
}

function validateRoleList(
  issues: SemanticRecipeValidationIssue[],
  roles: Set<string>,
  list: readonly string[] | undefined,
  path: string,
) {
  ;(list ?? []).forEach((role, index) => {
    if (!roles.has(role)) {
      pushIssue(issues, 'semantic_role_missing', `${path}.${index}`, `Semantic role "${role}" is not produced by recipe parts.`)
    }
  })
}

export function validateSemanticRecipeComposeResult(
  recipe: SemanticRecipeDefinition,
  result: SemanticRecipeComposeResult,
): SemanticRecipeValidationIssue[] {
  const issues: SemanticRecipeValidationIssue[] = []
  const roles = semanticPartRoles(result.parts)
  const editableParams = result.editableParams ?? recipe.editableParams ?? []
  editableParams.forEach((param, paramIndex) => {
    paramEffects(param).forEach((effect, effectIndex) => {
      if (effect.kind !== 'set-part-material' && effect.kind !== 'set-part-dynamic-level') return
      if (!roles.has(effect.partRole)) {
        pushIssue(
          issues,
          'editable_effect_part_role_missing_in_parts',
          `editableParams.${paramIndex}.effects.${effectIndex}.partRole`,
          `Editable param "${param.key}" targets missing semantic part role "${effect.partRole}".`,
        )
      }
    })
  })
  validateRoleList(issues, roles, result.corePartRoles ?? recipe.corePartRoles, 'corePartRoles')
  return issues
}

function paramEffects(param: SemanticRecipeEditableParam): readonly SemanticRecipeEditableParamEffect[] {
  return param.effects?.length ? param.effects : [{ kind: 'set-param' as const }]
}

function formatValidationIssues(recipeId: string, issues: readonly SemanticRecipeValidationIssue[]) {
  return issues
    .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
    .join('; ')
    .replace(/^/, `[registry] invalid semantic recipe "${recipeId}": `)
}

export function assertSemanticRecipeDefinition(recipe: SemanticRecipeDefinition): void {
  const issues = validateSemanticRecipeDefinition(recipe)
  if (issues.length > 0) throw new Error(formatValidationIssues(recipe.id, issues))
}

export function assertSemanticRecipeComposeResult(
  recipe: SemanticRecipeDefinition,
  result: SemanticRecipeComposeResult,
): void {
  const issues = validateSemanticRecipeComposeResult(recipe, result)
  if (issues.length > 0) throw new Error(formatValidationIssues(recipe.id, issues))
}

class SemanticRecipeRegistryImpl implements SemanticRecipeRegistry {
  private readonly recipes = new Map<SemanticRecipeId, SemanticRecipeDefinition>()

  has(id: SemanticRecipeId): boolean {
    return this.recipes.has(id)
  }

  get(id: SemanticRecipeId): SemanticRecipeDefinition | undefined {
    return this.recipes.get(id)
  }

  entries(): IterableIterator<[SemanticRecipeId, SemanticRecipeDefinition]> {
    return this.recipes.entries()
  }

  findByProfile(profileId: string): SemanticRecipeDefinition | undefined {
    const normalized = profileId.trim().toLowerCase()
    for (const recipe of this.recipes.values()) {
      if (recipe.acceptsProfiles?.some((candidate) => candidate.toLowerCase() === normalized)) {
        return recipe
      }
    }
    return undefined
  }

  get size(): number {
    return this.recipes.size
  }

  _register(recipe: SemanticRecipeDefinition): void {
    assertSemanticRecipeDefinition(recipe)
    if (this.recipes.has(recipe.id)) {
      throw new Error(`[registry] duplicate semantic recipe id: "${recipe.id}" already registered`)
    }
    this.recipes.set(recipe.id, recipe)
  }

  _reset(): void {
    this.recipes.clear()
  }
}

export const semanticRecipeRegistry: SemanticRecipeRegistry & {
  _register: (recipe: SemanticRecipeDefinition) => void
  _reset: () => void
} = new SemanticRecipeRegistryImpl()

export function registerSemanticRecipe(recipe: SemanticRecipeDefinition): void {
  semanticRecipeRegistry._register(recipe)
}
