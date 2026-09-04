import { describe, expect, test } from 'bun:test'
import {
  isCatalogItem,
  parseCatalogResponse,
  parseGenerationConfiguration,
  parseReferenceRender,
} from './api'

const item = {
  id: 'globe',
  title: 'Articulated globe',
  source: 'articraft-10k',
  artifact: { format: 'urdf', url: 'https://assets.example/model.urdf' },
  dimensions: [1, 1, 1],
  parts: [],
  joints: [],
  defaultJointValues: {},
  attribution: {
    creator: 'Articraft authors',
    license: 'CC-BY-4.0',
    sourceUrl: 'https://huggingface.co/datasets/camvsl/Articraft-10K',
  },
}

describe('Articraft API parsing', () => {
  test('accepts a node-ready catalog response', () => {
    expect(isCatalogItem(item)).toBe(true)
    expect(
      parseCatalogResponse({
        categories: [{ name: 'Other', count: 1 }],
        items: [item],
        page: 1,
        pageSize: 24,
        total: 1,
      }).total,
    ).toBe(1)
  })

  test('rejects incomplete catalog records', () => {
    expect(() =>
      parseCatalogResponse({
        categories: [],
        items: [{ id: 'broken' }],
        page: 1,
        pageSize: 24,
        total: 1,
      }),
    ).toThrow('invalid response')
  })

  test('requires generated references to be persisted as project files', () => {
    expect(
      parseReferenceRender({
        id: 'asset_reference',
        status: 'completed',
        image_url: 'https://assets.example/reference.png',
        provider: 'google',
        model: 'gemini-3.1-flash-image',
        project_image: {
          id: 'asset_reference',
          name: 'articraft-reference.png',
          url: 'https://assets.example/reference.png',
        },
      }).projectImage.id,
    ).toBe('asset_reference')

    expect(() =>
      parseReferenceRender({
        id: 'orphaned-reference',
        status: 'completed',
        image_url: 'https://assets.example/reference.png',
        provider: 'azure-openai',
        model: 'gpt-image-2',
      }),
    ).toThrow('project file')
  })

  test('accepts the host-selected articulation engine', () => {
    expect(
      parseGenerationConfiguration({
        generation: {
          ready: true,
          provider: 'openai',
          model: 'gpt-5.6',
          models: [
            { provider: 'openai', model: 'gpt-5.6', label: 'GPT-5.6' },
            {
              provider: 'anthropic',
              model: 'claude-sonnet-5',
              label: 'Claude Sonnet 5',
            },
          ],
        },
      }),
    ).toEqual({
      ready: true,
      provider: 'openai',
      model: 'gpt-5.6',
      models: [
        { provider: 'openai', model: 'gpt-5.6', label: 'GPT-5.6' },
        {
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          label: 'Claude Sonnet 5',
        },
      ],
    })

    expect(() =>
      parseGenerationConfiguration({
        generation: {
          ready: true,
          provider: 'unknown',
          model: 'custom',
          models: [{ provider: 'unknown', model: 'custom', label: 'Custom' }],
        },
      }),
    ).toThrow('engine configuration')
  })
})
