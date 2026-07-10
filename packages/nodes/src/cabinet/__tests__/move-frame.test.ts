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
const magneticSnapGuides = cabinetModuleParentFrame.magneticSnapGuides!

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

describe('cabinetModuleParentFrame nested transforms', () => {
  test('projects module positions through nested cabinet ancestors', () => {
    const rootRun = CabinetNode.parse({
      id: 'cabinet_root-run',
      position: [4, 0, 3],
      rotation: Math.PI / 2,
      children: ['cabinet-module_parent'],
    })
    const parentModule = CabinetModuleNode.parse({
      id: 'cabinet-module_parent',
      parentId: rootRun.id,
      position: [1.2, 0.1, -0.4],
      rotation: Math.PI / 4,
      children: ['cabinet_nested-run'],
    })
    const nestedRun = CabinetNode.parse({
      id: 'cabinet_nested-run',
      parentId: parentModule.id,
      position: [0.5, 0, 0.25],
      rotation: -Math.PI / 6,
      children: ['cabinet-module_moving'],
    })
    const moving = CabinetModuleNode.parse({
      id: 'cabinet-module_moving',
      parentId: nestedRun.id,
      position: [0.35, 0.1, 0.2],
    })
    const nodes = Object.fromEntries(
      [rootRun, parentModule, nestedRun, moving].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>

    const plan = cabinetModuleParentFrame.localToPlan(nestedRun, moving.position, nodes)
    const local = cabinetModuleParentFrame.planToLocal(
      nestedRun,
      plan[0],
      moving.position[1],
      plan[2],
      nodes,
    )

    expect(cabinetModuleParentFrame.parentRotationY(nestedRun, nodes)).toBeCloseTo(
      Math.PI / 2 + Math.PI / 4 - Math.PI / 6,
    )
    expect(plan).not.toEqual(moving.position)
    expect(local[0]).toBeCloseTo(moving.position[0])
    expect(local[1]).toBeCloseTo(moving.position[1])
    expect(local[2]).toBeCloseTo(moving.position[2])
  })
})

describe('cabinetModuleParentFrame.magneticSnapGuides', () => {
  test('emits side and depth guides for a module snapped to a sibling', () => {
    const moving = module('cabinet-module_moving', [0.65, 0.1, 0])
    const sibling = module('cabinet-module_sibling', [0, 0.1, 0])
    const { run, nodes } = runFixture([moving, sibling])
    const snapped = magneticSnap(moving, run, moving.position, nodes)

    const guides = magneticSnapGuides(moving, run, moving.position, snapped, nodes)

    expect(guides.map((guide) => guide.axis).sort()).toEqual(['x', 'z'])
    const sideGuide = guides.find((guide) => guide.axis === 'x')
    expect(sideGuide?.coord).toBeCloseTo(0.3)
    expect(sideGuide?.from.x).toBeCloseTo(0.3)
    expect(sideGuide?.to.x).toBeCloseTo(0.3)
    const depthGuide = guides.find((guide) => guide.axis === 'z')
    expect(depthGuide?.coord).toBeCloseTo(0)
    expect(depthGuide?.from.z).toBeCloseTo(0)
    expect(depthGuide?.to.z).toBeCloseTo(0)
  })

  test('projects guide endpoints through nested cabinet ancestors', () => {
    const rootRun = CabinetNode.parse({
      id: 'cabinet_root-run',
      position: [4, 0, 3],
      rotation: Math.PI / 2,
      children: ['cabinet-module_parent'],
    })
    const parentModule = CabinetModuleNode.parse({
      id: 'cabinet-module_parent',
      parentId: rootRun.id,
      position: [1.2, 0.1, -0.4],
      rotation: Math.PI / 4,
      children: ['cabinet_nested-run'],
    })
    const nestedRun = CabinetNode.parse({
      id: 'cabinet_nested-run',
      parentId: parentModule.id,
      position: [0.5, 0, 0.25],
      rotation: -Math.PI / 6,
      children: ['cabinet-module_moving', 'cabinet-module_sibling'],
    })
    const moving = CabinetModuleNode.parse({
      id: 'cabinet-module_moving',
      parentId: nestedRun.id,
      position: [0.65, 0.1, 0],
    })
    const sibling = CabinetModuleNode.parse({
      id: 'cabinet-module_sibling',
      parentId: nestedRun.id,
      position: [0, 0.1, 0],
    })
    const nodes = Object.fromEntries(
      [rootRun, parentModule, nestedRun, moving, sibling].map((node) => [node.id, node as AnyNode]),
    ) as Record<string, AnyNode>
    const snapped = magneticSnap(moving, nestedRun, moving.position, nodes)

    const guides = magneticSnapGuides(moving, nestedRun, moving.position, snapped, nodes)
    const sideGuide = guides.find((guide) => guide.axis === 'x')
    const localGuideStart = cabinetModuleParentFrame.localToPlan(nestedRun, [0.3, 0, -0.29], nodes)

    expect(sideGuide).toBeDefined()
    expect(sideGuide?.from.x).toBeCloseTo(localGuideStart[0])
    expect(sideGuide?.from.z).toBeCloseTo(localGuideStart[2])
    expect(sideGuide?.from.x).not.toBeCloseTo(0.3)
  })
})
