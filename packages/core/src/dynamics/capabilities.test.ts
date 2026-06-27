import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema/types'
import { getDynamicTypesForNode, getNodeSemanticType } from './capabilities'

function node(metadata: Record<string, unknown>, type = 'box'): AnyNode {
  return {
    object: 'node',
    id: `${type}_dynamic_semantic_test`,
    type,
    name: 'generated device',
    parentId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    visible: true,
    metadata,
  } as AnyNode
}

describe('dynamic capability semantic inference', () => {
  test('infers conveyor dynamics from AI generated belt metadata', () => {
    const belt = node({
      semanticRole: 'belt_surface',
      sourcePartKind: 'roller_array',
      family: 'conveyor_line',
    })

    expect(getNodeSemanticType(belt)).toBe('conveyor')
    expect(getDynamicTypesForNode(belt)).toContain('conveyorFlow')
  })

  test('uses conveyor semantics for the built-in conveyor belt node type', () => {
    const belt = node({}, 'conveyor-belt')

    expect(getNodeSemanticType(belt)).toBe('conveyor')
    expect(getDynamicTypesForNode(belt)).toContain('conveyorFlow')
  })

  test('keeps conveyor assembly parts semantically separate', () => {
    const frame = node({ semanticRole: 'conveyor_frame', sourcePartKind: 'conveyor_frame' })
    const roller = node({ semanticRole: 'roller', sourcePartKind: 'roller_array' })
    const motor = node({ semanticRole: 'drive_motor', sourcePartKind: 'ribbed_motor_body' })

    expect(getNodeSemanticType(frame)).toBe('conveyor')
    expect(getDynamicTypesForNode(frame)).toContain('conveyorFlow')

    expect(getNodeSemanticType(roller)).toBe('roller')
    expect(getDynamicTypesForNode(roller)).toContain('rotate')
    expect(getDynamicTypesForNode(roller)).not.toContain('conveyorFlow')

    expect(getNodeSemanticType(motor)).toBe('motor')
    expect(getDynamicTypesForNode(motor)).toContain('speed')
    expect(getDynamicTypesForNode(motor)).not.toContain('conveyorFlow')
  })

  test('infers fan, tank, and pipe dynamics from generated metadata', () => {
    expect(
      getDynamicTypesForNode(node({ semanticRole: 'impeller', sourcePartKind: 'fan' })),
    ).toContain('speed')
    expect(
      getDynamicTypesForNode(node({ semanticRole: 'vessel_shell', family: 'reactor_vessel' })),
    ).toContain('level')
    expect(
      getDynamicTypesForNode(node({ semanticRole: 'pipe_run', sourcePartKind: 'duct' })),
    ).toContain('flow')
  })



  test('keeps loading dynamics only on container-like semantics', () => {
    const wheel = node({ semanticRole: 'wheel', sourcePartKind: 'wheel' })
    const cabinet = node({ semanticRole: 'electrical_cabinet', sourcePartKind: 'cabinet' })

    expect(getNodeSemanticType(wheel)).toBe('roller')
    expect(getDynamicTypesForNode(wheel)).not.toContain('fill')
    expect(getDynamicTypesForNode(wheel)).not.toContain('level')
    expect(getDynamicTypesForNode(wheel)).toContain('rotate')

    expect(getNodeSemanticType(cabinet)).toBe('cabinet')
    expect(getDynamicTypesForNode(cabinet)).toContain('fill')
  })

  test('ignores stale declared loading dynamics on non-container nodes', () => {
    const wheel = node({
      semanticType: 'roller',
      dynamicCapabilities: {
        semanticType: 'roller',
        supportedTypes: ['rotate', 'fill', 'level'],
        recommendedTypes: ['rotate'],
        source: 'generated-geometry',
      },
    })

    expect(getDynamicTypesForNode(wheel)).toContain('rotate')
    expect(getDynamicTypesForNode(wheel)).not.toContain('fill')
    expect(getDynamicTypesForNode(wheel)).not.toContain('level')
  })

  test('ignores stale declared conveyor dynamics on roller parts', () => {
    const roller = node({
      semanticRole: 'roller',
      sourcePartKind: 'roller_array',
      dynamicCapabilities: {
        semanticType: 'conveyor',
        supportedTypes: ['conveyorFlow', 'rotate'],
        recommendedTypes: ['conveyorFlow'],
        source: 'generated-geometry',
      },
    })

    expect(getNodeSemanticType(roller)).toBe('roller')
    expect(getDynamicTypesForNode(roller)).toContain('rotate')
    expect(getDynamicTypesForNode(roller)).not.toContain('conveyorFlow')
  })

  test('explicit semanticType overrides inference', () => {
    const generated = node({
      semanticType: 'generic',
      semanticRole: 'belt_surface',
      sourcePartKind: 'roller_array',
    })

    expect(getNodeSemanticType(generated)).toBe('generic')
    expect(getDynamicTypesForNode(generated)).not.toContain('conveyorFlow')
  })
})

test('uses declared dynamic capability metadata from generated nodes', () => {
  const generated = node({
    dynamicCapabilities: {
      semanticType: 'conveyor',
      supportedTypes: ['conveyorFlow', 'speed', 'not-real'],
      recommendedTypes: ['conveyorFlow'],
      source: 'generated-geometry',
    },
  })

  expect(getNodeSemanticType(generated)).toBe('conveyor')
  expect(getDynamicTypesForNode(generated)).toContain('conveyorFlow')
  expect(getDynamicTypesForNode(generated)).toContain('speed')
})
