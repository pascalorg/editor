import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { cabinetModuleParentFrame } from '../move-frame'
import { CabinetModuleNode, CabinetNode } from '../schema'

function runFixture(modules: CabinetModuleNode[]): {
  run: CabinetNode
  nodes: Record<string, AnyNode>
} {
  const run = CabinetNode.parse({
    id: 'cabinet_magnet-run',
    children: modules.map((module) => module.id),
  })
  const nodes = Object.fromEntries(
    [run, ...modules].map((node) => [node.id, node as AnyNode]),
  ) as Record<string, AnyNode>
  return { run, nodes }
}

function module(
  id: string,
  position: [number, number, number],
  overrides: { width?: number; depth?: number } = {},
): CabinetModuleNode {
  return CabinetModuleNode.parse({
    id,
    parentId: 'cabinet_magnet-run' as AnyNodeId,
    position,
    width: overrides.width ?? 0.6,
    depth: overrides.depth ?? 0.58,
  })
}

const magneticSnap = cabinetModuleParentFrame.magneticSnap!

describe('cabinetModuleParentFrame.magneticSnap', () => {
  test('pulls a module flush against a sibling edge within the 8 cm threshold', () => {
    const moving = module('cabinet-module_moving', [0.65, 0.1, 0])
    const sibling = module('cabinet-module_sibling', [0, 0.1, 0])
    const { run, nodes } = runFixture([moving, sibling])

    // Sibling right edge at 0.3; moving left edge at 0.35 → 5 cm gap.
    const snapped = magneticSnap(moving, run, [0.65, 0.1, 0], nodes)

    expect(snapped[0]).toBeCloseTo(0.6)
    expect(snapped[0] - moving.width / 2).toBeCloseTo(sibling.position[0] + sibling.width / 2)
    expect(snapped[1]).toBeCloseTo(0.1)
    expect(snapped[2]).toBeCloseTo(0)
  })

  test('does not snap when the nearest sibling edge is beyond the threshold', () => {
    const moving = module('cabinet-module_moving', [0.75, 0.1, 0])
    const sibling = module('cabinet-module_sibling', [0, 0.1, 0])
    const { run, nodes } = runFixture([moving, sibling])

    // Sibling right edge at 0.3; moving left edge at 0.45 → 15 cm gap.
    const snapped = magneticSnap(moving, run, [0.75, 0.1, 0], nodes)

    expect(snapped).toEqual([0.75, 0.1, 0])
  })

  test('center-aligns depth against a deeper sibling when width bands overlap', () => {
    const moving = module('cabinet-module_moving', [0.65, 0.1, 0.03])
    const sibling = module('cabinet-module_sibling', [0, 0.1, 0], { depth: 0.78 })
    const { run, nodes } = runFixture([moving, sibling])

    const snapped = magneticSnap(moving, run, [0.65, 0.1, 0.03], nodes)

    // Z center (delta 3 cm) beats front-face alignment (delta 7 cm).
    expect(snapped[2]).toBeCloseTo(sibling.position[2])
    // X edge-mating still applies in the same pass.
    expect(snapped[0]).toBeCloseTo(0.6)
  })

  test('returns the input position unchanged when the run has no siblings', () => {
    const moving = module('cabinet-module_moving', [0.42, 0.1, 0.07])
    const { run, nodes } = runFixture([moving])

    const snapped = magneticSnap(moving, run, [0.42, 0.1, 0.07], nodes)

    expect(snapped).toEqual([0.42, 0.1, 0.07])
  })

  test('snaps to the nearest of two candidate sibling edges', () => {
    const moving = module('cabinet-module_moving', [0.675, 0.1, 0])
    const left = module('cabinet-module_left', [0, 0.1, 0]) // right edge 0.3
    const right = module('cabinet-module_right', [1.34, 0.1, 0]) // left edge 1.04
    const { run, nodes } = runFixture([moving, left, right])

    // Moving edges at [0.375, 0.975]: 7.5 cm from left sibling, 6.5 cm from
    // right sibling — the right edge must win.
    const snapped = magneticSnap(moving, run, [0.675, 0.1, 0], nodes)

    expect(snapped[0]).toBeCloseTo(0.74)
    expect(snapped[0] + moving.width / 2).toBeCloseTo(right.position[0] - right.width / 2)
  })
})
