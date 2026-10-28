import { afterEach, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  FootingNode,
  type GeometryContext,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { readFloorplanGeometryMetadata, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { buildFootingFloorplan } from './floorplan'
import { footingSizeAffordance, footingWidthAffordance } from './floorplan-affordances'

const IN = 0.0254
const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
const STRIP = FootingNode.parse({
  id: 'footing_strip',
  parentId: 'level_g',
  start: [0, 0],
  end: [3.048, 0],
})

afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useInteractionScope.getState().end()
  useViewer.setState({ unit: 'metric' })
})

function labels(geometry: FloorplanGeometry | null): string[] {
  if (!geometry) return []
  if (geometry.kind === 'group') return geometry.children.flatMap(labels)
  return geometry.kind === 'dimension-label' ? [geometry.text] : []
}

test("a selected strip's length reads in the plan's unit", () => {
  const view = { selected: true, highlighted: false, hovered: false, moving: false }
  const ctx = (unit: 'metric' | 'imperial') =>
    ({ viewState: { ...view, unit } }) as unknown as GeometryContext
  expect(labels(buildFootingFloorplan(STRIP, ctx('imperial')))).toEqual([`10'0"`])
  expect(labels(buildFootingFloorplan(STRIP, ctx('metric')))).toEqual(['3.05m'])
})

test('a footing drag sizes to the whole inch while the grid snaps, not to the grid step; Alt is free', () => {
  useViewer.setState({ unit: 'imperial' })
  useEditor.setState((state) => ({
    gridSnapStep: 0.5,
    snappingModeByContext: { ...state.snappingModeByContext, polygon: 'grid' },
  }))
  useInteractionScope
    .getState()
    .begin({ kind: 'reshaping', nodeId: STRIP.id, reshape: 'width', driver: 'tool' })
  const drag = (altKey: boolean) => {
    const session = footingWidthAffordance.start({
      node: STRIP,
      payload: { side: 1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [1.5, 6 * IN],
      gridSnapStep: 0.5,
    })
    // Out 1.3 in: the width grows 2.6 in, from 12.
    session.apply({ planPoint: [1.5, 7.3 * IN], modifiers: { ...modifiers, altKey } })
    return useLiveNodeOverrides.getState().overrides.get(STRIP.id)?.width ?? 0
  }
  expect(drag(false) / IN).toBeCloseTo(15, 6)
  expect(drag(true) / IN).toBeCloseTo(14.6, 6)

  const pad = FootingNode.parse({ id: 'footing_pad', shape: 'pad', center: [0, 0], width: 0.6096 })
  const session = footingSizeAffordance.start({
    node: pad,
    payload: { dim: 'length', planAxis: [0, 1] },
    nodes: useScene.getState().nodes,
    initialPlanPoint: [0, 0.3],
    gridSnapStep: 0.5,
  })
  session.apply({ planPoint: [0, 0.3 + 2.2 * IN], modifiers })
  expect((useLiveNodeOverrides.getState().overrides.get(pad.id)?.length ?? 0) / IN).toBeCloseTo(
    28,
    6,
  )
})

test("a room's name and area move off a footing's outline", () => {
  const plan = buildFootingFloorplan(STRIP, { viewState: undefined } as unknown as GeometryContext)
  const outline = plan?.kind === 'group' ? plan.children.find((c) => c.kind === 'polygon') : null
  expect(outline && readFloorplanGeometryMetadata(outline).annotationObstacle).toBe('outline')
})
