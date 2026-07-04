import { beforeEach, describe, expect, test } from 'bun:test'
import {
  assertSemanticRecipeComposeResult,
  registerSemanticRecipe,
  semanticRecipeRegistry,
  validateSemanticRecipeComposeResult,
  validateSemanticRecipeDefinition,
  type SemanticRecipeDefinition,
} from './semantic-recipes'

function recipe(id: string): SemanticRecipeDefinition {
  return {
    id,
    label: id,
    family: 'test',
    acceptsProfiles: [`${id}.profile`],
    compose: () => ({ parts: [] }),
  }
}

describe('semantic recipe registry', () => {
  beforeEach(() => {
    semanticRecipeRegistry._reset()
  })

  test('registers and retrieves recipes', () => {
    const def = recipe('test:recipe')
    registerSemanticRecipe(def)

    expect(semanticRecipeRegistry.size).toBe(1)
    expect(semanticRecipeRegistry.get('test:recipe')).toBe(def)
    expect(semanticRecipeRegistry.has('test:recipe')).toBe(true)
  })

  test('rejects duplicate recipe ids', () => {
    registerSemanticRecipe(recipe('test:recipe'))

    expect(() => registerSemanticRecipe(recipe('test:recipe'))).toThrow(
      'duplicate semantic recipe id',
    )
  })

  test('finds a recipe by accepted profile id', () => {
    registerSemanticRecipe(recipe('test:recipe'))

    expect(semanticRecipeRegistry.findByProfile('TEST:RECIPE.PROFILE')?.id).toBe('test:recipe')
    expect(semanticRecipeRegistry.findByProfile('missing.profile')).toBeUndefined()
  })

  test('rejects malformed editable param declarations during registration', () => {
    const invalid: SemanticRecipeDefinition = {
      ...recipe('test:invalid'),
      editableParams: [
        {
          key: 'opacity',
          kind: 'number',
          min: 1,
          max: 0,
          effects: [
            {
              kind: 'set-part-material',
              partRole: '',
              property: 'opacity',
            },
          ],
        },
      ],
    }

    expect(validateSemanticRecipeDefinition(invalid).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'editable_param_range_invalid',
        'editable_effect_part_role_missing',
      ]),
    )
    expect(() => registerSemanticRecipe(invalid)).toThrow('invalid semantic recipe')
  })

  test('validates editable effect target roles against composed recipe parts', () => {
    const def: SemanticRecipeDefinition = {
      ...recipe('test:editable'),
      editableParams: [
        {
          key: 'shellOpacity',
          kind: 'number',
          effects: [
            {
              kind: 'set-part-material',
              partRole: 'missing_shell',
              property: 'opacity',
            },
          ],
        },
      ],
      editablePartRoles: ['missing_shell'],
      corePartRoles: ['missing_core'],
      compose: () => ({
        parts: [{ id: 'shell', kind: 'box', semanticRole: 'vessel_shell' }],
      }),
    }

    const result = def.compose({})
    const issues = validateSemanticRecipeComposeResult(def, result)

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'editable_effect_part_role_missing_in_parts',
        'semantic_role_missing',
      ]),
    )
    expect(() => assertSemanticRecipeComposeResult(def, result)).toThrow(
      'missing semantic part role "missing_shell"',
    )
  })

  test('accepts editable params that target composed semantic parts', () => {
    const def: SemanticRecipeDefinition = {
      ...recipe('test:valid-editable'),
      editableParams: [
        {
          key: 'liquidLevel',
          kind: 'number',
          min: 0,
          max: 1,
          effects: [
            { kind: 'set-param' },
            {
              kind: 'set-part-dynamic-level',
              partRole: 'liquid_volume',
              geometryRef: 'dynamicLevelGeometry',
            },
          ],
        },
      ],
      editablePartRoles: ['vessel_shell', 'liquid_volume'],
      corePartRoles: ['vessel_shell'],
      compose: () => ({
        parts: [
          { id: 'shell', kind: 'box', semanticRole: 'vessel_shell' },
          { id: 'liquid', kind: 'box', semanticRole: 'liquid_volume' },
        ],
      }),
    }

    expect(validateSemanticRecipeDefinition(def)).toEqual([])
    expect(validateSemanticRecipeComposeResult(def, def.compose({}))).toEqual([])
  })
})
