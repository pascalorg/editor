import { describe, expect, test } from 'bun:test'
import { pipeSegmentDefinition } from './definition'
import { buildPipeSegmentFloorplan } from './floorplan'
import { PipeSegmentNode } from './schema'

describe('pipe segment defaults', () => {
  test('declares surface-aware, history-cancellable drafting behavior', () => {
    expect(pipeSegmentDefinition.drafting).toEqual({
      surfaceQuery: true,
      cancelOnHistoryJump: true,
    })
  })

  test('rests a level pipe on top of the support grid', () => {
    const pipe = pipeSegmentDefinition.defaults()
    const radius = (pipe.diameter * 0.0254) / 2

    expect(pipe.path[0]?.[1]).toBeCloseTo(radius)
    expect(pipe.path[1]?.[1]).toBeCloseTo(radius)
  })

  test('shows click-only continuation plus handles beyond selected plan endpoints', () => {
    const pipe = PipeSegmentNode.parse({
      ...pipeSegmentDefinition.defaults(),
      path: [
        [0, 0.0254, 0],
        [2, 0.0254, 0],
      ],
    })
    const geometry = buildPipeSegmentFloorplan(pipe, {
      viewState: { selected: true },
    } as never)
    const handles =
      geometry?.kind === 'group'
        ? geometry.children.filter(
            (child) =>
              child.kind === 'midpoint-handle' &&
              child.activation === 'action' &&
              child.affordance === 'continue-run',
          )
        : []

    expect(handles).toHaveLength(2)
    const points = handles.map((handle) => handle.kind === 'midpoint-handle' && handle.point)
    expect(points[0]?.[0]).toBeCloseTo(-0.28)
    expect(points[0]?.[1]).toBeCloseTo(0)
    expect(points[1]?.[0]).toBeCloseTo(2.28)
    expect(points[1]?.[1]).toBeCloseTo(0)
  })
})
