import { describe, expect, test } from 'bun:test'
import {
  knownIndustryPackRequirements,
  resolveIndustryPackRequirement,
} from './industry-pack-intent-resolver'

describe('industry pack intent resolver', () => {
  test('requires the refinery pack for refinery prompts', () => {
    const requirement = resolveIndustryPackRequirement({
      prompt: '生成一个炼油厂',
      installedPacks: [],
    })

    expect(requirement).toMatchObject({
      id: 'industry.refinery.basic',
      version: '0.1.0',
      industry: 'refinery',
      installed: false,
      installState: 'missing',
    })
  })

  test('marks a matching pack as installed when enabled and version matches', () => {
    const requirement = resolveIndustryPackRequirement({
      prompt: 'generate an oil refinery',
      installedPacks: [{ id: 'industry.refinery.basic', version: '0.1.0', enabled: true }],
    })

    expect(requirement).toMatchObject({
      id: 'industry.refinery.basic',
      installed: true,
      installState: 'installed',
    })
  })

  test('does not treat disabled packs as installed', () => {
    const requirement = resolveIndustryPackRequirement({
      prompt: '生成一个水泥厂',
      installedPacks: [{ id: 'industry.cement.basic', version: '0.1.0', enabled: false }],
    })

    expect(requirement).toMatchObject({
      id: 'industry.cement.basic',
      installed: false,
      installState: 'missing',
    })
  })

  test('exposes known pack requirements for UI catalog hints', () => {
    expect(knownIndustryPackRequirements()).toContainEqual({
      id: 'industry.refinery.basic',
      version: '0.1.0',
      industry: 'refinery',
      label: 'Refinery',
    })
  })
})
