import { describe, expect, test } from 'bun:test'
import {
  buildFactoryAgentSystemPrompt,
  buildFactoryCatalogSummary,
  buildFactoryGeometryRequestPrompt,
} from './factory-agent-prompt'

describe('factory agent prompt', () => {
  test('summarizes shared catalog items for factory decisions', () => {
    const summary = buildFactoryCatalogSummary({ query: 'factory pipe', maxItems: 20 })

    expect(summary).toContain('Catalog size:')
    expect(summary).toContain('id:factory-straight-pipe')
    expect(summary).toContain('id:factory-extractor')
  })

  test('explains catalog item, native process-line, layout, and geometry fallback decisions', () => {
    const prompt = buildFactoryAgentSystemPrompt({ query: 'conveyor line', maxItems: 20 })

    expect(prompt).toContain('If the user asks for a room, house')
    expect(prompt).toContain('matching catalog item exists')
    expect(prompt).toContain(
      'For production lines, resolve each station in order: native node first',
    )
    expect(prompt).toContain('call the geometry generation service')
    expect(prompt).toContain('SCENE / MCP LAYOUT CAPABILITIES')
    expect(prompt).toContain('GEOMETRY GENERATION CAPABILITIES')
    expect(prompt).toContain('Do not use geometry generation for whole houses')
  })

  test('builds geometry request prompt with capability context', () => {
    const prompt = buildFactoryGeometryRequestPrompt({
      userRequest: '生成一条包装产线，缺少贴标机',
      equipmentName: 'labeling machine',
      lineRole: 'labeling station',
      desiredDimensions: { length: 2, width: 1, height: 1.6 },
    })

    expect(prompt).toContain('FACTORY AGENT SYSTEM PROMPT')
    expect(prompt).toContain('Equipment: labeling machine')
    expect(prompt).toContain('Factory line role: labeling station')
    expect(prompt).toContain('Desired dimensions: {"length":2,"width":1,"height":1.6}')
    expect(prompt).toContain('If this request is actually architectural/layout work')
  })

  test('adds compose_assembly reactor hint for reactor vessel equipment', () => {
    const prompt = buildFactoryGeometryRequestPrompt({
      userRequest: '\u751f\u6210\u4e00\u4e2a\u53cd\u5e94\u91dc\u88c5\u7f6e',
      equipmentName: '\u53cd\u5e94\u91dc\u88c5\u7f6e',
    })

    expect(prompt).toContain('family:"reactor"')
    expect(prompt).toContain('do not use compose_parts')
  })
})
