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

test('the sill section turns the inside sill on', () => {
  select({ windowType: 'fixed' })
  const board = control(render(), 'ToggleControl', 'Sill', 'Inside sill')
  expect(board.checked).toBe(false)
  board.onChange(true)
  expect(live().sillInterior).toBe(true)
})

test('shutters: a style, then a width that defaults to half the window and stays in range', () => {
  select({ windowType: 'fixed', width: 1.6 })
  const shuttersOf = () => segmented('Shutters', 'louvered')!
  expect(shuttersOf().value).toBe('none')
  expect(render().some((c) => c.section === 'Shutters' && c.kind === 'SliderControl')).toBe(false)
  shuttersOf().onChange('louvered')
  expect(live().shutters).toBe('louvered')

  const width = control(render(), 'SliderControl', 'Shutters', 'Width')
  expect(width.value).toBe(0.8)
  expect(width.max).toBe(1.6)
  width.onChange(2)
  expect(live().shutterWidth).toBe(1.6)
  width.onChange(0.05)
  expect(live().shutterWidth).toBe(0.15)
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

test('a single shutter defaults to the full window width', () => {
  select({ windowType: 'fixed', width: 1.6, shutters: 'panel', shutterSides: 'left' })
  expect(control(render(), 'SliderControl', 'Shutters', 'Width').value).toBe(1.6)
  select({ windowType: 'fixed', width: 1.6, shutters: 'panel', shutterSides: 'both' })
  expect(control(render(), 'SliderControl', 'Shutters', 'Width').value).toBe(0.8)
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

/** The segmented row in `section` that offers `value`. */
const segmented = (section: string, value: string) =>
  render().find(
    (c) =>
      c.kind === 'SegmentedControl' &&
      c.section === section &&
      c.props.options.some((option: { value: string }) => option.value === value),
  )?.props
const slidersIn = (section: string, label: string) =>
  render().filter(
    (c) => c.kind === 'SliderControl' && c.section === section && c.props.label === label,
  )

test('size comes right after the type, then position; hardware after the trim', () => {
  select({ windowType: 'casement' })
  expect([...sections(render())]).toEqual([
    'Type',
    'Dimensions',
    'Position',
    'Grid',
    'Top shape',
    'Swing',
    'Frame',
    'Sill',
    'Casing',
    'Shutters',
    'Hardware',
  ])
})

test('tilt-and-turn: tilt or turn, the hinges side when it turns, and how far it opens', () => {
  select({ windowType: 'tilt-turn' })
  expect(segmented('Tilt and turn', 'turn')!.value).toBe('tilt')
  expect(segmented('Tilt and turn', 'left')).toBeUndefined()
  segmented('Tilt and turn', 'turn')!.onChange('turn')
  expect(live().tiltTurnMode).toBe('turn')
  segmented('Tilt and turn', 'left')!.onChange('right')
  expect(live().hingesSide).toBe('right')
  control(render(), 'SliderControl', 'Tilt and turn', 'Open').onChange(0.5)
  expect(live().operationState).toBe(0.5)
  expect(sections(render()).has('Hardware')).toBe(true)
})

test('casement and awning sashes open outward or inward; a saved one shows how it opens today', () => {
  select({ windowType: 'casement', side: 'front' })
  expect(segmented('Swing', 'inward')!.value).toBe('outward')
  select({ windowType: 'casement', side: 'back' })
  expect(segmented('Swing', 'inward')!.value).toBe('inward')
  segmented('Swing', 'inward')!.onChange('outward')
  expect(live().openingDirection).toBe('outward')

  select({ windowType: 'awning', openingDirection: 'inward' })
  expect(segmented('Tilt', 'inward')!.value).toBe('inward')
  for (const windowType of ['hopper', 'double-hung', 'tilt-turn'] as const) {
    select({ windowType })
    expect(
      render().some((c) => c.props.options?.some((o: { value: string }) => o.value === 'inward')),
    ).toBe(false)
  }
})

test('the outside sill overhangs the opening and the sills take their own finish', () => {
  select({ windowType: 'fixed', sill: true, sillDepth: 0.1 })
  const overhang = slidersIn('Sill', 'Overhang')
  expect(overhang).toHaveLength(1)
  expect(overhang[0]!.props.value).toBeCloseTo(0.04)
  overhang[0]!.props.onChange(0.05)
  expect(live().sillOverhang).toBe(0.05)
  const finish = control(render(), 'FinishSwatch', 'Sill')
  expect(finish.paintRole).toBe('sill')

  select({ windowType: 'fixed', sill: false })
  expect(render().some((c) => c.section === 'Sill' && c.kind === 'FinishSwatch')).toBe(false)
})

test('the inside sill sizes show once it is on and write its own fields', () => {
  select({ windowType: 'fixed', sill: false })
  expect(slidersIn('Sill', 'Depth')).toHaveLength(0)
  select({ windowType: 'fixed', sill: false, sillInterior: true })
  control(render(), 'SliderControl', 'Sill', 'Depth').onChange(0.25)
  expect(live().sillInteriorDepth).toBe(0.25)
  control(render(), 'SliderControl', 'Sill', 'Thickness').onChange(0.04)
  expect(live().sillInteriorThickness).toBe(0.04)
  control(render(), 'SliderControl', 'Sill', 'Overhang').onChange(0.1)
  expect(live().sillInteriorOverhang).toBe(0.1)
  expect(control(render(), 'FinishSwatch', 'Sill').paintRole).toBe('sill')
})

test('shutters: board and batten, which sides, and how far they stand open', () => {
  select({ windowType: 'fixed', shutters: 'louvered' })
  expect(segmented('Shutters', 'louvered')!.options.map((o: { value: string }) => o.value)).toEqual(
    ['none', 'louvered', 'panel', 'board-batten'],
  )
  segmented('Shutters', 'louvered')!.onChange('board-batten')
  expect(live().shutters).toBe('board-batten')
  expect(segmented('Shutters', 'both')!.value).toBe('both')
  segmented('Shutters', 'both')!.onChange('left')
  expect(live().shutterSides).toBe('left')
  const open = control(render(), 'SliderControl', 'Shutters', 'Open')
  expect(open.value).toBe(100)
  open.onChange(25)
  expect(live().shutterOpen).toBe(0.25)

  select({ windowType: 'fixed' })
  expect(segmented('Shutters', 'both')).toBeUndefined()
})

test('a roller shutter mounts in a box or concealed, with its own opening and the shutter finish', () => {
  select({ windowType: 'fixed' })
  const roller = () => segmented('Shutters', 'concealed')!
  expect(roller().options.map((o: { value: string }) => o.value)).toEqual([
    'none',
    'box',
    'concealed',
  ])
  expect(roller().value).toBe('none')
  expect(slidersIn('Shutters', 'Open')).toHaveLength(0)
  expect(render().some((c) => c.section === 'Shutters' && c.kind === 'FinishSwatch')).toBe(false)

  roller().onChange('box')
  expect(live().rollerShutter).toBe('box')
  const open = control(render(), 'SliderControl', 'Shutters', 'Open')
  expect(open.value).toBe(100)
  open.onChange(40)
  expect(live().rollerShutterOpen).toBe(0.4)
  expect(control(render(), 'FinishSwatch', 'Shutters').paintRole).toBe('shutters')

  roller().onChange('concealed')
  expect(live().rollerShutter).toBe('concealed')
  expect(slidersIn('Shutters', 'Open')).toHaveLength(1)

  // None is written, not cleared: an absent field is only what a saved window meant before.
  roller().onChange('none')
  expect(live().rollerShutter).toBe('none')
  expect(slidersIn('Shutters', 'Open')).toHaveLength(0)
})

test('only a boxed roller shutter takes a box height', () => {
  select({ windowType: 'fixed', rollerShutter: 'box' })
  const height = control(render(), 'SliderControl', 'Shutters', 'Box height')
  expect(height.value).toBe(0.18)
  expect([height.min, height.max]).toEqual([0.12, 0.35])
  height.onChange(0.25)
  expect(live().rollerShutterBoxHeight).toBe(0.25)

  for (const rollerShutter of ['none', 'concealed'] as const) {
    select({ windowType: 'fixed', rollerShutter })
    expect(slidersIn('Shutters', 'Box height')).toHaveLength(0)
  }
})
