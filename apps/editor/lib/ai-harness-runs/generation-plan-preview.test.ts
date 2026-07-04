import { describe, expect, test } from 'bun:test'
import { buildGenerationPlanPreview } from './generation-plan-preview'
import { routeAiIntent } from './intent-router'

describe('generation plan preview', () => {
  test('blocks factory previews when the required industry pack is missing', () => {
    const route = routeAiIntent({
      prompt: '生成一个炼油厂',
      installedPacks: [],
    })

    const preview = buildGenerationPlanPreview({ route })

    expect(preview).toMatchObject({
      routeKind: 'create-factory',
      execution: 'factory',
      applyMode: 'blocked',
      canvasImpact: 'high',
      requiredPack: {
        id: 'industry.refinery.basic',
        installed: false,
      },
    })
    expect(preview.blockers).toContain('install-required-industry-pack')
    expect(
      preview.steps.some((step) => step.id === 'check-pack' && step.status === 'blocked'),
    ).toBe(true)
  })

  test('requires confirmation for installed pack factory generation', () => {
    const route = routeAiIntent({
      prompt: '生成一个炼油厂',
      installedPacks: [{ id: 'industry.refinery.basic', version: '0.1.0' }],
    })

    const preview = buildGenerationPlanPreview({ route })

    expect(preview).toMatchObject({
      routeKind: 'create-factory',
      applyMode: 'confirm',
      canvasImpact: 'high',
    })
    expect(preview.steps.every((step) => step.status !== 'blocked')).toBe(true)
  })

  test('keeps selected part edits direct and low impact', () => {
    const route = routeAiIntent({
      prompt: '把外壳颜色改成蓝色',
      selection: {
        nodeIds: ['shell_1'],
        assemblyId: 'pump_1',
        semanticRole: 'housing',
      },
    })

    const preview = buildGenerationPlanPreview({ route })

    expect(preview).toMatchObject({
      routeKind: 'edit-selected-part',
      applyMode: 'direct',
      canvasImpact: 'low',
      selectedNodeIds: ['shell_1'],
    })
  })
})
