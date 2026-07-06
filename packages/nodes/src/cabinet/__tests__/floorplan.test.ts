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

describe('buildCabinetFloorplan', () => {
  test('empty cabinet runs emit no fallback footprint', () => {
    const run = CabinetNode.parse({
      ...cabinetDefinition.defaults(),
      id: 'cabinet_empty-floorplan-run',
      children: [],
    })

    expect(buildCabinetFloorplan(run, makeContext())).toBeNull()
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
    expect(roundedRects).toHaveLength(2)
    expect(primitives(geometry, 'circle')).toHaveLength(1)
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
