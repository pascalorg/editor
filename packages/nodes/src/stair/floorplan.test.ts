import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type GeometryContext,
  LevelNode,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'
import { readFloorplanGeometryMetadata } from '@pascal-app/editor'
import { buildStairFloorplan } from './floorplan'

function textValues(geometry: FloorplanGeometry | null) {
  if (geometry?.kind !== 'group') return []
  return geometry.children.flatMap((child) =>
    child.kind === 'text' &&
    readFloorplanGeometryMetadata(child).annotationRole === 'stair-annotation'
      ? [child.text]
      : [],
  )
}

describe('buildStairFloorplan documentation', () => {
  test('integrates stair notes, break line, and visible treads below the break', () => {
    const segment = StairSegmentNode.parse({
      id: 'sseg_main',
      width: 1.2,
      length: 3,
      height: 2.5,
      stepCount: 10,
    })
    const stair = StairNode.parse({
      id: 'stair_main',
      parentId: 'level_ground',
      fromLevelId: 'level_ground',
      toLevelId: 'level_upper',
      children: [segment.id],
      railingMode: 'both',
    })
    const geometry = buildStairFloorplan(stair, {
      resolve: () => undefined,
      children: [segment],
      siblings: [],
      parent: LevelNode.parse({ id: 'level_ground' }),
    } satisfies GeometryContext)

    expect(textValues(geometry)[0]).toBe('UP')
    expect(textValues(geometry)).toContain('10 R @ 0.25m · T 0.3m · CLR W 1.2m')
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    expect(
      geometry.children.some(
        (child) =>
          child.kind === 'polyline' &&
          readFloorplanGeometryMetadata(child).annotationRole === 'stair-annotation',
      ),
    ).toBe(true)
    expect(
      geometry.children.filter((child) => child.kind === 'polygon' && child.fill === '#262626'),
    ).toHaveLength(6)
    expect(geometry.children.some((child) => 'strokeDasharray' in child)).toBe(false)
  })
})

test('arc plans use the rendered two-step layout and preserve signed multi-turn arrival', async () => {
  const { builtinPlugin } = await import('../index')
  const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
  for (const sweepAngle of [Math.PI / 2, Math.PI * 2, Math.PI * 2.5, -Math.PI * 2.5]) {
    const stair = StairNode.parse({
      stairType: 'spiral',
      stepCount: 2,
      sweepAngle,
      totalRise: 3,
      rotation: 0.37,
      width: 1,
      innerRadius: 0.5,
      topLandingMode: 'integrated',
      topLandingDepth: 0.9,
    })
    const geometry = definition.floorplan!(stair, {
      resolve: () => undefined,
      children: [],
      siblings: [],
    } satisfies GeometryContext)
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') continue
    expect(textValues(geometry).some((text) => text.startsWith('2 R @ 1.5m'))).toBe(true)
    const spokes = geometry.children.filter((child) => child.kind === 'line')
    expect(spokes).toHaveLength(3)
    const end = spokes.at(-1)!
    if (end.kind !== 'line') continue
    const angle = -stair.rotation + sweepAngle / 2
    expect(end.x2).toBeCloseTo(stair.position[0] + 1.5 * Math.cos(angle), 8)
    expect(end.y2).toBeCloseTo(stair.position[2] + 1.5 * Math.sin(angle), 8)
  }
})

test('selected plan walking lines project the same paths used in 3D', async () => {
  const { builtinPlugin } = await import('../index')
  const { planStairPreset, resolveStairWalkingPaths } = await import('@pascal-app/core')
  const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
  const original = StairNode.parse({ totalRise: 3, position: [4, 0, 7], rotation: 0.4 })
  const plan = planStairPreset(original, { [original.id]: original }, { layout: 'u' })
  const ctx: GeometryContext = {
    resolve: () => undefined,
    children: plan.segments,
    siblings: [],
    viewState: {
      selected: true,
      unit: 'metric',
      highlighted: false,
      hovered: false,
      moving: false,
      palette: {
        selectedStroke: '#2563eb',
        selectedFill: '#fff',
        selectedHatch: '#2563eb',
        wallHoverStroke: '#2563eb',
        endpointHandleFill: '#fff',
        endpointHandleStroke: '#2563eb',
        endpointHandleHoverStroke: '#2563eb',
        endpointHandleActiveFill: '#fff',
        endpointHandleActiveStroke: '#2563eb',
        curveHandleFill: '#fff',
        curveHandleStroke: '#2563eb',
        curveHandleHoverStroke: '#2563eb',
        measurementStroke: '#334155',
        measurementLabelBackground: '#fff',
        measurementLabelText: '#111827',
      },
    },
  }
  const geometry = definition.floorplan!(plan.stair, ctx)
  if (geometry?.kind !== 'group') throw new Error('Missing stair plan')
  const lines = geometry.children.filter(
    (child) => child.kind === 'polyline' && child.strokeDasharray === '0.12 0.08',
  )
  expect(lines).toHaveLength(1)
  const line = lines[0]!
  if (line.kind !== 'polyline') throw new Error('Missing walking line')
  const points = resolveStairWalkingPaths(plan.stair, plan.segments, 3)[0]!
  expect(line.points).toHaveLength(points.length)
  for (const [index, [x, , z]] of points.entries()) {
    expect(line.points[index]![0]).toBeCloseTo(4 + x * Math.cos(0.4) + z * Math.sin(0.4))
    expect(line.points[index]![1]).toBeCloseTo(7 - x * Math.sin(0.4) + z * Math.cos(0.4))
  }
  const unselected = definition.floorplan!(plan.stair, {
    ...ctx,
    viewState: { ...ctx.viewState!, selected: false },
  })
  if (unselected?.kind !== 'group') throw new Error('Missing stair plan')
  expect(
    unselected.children.some(
      (child) => child.kind === 'polyline' && child.strokeDasharray === '0.12 0.08',
    ),
  ).toBe(false)
})

test('plan and 3D sweep handles share multi-turn edits and preserve tiny authored dimensions', async () => {
  const { builtinPlugin } = await import('../index')
  const { createSceneApi, useLiveNodeOverrides, useScene, resolveStairArcDimensions } =
    await import('@pascal-app/core')
  const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
  const previous = useScene.getState()
  const previousOverrides = useLiveNodeOverrides.getState().overrides
  try {
    for (const sign of [-1, 1]) {
      const stair = StairNode.parse({
        stairType: 'spiral',
        totalRise: 0.05,
        sweepAngle: sign * 4 * Math.PI,
        width: 0.1,
        innerRadius: 0.02,
        thickness: 0.005,
      })
      const nodes = { [stair.id]: stair }
      useScene.setState({ nodes, rootNodeIds: [stair.id] })
      for (const end of ['start', 'end'] as const) {
        const handle = definition
          .handles?.(stair, createSceneApi())
          .find(
            (candidate) =>
              candidate.kind === 'arc-resize' &&
              candidate.end === end &&
              candidate.shape !== 'rotate',
          )
        if (handle?.kind !== 'arc-resize') throw new Error('Missing angular handle')
        const session = definition.floorplanAffordances?.['curved-sweep']?.start({
          node: stair,
          nodes,
          payload: { end },
          initialPlanPoint: [1, 0],
          scene: createSceneApi(),
        })
        if (!session) throw new Error('Missing plan affordance')
        for (let index = 1; index <= 40; index++) {
          const angle = (sign * (end === 'end' ? 1 : -1) * index * Math.PI) / 10
          session.apply({ planPoint: [Math.cos(angle), Math.sin(angle)] })
        }
        const delta = sign * (end === 'end' ? 1 : -1) * 4 * Math.PI
        const expected = handle.apply(stair, delta, createSceneApi())
        const actual = useLiveNodeOverrides.getState().overrides.get(stair.id)!
        expect(actual.sweepAngle).toBeCloseTo(expected.sweepAngle as number)
        expect(actual.rotation).toBeCloseTo(expected.rotation as number)
        expect(Math.abs(actual.sweepAngle as number)).toBeCloseTo(8 * Math.PI)
        useLiveNodeOverrides.getState().clear(stair.id)
      }
      const geometry = definition.floorplan!(stair, {
        resolve: () => undefined,
        children: [],
        siblings: [],
      })
      expect(geometry?.kind).toBe('group')
      const arc = resolveStairArcDimensions(stair, 0.05)
      expect(arc.outerRadius).toBeCloseTo(0.12)
      const countField = definition.parametrics?.groups
        .flatMap((group) => group.fields)
        .find((field) => field.key === 'stepCount')
      expect(countField && 'max' in countField ? countField.max : undefined).toBeUndefined()
    }
  } finally {
    useLiveNodeOverrides.setState({ overrides: previousOverrides })
    useScene.setState(previous)
  }
})

test('oversized stair counts produce a bounded plan and visible detail refusal', async () => {
  const { builtinPlugin } = await import('../index')
  const definition = builtinPlugin.nodes.find((node) => node.kind === 'stair')!
  for (const stairType of ['straight', 'spiral'] as const) {
    const segment = StairSegmentNode.parse({ stepCount: 4294967296 })
    const stair = StairNode.parse({
      stairType,
      stepCount: 4294967296,
      children: [segment.id],
      width: 1000000000,
    })
    const geometry = definition.floorplan!(stair, {
      resolve: () => undefined,
      children: [segment],
      siblings: [],
    })
    if (geometry?.kind !== 'group') throw new Error('Missing stair plan')
    expect(
      geometry.children.some(
        (child) => child.kind === 'text' && child.text.includes('detail unavailable'),
      ),
    ).toBe(true)
    expect(geometry.children.length).toBeLessThan(5)
    expect(stair.stepCount).toBe(4294967296)
  }
})

test('whole-chain plan budgets retain footprints without allocating any flight treads', async () => {
  const { buildFloorplanStairEntry } = await import('@pascal-app/editor')
  const segments = Array.from({ length: 20 }, () => StairSegmentNode.parse({ stepCount: 10000 }))
  const stair = StairNode.parse({ children: segments.map((segment) => segment.id) })
  const entry = buildFloorplanStairEntry(stair, segments)!
  expect(entry.hitPolygons).toHaveLength(20)
  expect(entry.segments.every((segment) => segment.treadBars.length === 0)).toBe(true)
  const geometry = buildStairFloorplan(stair, {
    resolve: () => undefined,
    children: segments,
    siblings: [],
  })
  if (geometry?.kind !== 'group') throw new Error('Missing stair plan')
  expect(geometry.children).toHaveLength(21)
  expect(
    geometry.children.some((child) => child.kind === 'text' && child.text.includes('unavailable')),
  ).toBe(true)
})

test('selected winding and arc stairs keep valid resize and rotation controls', async () => {
  const { planStairPreset } = await import('@pascal-app/core')
  const original = StairNode.parse({ totalRise: 3, railingMode: 'none' })
  const plan = planStairPreset(
    original,
    { [original.id]: original },
    { layout: 'l', turningStrategy: 'winder' },
  )
  const cases = [
    { stair: plan.stair, children: plan.segments },
    ...(['curved', 'spiral'] as const).map((stairType) => ({
      stair: StairNode.parse({ stairType, totalRise: 3, railingMode: 'none' }),
      children: [],
    })),
  ]
  for (const { stair, children } of cases) {
    const geometry = buildStairFloorplan(stair, {
      resolve: () => undefined,
      children,
      siblings: [],
      viewState: {
        selected: true,
        highlighted: false,
        hovered: false,
        moving: false,
        unit: 'metric',
        palette: {
          selectedStroke: '#2563eb',
          selectedFill: '#fff',
          selectedHatch: '#2563eb',
          wallHoverStroke: '#2563eb',
          endpointHandleFill: '#fff',
          endpointHandleStroke: '#2563eb',
          endpointHandleHoverStroke: '#2563eb',
          endpointHandleActiveFill: '#fff',
          endpointHandleActiveStroke: '#2563eb',
          curveHandleFill: '#fff',
          curveHandleStroke: '#2563eb',
          curveHandleHoverStroke: '#2563eb',
          measurementStroke: '#334155',
          measurementLabelBackground: '#fff',
          measurementLabelText: '#111827',
        },
      },
    })
    if (geometry?.kind !== 'group') throw new Error('Missing stair plan')
    expect(
      geometry.children.some(
        (child) => child.kind === 'rotate-arrow' && child.affordance === 'stair-rotate',
      ),
    ).toBe(true)
    if (stair.stairType === 'straight') {
      const winder = children.find((child) => child.winder)!
      const arrows = geometry.children.filter(
        (child) => child.kind === 'move-arrow' && child.payload?.segmentId === winder.id,
      )
      expect(
        arrows.filter(
          (child) => child.kind === 'move-arrow' && child.affordance === 'segment-width',
        ).length,
      ).toBe(2)
      expect(
        arrows.some(
          (child) => child.kind === 'move-arrow' && child.affordance === 'segment-length',
        ),
      ).toBe(false)
    }
  }
})
