import { describe, expect, test } from 'bun:test'
import { buildAiIntentPreview } from './intent-preview-service'

describe('AI intent preview service', () => {
  test('builds a blocked preview for a missing required industry pack', () => {
    const response = buildAiIntentPreview({
      request: { prompt: '生成一个炼油厂', generationMode: 'factory' },
      installedPacks: [],
      previewId: 'preview_test',
    })

    expect(response.route).toMatchObject({
      kind: 'create-factory',
      requiredPack: {
        id: 'industry.refinery.basic',
        installed: false,
      },
    })
    expect(response.preview).toMatchObject({
      id: 'preview_test',
      applyMode: 'blocked',
      canvasImpact: 'high',
    })
  })

  test('builds a confirm preview for an installed industry pack factory request', () => {
    const response = buildAiIntentPreview({
      request: { prompt: '生成一个炼油厂' },
      installedPacks: [{ id: 'industry.refinery.basic', version: '0.1.0', enabled: true }],
    })

    expect(response.preview).toMatchObject({
      routeKind: 'create-factory',
      applyMode: 'confirm',
    })
    expect(response.route.blockers).toEqual([])
  })
})
