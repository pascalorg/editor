import { describe, expect, test } from 'bun:test'
import type { Mesh } from 'three'
import { buildSteelBeamGeometry } from '../geometry'
import type { SteelBeamNode } from '../schema'

function meshNamed(group: ReturnType<typeof buildSteelBeamGeometry>, name: string): Mesh {
  const mesh = group.children.find((child) => child.name === name) as Mesh | undefined
  if (!mesh) throw new Error(`Expected mesh named ${name}`)
  return mesh
}

function beam(overrides: Partial<SteelBeamNode>): SteelBeamNode {
  return {
    object: 'node',
    id: 'steel-beam_test',
    type: 'steel-beam',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    profile: 'i-beam',
    length: 3,
    height: 0.32,
    width: 0.18,
    flangeThickness: 0.045,
    webThickness: 0.035,
    color: '#7f8792',
    ...overrides,
  } as SteelBeamNode
}

describe('buildSteelBeamGeometry', () => {
  test('box profile is a hollow rectangular tube built from four plates', () => {
    const node = beam({
      profile: 'box',
      length: 4,
      height: 0.4,
      width: 0.3,
      flangeThickness: 0.05,
      webThickness: 0.04,
    })
    const group = buildSteelBeamGeometry(node)
    const names = group.children.map((child) => child.name).sort()

    expect(names).toEqual(['box-bottom', 'box-side-left', 'box-side-right', 'box-top'])
    expect((meshNamed(group, 'box-top').geometry as any).parameters.height).toBeCloseTo(0.05)
    expect((meshNamed(group, 'box-side-left').geometry as any).parameters.depth).toBeCloseTo(0.04)
  })

  test('concave profile is open at the top with bottom and two side webs', () => {
    const node = beam({
      profile: 'concave',
      height: 0.4,
      width: 0.3,
      flangeThickness: 0.05,
      webThickness: 0.04,
    })
    const group = buildSteelBeamGeometry(node)
    const names = group.children.map((child) => child.name).sort()

    expect(names).toEqual(['concave-bottom', 'concave-side-left', 'concave-side-right'])
    expect(group.children.find((child) => child.name === 'concave-top')).toBeUndefined()
  })
})
