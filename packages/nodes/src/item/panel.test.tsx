import { describe, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  getScaledDimensions,
  ItemNode,
  useScene,
} from '@pascal-app/core'
import * as editor from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import React, { type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { control, renderPanelControls, sections } from '../__tests__/panel-controls'
import { computeScaleForDimension, editableDimensionAxes, MIN_ITEM_SCALE } from './dimensions'
import ItemPanel from './panel'

function makeItem(overrides: Partial<ItemNode> = {}): ItemNode {
  return ItemNode.parse({
    id: 'item_dim_test',
    name: 'Oak Desk',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    asset: {
      id: 'desk-1',
      category: 'furniture',
      name: 'Oak Desk',
      thumbnail: '',
      src: '/models/desk.glb',
      dimensions: [1.8, 0.75, 0.9],
    },
    ...overrides,
  })
}

function selectItem(item: ItemNode) {
  useScene.temporal.getState().clear()
  useScene.setState({ nodes: { [item.id]: item } as Record<AnyNodeId, AnyNode>, materials: {} })
  useScene.temporal.getState().clear()
  useViewer.getState().setSelection({ selectedIds: [item.id] })
}

const liveItem = (id: string) => useScene.getState().nodes[id as AnyNodeId] as ItemNode

describe('item physical dimension scale math (#1307)', () => {
  test('unlocked edit updates only the edited axis to requested / asset.dimensions[axis]', () => {
    const next = computeScaleForDimension([1.8, 0.75, 0.9], [1, 1, 1], 0, 0.9, false)
    expect(next).toEqual([0.5, 1, 1])

    const nextHeight = computeScaleForDimension([1.8, 0.75, 0.9], [0.5, 1, 1], 1, 1.5, false)
    expect(nextHeight).toEqual([0.5, 2, 1])

    const nextDepth = computeScaleForDimension([1.8, 0.75, 0.9], [0.5, 2, 1], 2, 0.45, false)
    expect(nextDepth).toEqual([0.5, 2, 0.5])
  })

  test('uniform lock applies the same factor to all three axes and preserves aspect ratio', () => {
    const fromUniform = computeScaleForDimension([1.8, 0.75, 0.9], [1, 1, 1], 0, 0.9, true)
    expect(fromUniform).toEqual([0.5, 0.5, 0.5])

    // Already non-uniform item (3.6 x 0.75 x 0.9): halving width to 1.8 halves all three axes.
    const fromNonUniform = computeScaleForDimension([1.8, 0.75, 0.9], [2, 1, 1], 0, 1.8, true)
    expect(fromNonUniform).toEqual([1, 0.5, 0.5])
  })

  test('preserves negative mirrored signs and enforces MIN_ITEM_SCALE floor', () => {
    const mirrored = computeScaleForDimension([2, 1, 1], [-1, 1, 1], 0, 1, true)
    expect(mirrored).toEqual([-0.5, 0.5, 0.5])

    const clamped = computeScaleForDimension([2, 1, 1], [1, 1, 1], 0, 0.001, false)
    expect(clamped).toEqual([MIN_ITEM_SCALE, 1, 1])
  })

  test('guards against missing, zero, negative, or non-finite asset dimensions', () => {
    expect(editableDimensionAxes(undefined)).toEqual([])
    expect(editableDimensionAxes([0, 0, 0])).toEqual([])
    expect(editableDimensionAxes([1.2, 0, 0.8])).toEqual([0, 2])
    expect(editableDimensionAxes([Number.NaN, -1, Number.POSITIVE_INFINITY])).toEqual([])

    expect(computeScaleForDimension(undefined, [1, 1, 1], 0, 0.9, true)).toBeNull()
    expect(computeScaleForDimension([0, 1, 1], [1, 1, 1], 0, 0.9, true)).toBeNull()
    expect(computeScaleForDimension([0, 1, 1], [1, 1, 1], 0, 0.9, false)).toBeNull()
    expect(computeScaleForDimension([1, 1, 1], [1, 1, 1], 0, 0, true)).toBeNull()
    expect(computeScaleForDimension([1, 1, 1], [1, 1, 1], 0, -0.5, false)).toBeNull()
    expect(computeScaleForDimension([1, 1, 1], [1, 1, 1], 0, Number.NaN, true)).toBeNull()
  })
})

describe('ItemPanel editable dimensions (#1307)', () => {
  test('renders unit-aware W/H/D controls, updates scale, and undoes in one step', () => {
    const item = makeItem()
    selectItem(item)

    const controls = renderPanelControls(<ItemPanel />)
    expect([...sections(controls)]).toContain('Dimensions')

    const widthCtrl = control(controls, 'SliderControl', 'Dimensions', 'Width')
    const heightCtrl = control(controls, 'SliderControl', 'Dimensions', 'Height')
    const depthCtrl = control(controls, 'SliderControl', 'Dimensions', 'Depth')

    expect(widthCtrl.unit).toBe('m')
    expect(heightCtrl.unit).toBe('m')
    expect(depthCtrl.unit).toBe('m')
    expect(widthCtrl.value).toBeCloseTo(1.8, 6)
    expect(heightCtrl.value).toBeCloseTo(0.75, 6)
    expect(depthCtrl.value).toBeCloseTo(0.9, 6)

    // Typing Width = 0.9 m with uniform lock on (default) scales all three axes to 0.5.
    widthCtrl.onChange(0.9)
    widthCtrl.onCommit?.(0.9)
    expect(liveItem(item.id).scale).toEqual([0.5, 0.5, 0.5])
    expect(getScaledDimensions(liveItem(item.id))).toEqual([0.9, 0.375, 0.45])

    // Undo restores the previous scale in one step.
    useScene.temporal.getState().undo()
    expect(liveItem(item.id).scale).toEqual([1, 1, 1])

    // Dragging (temporal paused) followed by commit records a single undo step back to origin.
    useScene.temporal.getState().pause()
    const dragWidthCtrl = control(
      renderPanelControls(<ItemPanel />),
      'SliderControl',
      'Dimensions',
      'Width',
    )
    dragWidthCtrl.onChange(1.2)
    dragWidthCtrl.onChange(0.9)
    useScene.temporal.getState().resume()
    dragWidthCtrl.onCommit?.(0.9)
    expect(liveItem(item.id).scale).toEqual([0.5, 0.5, 0.5])

    useScene.temporal.getState().undo()
    expect(liveItem(item.id).scale).toEqual([1, 1, 1])

    // Unchanged dimension write is a no-op and does not push a spurious undo entry.
    const beforePast = useScene.temporal.getState().pastStates.length
    const unchangedCtrl = control(
      renderPanelControls(<ItemPanel />),
      'SliderControl',
      'Dimensions',
      'Width',
    )
    unchangedCtrl.onChange(1.8)
    unchangedCtrl.onCommit?.(1.8)
    expect(useScene.temporal.getState().pastStates.length).toBe(beforePast)

    // Cancelling a drag restores the origin scale without recording an undo step.
    useScene.temporal.getState().pause()
    const cancelCtrl = control(
      renderPanelControls(<ItemPanel />),
      'SliderControl',
      'Dimensions',
      'Width',
    )
    cancelCtrl.onChange(0.9)
    expect(liveItem(item.id).scale).toEqual([0.5, 0.5, 0.5])
    useScene.temporal.getState().resume()
    cancelCtrl.onCancel?.()
    expect(liveItem(item.id).scale).toEqual([1, 1, 1])
    expect(useScene.temporal.getState().pastStates.length).toBe(beforePast)
  })

  test('renders lock toggle button with accessible attributes and omits zero axes', () => {
    const partial = makeItem({
      id: 'item_partial_dim',
      asset: {
        id: 'rug-1',
        category: 'furniture',
        name: 'Flat Rug',
        thumbnail: '',
        src: '/models/rug.glb',
        dimensions: [2, 0, 1.5],
      },
    })
    selectItem(partial)

    const controls = renderPanelControls(<ItemPanel />)
    const dimLabels = controls
      .filter((c) => c.kind === 'SliderControl' && c.section === 'Dimensions')
      .map((c) => c.props.label)
    expect(dimLabels).toEqual(['Width', 'Depth'])

    const useSyncExternalStore = React.useSyncExternalStore
    const spies = [
      spyOn(editor, 'PanelWrapper').mockImplementation((({ children }: { children: ReactNode }) => (
        <>{children}</>
      )) as never),
      spyOn(React, 'useSyncExternalStore').mockImplementation((subscribe, getSnapshot) =>
        useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
      ),
    ]
    let markup = ''
    try {
      markup = renderToStaticMarkup(<ItemPanel />)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
    expect(markup).toContain('aria-label="Lock Aspect Ratio"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('aria-label="Uniform Scale"')
  })

  test('falls back to scale controls when asset.dimensions are zero', () => {
    const item = makeItem({
      id: 'item_zero_dim',
      asset: {
        id: 'empty-1',
        category: 'furniture',
        name: 'Zero Dim Asset',
        thumbnail: '',
        src: '/models/empty.glb',
        dimensions: [0, 0, 0],
      },
    })
    selectItem(item)

    const controls = renderPanelControls(<ItemPanel />)
    expect([...sections(controls)]).toContain('Scale')
    expect([...sections(controls)]).not.toContain('Dimensions')
  })
})
