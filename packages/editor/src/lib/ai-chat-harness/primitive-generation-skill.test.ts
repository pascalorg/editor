import { describe, expect, test } from 'bun:test'
import { buildPrimitiveGenerationSkillPrompt } from './primitive-generation-skill'
import {
  PRIMITIVE_STAGE1_ANALYST_PROMPT,
  PRIMITIVE_STAGE2_GENERATOR_PROMPT,
} from './primitive-system-prompts'

describe('primitive generation skill prompt', () => {
  test('steers shaft and blade assemblies to reusable parts instead of recipes', () => {
    const prompt = buildPrimitiveGenerationSkillPrompt()

    expect(prompt).toContain('propeller_blade_set')
    expect(prompt).toContain('Do not create/use a recipe')
    expect(prompt).toContain('connectTo')
    expect(prompt).toContain('same horizontal level')
    expect(prompt).toContain('hemisphere')
    expect(prompt).toContain('ellipsoid_shell')
    expect(prompt).toContain('curved_panel')
    expect(prompt).toContain('lofted_shell')
    expect(prompt).toContain('chimney_stack')
    expect(prompt).toContain('warningStripes:true')
    expect(prompt).toContain('not vertical_pole/circular_base')
  })

  test('feeds the shared generation skill and geometry rules into the actual stage prompts', () => {
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('PRIMITIVE GENERATION SKILL')
    expect(PRIMITIVE_STAGE2_GENERATOR_PROMPT).toContain('PRIMITIVE GENERATION SKILL')
    expect(PRIMITIVE_STAGE2_GENERATOR_PROMPT).toContain('Coordinate convention: +Y is up')
    expect(PRIMITIVE_STAGE2_GENERATOR_PROMPT).toContain('length=X, width=Z, height=Y')
    expect(PRIMITIVE_STAGE2_GENERATOR_PROMPT).toContain('Tool arguments must be strict JSON only')
    expect(PRIMITIVE_STAGE2_GENERATOR_PROMPT).toContain('protective_grill')
    expect(PRIMITIVE_STAGE2_GENERATOR_PROMPT).toContain('radial_blades')
    expect(PRIMITIVE_STAGE2_GENERATOR_PROMPT).toContain('volute_casing')
    expect(PRIMITIVE_STAGE2_GENERATOR_PROMPT).toContain('chimney_stack')
  })
})
