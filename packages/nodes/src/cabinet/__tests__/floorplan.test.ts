import { describe, expect, test } from 'bun:test'
import type { AnyNode, FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { cabinetDefinition } from '../definition'
import { buildCabinetFloorplan, buildCabinetModuleFloorplan } from '../floorplan'
import { CabinetModuleNode, CabinetNode } from '../schema'

function makeContext(overrides: Partial<GeometryContext> = {}): GeometryContext {
  return {
    children: [],
    parent: null,
    resolve: () => undefined as never,
    siblings: [],
    ...overrides,
  }
}

function flatten(geometry: FloorplanGeometry | null): FloorplanGeometry[] {
  if (!geometry) return []
  if (geometry.kind !== 'group') return [geometry]
  return [geometry, ...geometry.children.flatMap((child) => flatten(child))]
}

function primitives(geometry: FloorplanGeometry | null, kind: string): FloorplanGeometry[] {
  return flatten(geometry).filter((g) => g.kind === kind)
}

function composeWorldPose(
  parentPosition: readonly [number, number, number],
  parentRotation: number,
  childPosition: readonly [number, number, number],
  childRotation = 0,
) {
  return {
    position: [
      parentPosition[0] +
        childPosition[0] * Math.cos(parentRotation) +
        childPosition[2] * Math.sin(parentRotation),
      parentPosition[1] + childPosition[1],
      parentPosition[2] -
        childPosition[0] * Math.sin(parentRotation) +
        childPosition[2] * Math.cos(parentRotation),
    ] as [number, number, number],
    rotation: parentRotation + childRotation,
  }
}

describe('buildCabinetFloorplan', () => {
  // A childless run still draws its node-level footprint — the 2D placement
  // ghost publishes a moduleless preview run and needs a visible outline.
  test('empty cabinet runs fall back to the run node footprint', () => {
    const run = CabinetNode.parse({
      ...cabinetDefinition.defaults(),
      id: 'cabinet_empty-floorplan-run',
      children: [],
    })

    const rects = primitives(buildCabinetFloorplan(run, makeContext()), 'rect')
    expect(rects.length).toBeGreaterThanOrEqual(1)
    const body = rects[0]! as Extract<FloorplanGeometry, { kind: 'rect' }>
    // Countertop outline: node footprint extended by the overhang on the
    // front / left / right edges (defaults: countertop on, overhang 0.02).
    expect(body.width).toBeCloseTo(run.width + 2 * run.countertopOverhang)
    expect(body.height).toBeCloseTo(run.depth + run.countertopOverhang)
  })

  test('run draws one countertop rect per span, extended by the overhang', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_run-spans',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_a',
        parentId: run.id,
        position: [-0.3, 0.1, 0],
        width: 0.6,
        depth: 0.58,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_b',
        parentId: run.id,
        position: [0.3, 0.1, 0],
        width: 0.6,
        depth: 0.58,
      }),
    ]

    const geometry = buildCabinetFloorplan(run, makeContext({ children: modules as AnyNode[] }))
    const rects = primitives(geometry, 'rect') as Array<{ x: number; width: number }>

    expect(rects).toHaveLength(1)
    expect(rects[0]!.x).toBeCloseTo(-0.62)
    expect(rects[0]!.width).toBeCloseTo(1.24)
  })

  test('nested L-leg runs compose their source module transform in floorplan space', () => {
    const sourceRun = CabinetNode.parse({
      id: 'cabinet_source-run-floorplan-nested',
      position: [1.2, 0, 2.4],
      rotation: Math.PI / 2,
      children: ['cabinet-module_source-run-floorplan-nested'],
    })
    const sourceModule = CabinetModuleNode.parse({
      id: 'cabinet-module_source-run-floorplan-nested',
      parentId: sourceRun.id,
      position: [0.45, 0.1, -0.12],
      rotation: Math.PI / 4,
      width: 0.9,
      depth: 0.58,
    })
    const childRun = CabinetNode.parse({
      id: 'cabinet_child-run-floorplan-nested',
      parentId: sourceModule.id,
      position: [0.3, 0, -0.2],
      rotation: -Math.PI / 2,
      children: ['cabinet-module_child-run-floorplan-nested'],
    })
    const childModule = CabinetModuleNode.parse({
      id: 'cabinet-module_child-run-floorplan-nested',
      parentId: childRun.id,
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
    })

    const geometry = buildCabinetFloorplan(
      childRun,
      makeContext({
        parent: sourceModule as AnyNode,
        children: [childModule] as AnyNode[],
        resolve: ((id: string) => (id === sourceRun.id ? sourceRun : undefined)) as GeometryContext['resolve'],
      }),
    ) as Extract<FloorplanGeometry, { kind: 'group' }>

    const transformed = geometry.children[0] as Extract<FloorplanGeometry, { kind: 'group' }>
    expect(transformed.kind).toBe('group')

    const expectedX =
      sourceRun.position[0] +
      sourceModule.position[0] * Math.cos(sourceRun.rotation) +
      sourceModule.position[2] * Math.sin(sourceRun.rotation) +
      childRun.position[0] * Math.cos(sourceRun.rotation + sourceModule.rotation) +
      childRun.position[2] * Math.sin(sourceRun.rotation + sourceModule.rotation)
    const expectedZ =
      sourceRun.position[2] -
      sourceModule.position[0] * Math.sin(sourceRun.rotation) +
      sourceModule.position[2] * Math.cos(sourceRun.rotation) -
      childRun.position[0] * Math.sin(sourceRun.rotation + sourceModule.rotation) +
      childRun.position[2] * Math.cos(sourceRun.rotation + sourceModule.rotation)

    expect(transformed.transform?.translate?.[0]).toBeCloseTo(expectedX)
    expect(transformed.transform?.translate?.[1]).toBeCloseTo(expectedZ)
    expect(transformed.transform?.rotate).toBeCloseTo(
      -(sourceRun.rotation + sourceModule.rotation + childRun.rotation),
    )
  })

  test('deeply nested corner runs compose the full cabinet ancestry chain in floorplan space', () => {
    const sourceRun = CabinetNode.parse({
      id: 'cabinet_source-run-floorplan-deep',
      position: [2.4, 0, 1.3],
      rotation: Math.PI / 2,
      children: ['cabinet-module_source-run-floorplan-deep'],
    })
    const sourceModule = CabinetModuleNode.parse({
      id: 'cabinet-module_source-run-floorplan-deep',
      parentId: sourceRun.id,
      position: [0.45, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const childRun = CabinetNode.parse({
      id: 'cabinet_child-run-floorplan-deep',
      parentId: sourceModule.id,
      position: [0.58, 0, 0.29],
      rotation: -Math.PI / 2,
      children: ['cabinet-module_child-run-floorplan-deep'],
    })
    const childModule = CabinetModuleNode.parse({
      id: 'cabinet-module_child-run-floorplan-deep',
      parentId: childRun.id,
      position: [0.74, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const grandchildRun = CabinetNode.parse({
      id: 'cabinet_grandchild-run-floorplan-deep',
      parentId: childModule.id,
      position: [0.58, 0, 0.29],
      rotation: -Math.PI / 2,
      children: ['cabinet-module_grandchild-run-floorplan-deep'],
    })
    const grandchildModule = CabinetModuleNode.parse({
      id: 'cabinet-module_grandchild-run-floorplan-deep',
      parentId: grandchildRun.id,
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
    })

    const nodes = {
      [sourceRun.id]: sourceRun,
      [sourceModule.id]: sourceModule,
      [childRun.id]: childRun,
      [childModule.id]: childModule,
    }

    const geometry = buildCabinetFloorplan(
      grandchildRun,
      makeContext({
        parent: childModule as AnyNode,
        children: [grandchildModule] as AnyNode[],
        resolve: ((id: string) => nodes[id as keyof typeof nodes]) as GeometryContext['resolve'],
      }),
    ) as Extract<FloorplanGeometry, { kind: 'group' }>

    const transformed = geometry.children[0] as Extract<FloorplanGeometry, { kind: 'group' }>
    const sourceModuleWorld = composeWorldPose(
      sourceRun.position,
      sourceRun.rotation,
      sourceModule.position,
      sourceModule.rotation,
    )
    const childRunWorld = composeWorldPose(
      sourceModuleWorld.position,
      sourceModuleWorld.rotation,
      childRun.position,
      childRun.rotation,
    )
    const childModuleWorld = composeWorldPose(
      childRunWorld.position,
      childRunWorld.rotation,
      childModule.position,
      childModule.rotation,
    )
    const expectedWorld = composeWorldPose(
      childModuleWorld.position,
      childModuleWorld.rotation,
      grandchildRun.position,
      grandchildRun.rotation,
    )

    expect(transformed.kind).toBe('group')
    expect(transformed.transform?.translate?.[0]).toBeCloseTo(expectedWorld.position[0])
    expect(transformed.transform?.translate?.[1]).toBeCloseTo(expectedWorld.position[2])
    expect(transformed.transform?.rotate).toBeCloseTo(-expectedWorld.rotation)
  })
})

describe('buildCabinetModuleFloorplan', () => {
  const run = CabinetNode.parse({ id: 'cabinet_symbol-run' })

  function moduleFloorplan(module: ReturnType<typeof CabinetModuleNode.parse>) {
    return buildCabinetModuleFloorplan(module, makeContext({ parent: run as AnyNode }))
  }

  test('sink module draws rounded bowl rects and a faucet circle', () => {
    const module = CabinetModuleNode.parse({
      parentId: run.id,
      width: 0.8,
      depth: 0.58,
      stack: [
        { id: 'd', type: 'door', doorType: 'double' },
        { id: 's', type: 'sink', sinkLayout: 'double' },
      ],
    })

    const geometry = moduleFloorplan(module)
    const roundedRects = (primitives(geometry, 'rect') as Array<{ rx?: number }>).filter(
      (rect) => (rect.rx ?? 0) > 0,
    )
    const faucet = (primitives(geometry, 'circle') as Array<{ r: number; cy: number }>)[0]
    expect(roundedRects).toHaveLength(2)
    expect(primitives(geometry, 'circle')).toHaveLength(1)
    expect(faucet?.r).toBeCloseTo(0.02)
    expect(faucet?.cy).toBeCloseTo(-0.26)
  })

  test('gas cooktop module draws two rings per burner', () => {
    const module = CabinetModuleNode.parse({
      parentId: run.id,
      width: 0.75,
      depth: 0.58,
      stack: [
        { id: 'd', type: 'drawer', drawerCount: 2 },
        { id: 'c', type: 'cooktop-gas', cooktopLayout: 'gas-4burner' },
      ],
    })

    expect(primitives(moduleFloorplan(module), 'circle')).toHaveLength(8)
  })

  test('appliance modules carry standard plan labels', () => {
    const cases: Array<{ stack: unknown[]; label: string }> = [
      { stack: [{ id: 'x', type: 'dishwasher', height: 0.72 }], label: 'DW' },
      { stack: [{ id: 'x', type: 'fridge-single', height: 1.78 }], label: 'REF' },
      {
        stack: [
          { id: 'x', type: 'oven', height: 0.595 },
          { id: 'y', type: 'microwave', height: 0.39 },
        ],
        label: 'OV/MW',
      },
    ]
    for (const { stack, label } of cases) {
      const module = CabinetModuleNode.parse({ parentId: run.id, stack })
      const texts = primitives(moduleFloorplan(module), 'text') as Array<{ text: string }>
      expect(texts.map((t) => t.text)).toContain(label)
    }
  })

  test('nested wall cabinet draws a dashed open outline', () => {
    const baseModule = CabinetModuleNode.parse({ parentId: run.id, position: [0, 0.1, 0] })
    const wallModule = CabinetModuleNode.parse({
      parentId: baseModule.id,
      position: [0, 1.4, -0.13],
      depth: 0.32,
    })

    const geometry = buildCabinetModuleFloorplan(
      wallModule,
      makeContext({
        parent: baseModule as AnyNode,
        resolve: ((id: string) => (id === run.id ? run : undefined)) as GeometryContext['resolve'],
      }),
    )
    const rects = primitives(geometry, 'rect') as Array<{
      strokeDasharray?: string
      fill?: string
    }>
    expect(rects).toHaveLength(1)
    expect(rects[0]!.strokeDasharray).toBeTruthy()
    expect(rects[0]!.fill).toBe('none')
  })

  test('plain door module draws no appliance symbols or labels', () => {
    const module = CabinetModuleNode.parse({
      parentId: run.id,
      stack: [{ id: 'd', type: 'door', doorType: 'double', shelfCount: 1 }],
    })

    const geometry = moduleFloorplan(module)
    expect(primitives(geometry, 'circle')).toHaveLength(0)
    expect(primitives(geometry, 'text')).toHaveLength(0)
  })
})
