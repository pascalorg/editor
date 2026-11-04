import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, useScene, WallNode, WindowNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { control, renderPanelControls, sections } from '../__tests__/panel-controls'
import WindowPanel from './panel'

const INCH = 0.0254

function select(window: Partial<WindowNode>, wall: Partial<WallNode> = {}) {
  const host = WallNode.parse({ id: 'wall_host', start: [0, 0], end: [6, 0], ...wall })
  const node = WindowNode.parse({
    id: 'window_panel',
    parentId: host.id,
    wallId: host.id,
    position: [3, 1.2, 0],
    ...window,
  })
  useScene.setState({
    nodes: { [host.id]: host, [node.id]: node } as Record<AnyNodeId, AnyNode>,
    materials: {},
  })
  useViewer.getState().setSelection({ selectedIds: [node.id] })
}
const live = () => useScene.getState().nodes['window_panel' as AnyNodeId] as WindowNode
const render = () => renderPanelControls(<WindowPanel />)

test('casement, awning and hopper sashes take a handle, on until turned off', () => {
  select({ windowType: 'casement' })
  const handle = control(render(), 'ToggleControl', 'Hardware', 'Handle')
  expect(handle.checked).toBe(true)
  handle.onChange(false)
  expect(live().windowHandle).toBe(false)
  expect(control(render(), 'ToggleControl', 'Hardware', 'Handle').checked).toBe(false)

  for (const windowType of ['awning', 'hopper'] as const) {
    select({ windowType })
    expect(sections(render()).has('Hardware')).toBe(true)
  }
  for (const windowType of ['fixed', 'double-hung', 'sliding'] as const) {
    select({ windowType })
    expect(sections(render()).has('Hardware')).toBe(false)
  }
})

test('an operable window divides each sash only once asked; a fixed window keeps its grid', () => {
  select({ windowType: 'double-hung' })
  const divide = control(render(), 'ToggleControl', 'Grid', 'Divide each sash')
  expect(divide.checked).toBe(false)
  expect(render().some((c) => c.section === 'Grid' && c.props.label === 'Columns')).toBe(false)
  divide.onChange(true)
  expect(live().sashGrid).toBe(true)
  expect(control(render(), 'SliderControl', 'Grid', 'Columns').value).toBe(1)

  select({ windowType: 'fixed' })
  const grid = render().filter((c) => c.section === 'Grid')
  expect(grid.some((c) => c.props.label === 'Divide each sash')).toBe(false)
  expect(control(grid, 'SliderControl', 'Grid', 'Columns').value).toBe(1)

  // A curved casement draws no sash grid, so it offers none.
  select({ windowType: 'casement', openingShape: 'arch' })
  expect(sections(render()).has('Grid')).toBe(false)
})

test('the sill section turns the room-side board on', () => {
  select({ windowType: 'fixed' })
  const board = control(render(), 'ToggleControl', 'Sill', 'Room-side board')
  expect(board.checked).toBe(false)
  board.onChange(true)
  expect(live().sillInterior).toBe(true)
})

test('shutters: a style, then a width that defaults to half the window and stays in range', () => {
  select({ windowType: 'fixed', width: 1 })
  const shuttersOf = () => control(render(), 'SegmentedControl', 'Shutters')
  expect(shuttersOf().value).toBe('none')
  expect(render().some((c) => c.section === 'Shutters' && c.kind === 'SliderControl')).toBe(false)
  shuttersOf().onChange('louvered')
  expect(live().shutters).toBe('louvered')

  const width = control(render(), 'SliderControl', 'Shutters', 'Width')
  expect(width.value).toBe(0.5)
  width.onChange(0.9)
  expect(live().shutterWidth).toBe(0.6)
  width.onChange(0.4)
  expect(live().shutterWidth).toBe(0.4)
  expect(control(render(), 'FinishSwatch', 'Shutters').paintRole).toBe('shutters')

  useViewer.setState({ unit: 'imperial' })
  const inches = control(render(), 'SliderControl', 'Shutters', 'Width')
  expect(inches.unit).toBe('in')
  expect(inches.value).toBeCloseTo(0.4 / INCH)
  inches.onChange(12)
  expect(live().shutterWidth).toBeCloseTo(12 * INCH)
})

test('no shutters where casing has nowhere to go', () => {
  select({ windowType: 'fixed' }, { wallType: 'curtain' })
  expect(sections(render()).has('Shutters')).toBe(false)
  select({
    windowType: 'fixed',
    corner: { end: 'end', partnerId: 'window_other', post: 'none' },
  })
  expect(sections(render()).has('Shutters')).toBe(false)
})
