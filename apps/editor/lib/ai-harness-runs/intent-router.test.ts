import { describe, expect, test } from 'bun:test'
import { routeAiIntent } from './intent-router'

describe('AI intent router', () => {
  test('routes refinery creation through the required installed industry pack', () => {
    const route = routeAiIntent({
      prompt: '生成一个炼油厂',
      installedPacks: [{ id: 'industry.refinery.basic', version: '0.1.0' }],
    })

    expect(route).toMatchObject({
      kind: 'create-factory',
      execution: 'factory',
      requiresPreview: true,
      requiredPack: {
        id: 'industry.refinery.basic',
        installed: true,
      },
      blockers: [],
    })
  })

  test('blocks refinery generation when the industry pack is not installed', () => {
    const route = routeAiIntent({
      prompt: '生成一个炼油厂',
      installedPacks: [],
    })

    expect(route.kind).toBe('create-factory')
    expect(route.requiredPack).toMatchObject({
      id: 'industry.refinery.basic',
      installed: false,
    })
    expect(route.blockers).toContain('install-required-industry-pack')
  })

  test('routes semantic part edits before generic equipment edits', () => {
    const route = routeAiIntent({
      prompt: '把内壁透明度调到 30%',
      selection: {
        nodeIds: ['part_inner_wall'],
        assemblyId: 'tank_1',
        semanticRole: 'inner-wall',
      },
    })

    expect(route).toMatchObject({
      kind: 'edit-selected-part',
      execution: 'factory',
      requiresPreview: false,
    })
  })

  test('routes known equipment creation to factory recipe execution', () => {
    const route = routeAiIntent({
      prompt: '生成一个储罐，液位 60%',
      installedPacks: [],
    })

    expect(route).toMatchObject({
      kind: 'create-equipment',
      execution: 'factory',
    })
  })

  test('routes live data binding only when a target is selected', () => {
    const route = routeAiIntent({
      prompt: '绑定 websocket 实时数据',
    })

    expect(route).toMatchObject({
      kind: 'bind-live-data',
      execution: 'data-binding',
      blockers: ['select-target-node'],
    })
  })

  test('routes image prompts to image-to-3d', () => {
    const route = routeAiIntent({
      prompt: '根据这张图片生成设备',
      imageAttached: true,
    })

    expect(route).toMatchObject({
      kind: 'create-asset-from-image',
      execution: 'image-to-3d',
    })
  })
})
