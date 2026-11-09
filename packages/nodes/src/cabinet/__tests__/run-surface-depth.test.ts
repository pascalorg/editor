import { expect, test } from 'bun:test'
import type { AnyNode, GeometryContext } from '@pascal-app/core'
import { getRunSpanEnds, getRunSpans } from '../run-layout'
import { CabinetModuleNode, CabinetNode } from '../schema'

test('run surface spans follow each cabinet module depth independently', () => {
  const run = CabinetNode.parse({
    id: 'cabinet_individual-surfaces',
    children: ['cabinet-module_shallow', 'cabinet-module_deep'],
    showPlinth: true,
    withCountertop: true,
  })
  const shallow = CabinetModuleNode.parse({
    id: 'cabinet-module_shallow',
    parentId: run.id,
    cabinetType: 'base',
    position: [-0.3, run.plinthHeight, 0.25],
    width: 0.6,
    depth: 0.5,
  })
  const deep = CabinetModuleNode.parse({
    id: 'cabinet-module_deep',
    parentId: run.id,
    cabinetType: 'base',
    position: [0.3, run.plinthHeight, 0.35],
    width: 0.6,
    depth: 0.7,
  })
  const spans = getRunSpans([shallow, deep], { runTier: run.runTier })
  const children = [shallow, deep] as AnyNode[]
  const context: GeometryContext = {
    children,
    parent: null,
    resolve: (id) => children.find((node) => node.id === id) as never,
    siblings: [],
  }
  const ends = getRunSpanEnds(run, context, spans)

  expect(spans).toHaveLength(2)
  expect(spans[0]!.minZ).toBeCloseTo(0)
  expect(spans[0]!.maxZ).toBeCloseTo(0.5)
  expect(spans[1]!.minZ).toBeCloseTo(0)
  expect(spans[1]!.maxZ).toBeCloseTo(0.7)
  expect(ends[0]!.rightOverhang).toBe(0)
  expect(ends[1]!.leftOverhang).toBe(0)
})

test('equal-depth adjacent cabinets keep one continuous surface span', () => {
  const left = CabinetModuleNode.parse({
    position: [-0.3, 0.1, 0],
    width: 0.6,
    depth: 0.58,
  })
  const right = CabinetModuleNode.parse({
    position: [0.3, 0.1, 0],
    width: 0.6,
    depth: 0.58,
  })

  expect(getRunSpans([left, right])).toHaveLength(1)
})

for (const side of ['left', 'right'] as const) {
  test(`inside ${side} corner has neither overhang nor finished end`, () => {
    const run = CabinetNode.parse({
      metadata: { cabinetCornerDerivedRun: { role: 'base-leg', side } },
    })
    const module = CabinetModuleNode.parse({ parentId: run.id })
    const context: GeometryContext = {
      children: [module],
      siblings: [],
      parent: null,
      resolve: () => undefined,
    }
    const [end] = getRunSpanEnds(run, context, getRunSpans([module]))
    expect(side === 'right' ? end!.exposedLeft : end!.exposedRight).toBe(false)
    expect(side === 'right' ? end!.leftOverhang : end!.rightOverhang).toBe(0)
    expect(side === 'right' ? end!.exposedRight : end!.exposedLeft).toBe(true)
  })
}

test('wall filler terminates the slab flush without an end panel inside the wall', () => {
  const run = CabinetNode.parse({})
  const module = CabinetModuleNode.parse({ parentId: run.id, width: 0.6 })
  const filler = CabinetModuleNode.parse({
    parentId: run.id,
    moduleKind: 'wall-filler',
    width: 0.1,
    position: [0.35, 0, 0],
  })
  const context: GeometryContext = {
    children: [module, filler],
    siblings: [],
    parent: null,
    resolve: () => undefined,
  }
  const [end] = getRunSpanEnds(run, context, getRunSpans([module, filler]))
  expect(end!.rightOverhang).toBe(0)
  expect(end!.exposedRight).toBe(false)
})
