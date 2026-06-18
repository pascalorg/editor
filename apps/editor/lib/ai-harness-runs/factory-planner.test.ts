import { describe, expect, test } from 'bun:test'
import {
  fallbackFactoryPlan,
  parseFactoryPlan,
  buildFactoryPlannerPrompt,
  shouldPreferFallbackFactoryPlan,
} from './factory-planner'

describe('factory planner', () => {
  test('routes house requests to layout instead of geometry', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u623f\u5b50')

    expect(plan).toMatchObject({
      kind: 'layout',
      layoutType: 'house',
    })
    if (plan.kind === 'layout') {
      expect(plan.suggestedOperations).toContain('create_room')
    }
  })

  test('routes known catalog items to catalog_item', () => {
    const plan = fallbackFactoryPlan('factory straight pipe')

    expect(plan).toMatchObject({
      kind: 'catalog_item',
      catalogItemId: 'factory-straight-pipe',
    })
  })

  test('routes custom equipment to geometry', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u53f0\u8f93\u9001\u673a')

    expect(plan.kind).toBe('geometry')
  })

  test('routes chemical factory reactor equipment to geometry instead of factory layout', () => {
    const plan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u5316\u5de5\u5382\u7684\u53cd\u5e94\u91dc\u88c5\u7f6e',
    )

    expect(plan).toMatchObject({
      kind: 'geometry',
      equipmentName: '\u751f\u6210\u4e00\u4e2a\u5316\u5de5\u5382\u7684\u53cd\u5e94\u91dc\u88c5\u7f6e',
    })
  })

  test('prefers geometry fallback when LLM mistakes equipment context for factory layout', () => {
    const fallbackPlan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u5316\u5de5\u5382\u7684\u53cd\u5e94\u91dc\u88c5\u7f6e',
    )
    const llmPlan = {
      kind: 'layout' as const,
      reason: 'chemical factory background',
      layoutType: 'factory' as const,
      suggestedOperations: ['create_room'],
    }

    expect(fallbackPlan.kind).toBe('geometry')
    expect(shouldPreferFallbackFactoryPlan(llmPlan, fallbackPlan)).toBe(true)
  })

  test('keeps full production lines on the layout route even if LLM asks for geometry', () => {
    const fallbackPlan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u676112\u7c73\u957f\u7684\u74f6\u88c5\u996e\u6599\u704c\u88c5\u4ea7\u7ebf',
    )
    const llmPlan = {
      kind: 'geometry' as const,
      reason: 'generate a custom machine',
      equipmentName: '\u74f6\u88c5\u996e\u6599\u704c\u88c5\u4ea7\u7ebf',
    }

    expect(fallbackPlan).toMatchObject({
      kind: 'layout',
      layoutType: 'production_line',
    })
    expect(shouldPreferFallbackFactoryPlan(llmPlan, fallbackPlan)).toBe(true)
  })

  test('prefers production-line fallback when LLM only sees a generic factory layout', () => {
    const fallbackPlan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u676112\u7c73\u957f\u7684\u4ea7\u7ebf\uff0c\u653e\u5728\u5382\u623f\u4e2d\u95f4',
    )
    const llmPlan = {
      kind: 'layout' as const,
      reason: 'factory shell',
      layoutType: 'factory' as const,
      suggestedOperations: ['create_room'],
    }

    expect(fallbackPlan).toMatchObject({
      kind: 'layout',
      layoutType: 'production_line',
    })
    expect(shouldPreferFallbackFactoryPlan(llmPlan, fallbackPlan)).toBe(true)
  })

  test('parses fenced JSON planner output', () => {
    const plan = parseFactoryPlan(
      '```json\n{"kind":"layout","reason":"room work","layoutType":"room","suggestedOperations":["create_room"]}\n```',
      '\u521b\u5efa\u623f\u95f4',
    )

    expect(plan).toEqual({
      kind: 'layout',
      reason: 'room work',
      layoutType: 'room',
      suggestedOperations: ['create_room'],
    })
  })

  test('planner prompt includes strict output schema', () => {
    const prompt = buildFactoryPlannerPrompt('\u751f\u6210\u4e00\u4e2a\u8f66\u95f4')

    expect(prompt).toContain('"kind": "layout" | "catalog_item" | "geometry" | "missing"')
    expect(prompt).toContain('User request: \u751f\u6210\u4e00\u4e2a\u8f66\u95f4')
  })
})
