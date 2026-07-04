import { describe, expect, test } from 'bun:test'
import {
  validateSemanticRecipeComposeResult,
  validateSemanticRecipeDefinition,
} from '@pascal-app/core'
import { centrifugalPumpRecipe } from './pump-recipe'
import { storageTankRecipe } from './tank-recipe'
import { distillationUnitRecipe } from './distillation-recipe'
import { refineryAuxiliaryUnitRecipe } from './refinery-auxiliary-recipe'
import { refineryReactorUnitRecipe } from './refinery-reactor-recipe'

describe('factory equipment semantic recipes', () => {
  test('storage tank recipe exposes valid editable params', () => {
    const result = storageTankRecipe.compose({
      envelope: { length: 2.4, width: 2.4, height: 3.2 },
      params: { liquidLevel: 0.6, shellOpacity: 0.4 },
    })

    expect(validateSemanticRecipeDefinition(storageTankRecipe)).toEqual([])
    expect(validateSemanticRecipeComposeResult(storageTankRecipe, result)).toEqual([])
    expect(storageTankRecipe.editableParams?.map((param) => param.key)).toEqual([
      'liquidLevel',
      'shellOpacity',
      'liquidOpacity',
      'liquidColor',
    ])
  })

  test('centrifugal pump recipe exposes valid editable params', () => {
    const result = centrifugalPumpRecipe.compose({
      envelope: { length: 2.6, width: 1.1, height: 1.4 },
      params: { casingColor: '#ef4444', motorColor: '#0f172a', motorPower: 22 },
    })

    expect(validateSemanticRecipeDefinition(centrifugalPumpRecipe)).toEqual([])
    expect(validateSemanticRecipeComposeResult(centrifugalPumpRecipe, result)).toEqual([])
    expect(centrifugalPumpRecipe.editableParams?.map((param) => param.key)).toEqual([
      'casingColor',
      'motorColor',
      'motorPower',
    ])
  })

  test('distillation unit recipe adapts editable roles for refinery profiles', () => {
    const atmospheric = distillationUnitRecipe.compose({
      profileId: 'refinery.atmospheric_distillation_unit',
      envelope: { length: 10.5, width: 6, height: 13.5 },
      params: { columnColor: '#e5e7eb', heaterColor: '#737373' },
    })
    const vacuum = distillationUnitRecipe.compose({
      profileId: 'refinery.vacuum_distillation_unit',
      envelope: { length: 6.8, width: 4.4, height: 11.8 },
      params: { columnKind: 'vacuum' },
    })

    expect(validateSemanticRecipeDefinition(distillationUnitRecipe)).toEqual([])
    expect(validateSemanticRecipeComposeResult(distillationUnitRecipe, atmospheric)).toEqual([])
    expect(validateSemanticRecipeComposeResult(distillationUnitRecipe, vacuum)).toEqual([])
    expect(atmospheric.primarySemanticRole).toBe('distillation_column_shell')
    expect(vacuum.primarySemanticRole).toBe('vacuum_column_shell')
    expect(atmospheric.editableParams?.map((param) => param.key)).toEqual([
      'columnColor',
      'columnOpacity',
      'heaterColor',
      'exchangerColor',
      'manifoldColor',
    ])
    expect(vacuum.corePartRoles).toContain('heat_exchanger_shell')
    expect(vacuum.corePartRoles).toContain('vacuum_heater')
    expect(atmospheric.parts.map((part) => part.kind)).toContain('helical_ladder')
    expect(vacuum.parts.map((part) => part.kind)).toContain('helical_ladder')
    expect(atmospheric.parts.map((part) => part.semanticRole)).toContain('external_spiral_ladder')
    expect(atmospheric.editablePartRoles).toContain('helical_ladder_tread')
    expect(atmospheric.editablePartRoles).toContain('helical_ladder_guard_rail')
  })

  test('refinery reactor recipe covers major refinery reactor profiles', () => {
    const profiles = [
      'refinery.fluid_catalytic_cracking_unit',
      'refinery.hydrotreating_unit',
      'refinery.catalytic_reformer_unit',
      'refinery.sulfur_recovery_unit',
    ]

    expect(validateSemanticRecipeDefinition(refineryReactorUnitRecipe)).toEqual([])
    for (const profileId of profiles) {
      const result = refineryReactorUnitRecipe.compose({
        profileId,
        envelope: { length: 7.2, width: 4.2, height: 7.2 },
      })

      expect(validateSemanticRecipeComposeResult(refineryReactorUnitRecipe, result)).toEqual([])
      expect(result.parts.length).toBeGreaterThanOrEqual(5)
      expect(result.primarySemanticRole).toBeTruthy()
      expect(result.corePartRoles?.length).toBeGreaterThanOrEqual(3)
      expect(result.editableParams?.map((param) => param.key)).toContain('primaryVesselColor')
    }
  })

  test('refinery auxiliary recipe covers flare, pipe rack, and boiler profiles', () => {
    const profiles = [
      'refinery.flare_system',
      'refinery.pipe_rack',
      'refinery.utility_boiler',
    ]

    expect(validateSemanticRecipeDefinition(refineryAuxiliaryUnitRecipe)).toEqual([])
    for (const profileId of profiles) {
      const result = refineryAuxiliaryUnitRecipe.compose({
        profileId,
        envelope: { length: 5, width: 2, height: 4 },
      })

      expect(validateSemanticRecipeComposeResult(refineryAuxiliaryUnitRecipe, result)).toEqual([])
      expect(result.parts.length).toBeGreaterThanOrEqual(3)
      expect(result.primarySemanticRole).toBeTruthy()
      expect(result.corePartRoles?.length).toBeGreaterThanOrEqual(2)
      expect(result.editableParams?.map((param) => param.key)).toContain('primaryColor')
    }
  })
})
