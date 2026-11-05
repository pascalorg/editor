import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, DoorNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { control, renderPanelControls, sections } from '../__tests__/panel-controls'
import DoorPanel from './panel'

function select(door: DoorNode) {
  useScene.setState({ nodes: { [door.id]: door } as Record<AnyNodeId, AnyNode>, materials: {} })
  useViewer.getState().setSelection({ selectedIds: [door.id] })
}
const live = (id: string) => useScene.getState().nodes[id as AnyNodeId] as DoorNode
const handleStyle = () =>
  renderPanelControls(<DoorPanel />).find(
    (c) =>
      c.kind === 'SegmentedControl' &&
      c.props.options.some((option: { value: string }) => option.value === 'knob'),
  )?.props

test('the handle style shows Lever on a saved door and stores each pick, Lever included', () => {
  select(DoorNode.parse({ id: 'door_style', doorType: 'hinged' }))
  const style = handleStyle()!
  expect(style.value).toBe('lever')
  expect(style.options.map((o: { value: string }) => o.value)).toEqual([
    'lever',
    'lever-curved',
    'knob',
    'bar',
    'plate',
  ])
  style.onChange('knob')
  expect(live('door_style').handleStyle).toBe('knob')
  expect(handleStyle()!.value).toBe('knob')
  handleStyle()!.onChange('lever')
  expect(live('door_style').handleStyle).toBe('lever')
})

test('the handle style goes with the handle', () => {
  select(DoorNode.parse({ id: 'door_nohandle', doorType: 'hinged', handle: false }))
  expect(handleStyle()).toBeUndefined()
})

// The row is the paint tool's picker and write for that role (slab finish-swatch parity test).
test('the hardware finish row shows and paints the hardware slot, with the handle off too', () => {
  select(
    DoorNode.parse({
      id: 'door_finish',
      doorType: 'hinged',
      handle: false,
      slots: { hardware: 'library:metal-black' },
    }),
  )
  const finish = control(renderPanelControls(<DoorPanel />), 'FinishSwatch', 'Hardware')
  expect(finish.paintRole).toBe('hardware')
  expect(finish.node.id).toBe('door_finish')
  expect(finish.value).toBe('library:metal-black')
})

const render = () => renderPanelControls(<DoorPanel />)
/** The segmented row in `section` that offers `value`. */
const segmented = (section: string, value: string) =>
  render().find(
    (c) =>
      c.kind === 'SegmentedControl' &&
      c.section === section &&
      c.props.options.some((option: { value: string }) => option.value === value),
  )?.props
const shown = (section: string, label: string) =>
  render().some((c) => c.section === section && c.props.label === label)

test('size comes right after the type and style, then position', () => {
  select(DoorNode.parse({ id: 'door_order', doorType: 'hinged' }))
  expect([...sections(render())]).toEqual([
    'Type',
    'Dimensions',
    'Position',
    'Segments',
    'Top shape',
    'Swing',
    'Frame',
    'Threshold',
    'Hardware',
  ])
})

test('a swing door opens to an angle shown in degrees and stored in radians', () => {
  for (const doorType of ['hinged', 'double', 'french'] as const) {
    select(DoorNode.parse({ id: 'door_swing', doorType }))
    expect(control(render(), 'SliderControl', 'Swing', 'Open').unit).toBe('°')
  }
  control(render(), 'SliderControl', 'Swing', 'Open').onChange(45)
  expect(live('door_swing').swingAngle).toBeCloseTo(Math.PI / 4)
  expect(control(render(), 'SliderControl', 'Swing', 'Open').value).toBe(45)
})

test('the hinge side places the handle: no handle side row', () => {
  select(DoorNode.parse({ id: 'door_handle_side', doorType: 'hinged' }))
  expect(segmented('Hardware', 'left')).toBeUndefined()
  expect(segmented('Swing', 'left')).toBeDefined()
})

test('a segment panel can be recessed as well as raised, to the 12 mm the leaf carves', () => {
  const door = DoorNode.parse({ id: 'door_depth', doorType: 'hinged' })
  const segment = door.segments.findIndex((s) => s.type === 'panel')
  select(door)
  const depth = render().filter((c) => c.section === 'Segments' && c.props.label === 'Depth')[0]!
    .props
  expect([depth.min, depth.max, depth.step]).toEqual([-0.012, 0.012, 0.001])
  depth.onChange(-0.006)
  expect(live('door_depth').segments[segment]!.panelDepth).toBe(-0.006)
})

test('pocket, sliding, folding and barn doors show only the hardware finish', () => {
  for (const doorType of ['pocket', 'sliding', 'folding', 'barn'] as const) {
    select(DoorNode.parse({ id: 'door_slide_hw', doorType }))
    const hardware = render().filter((c) => c.section === 'Hardware')
    expect(hardware.map((c) => c.kind)).toEqual(['FinishSwatch'])
    expect(hardware[0]!.props.paintRole).toBe('hardware')
  }
  select(DoorNode.parse({ id: 'door_garage_hw', doorType: 'garage-sectional' }))
  expect(sections(render()).has('Hardware')).toBe(false)
})

test('a swing door takes sidelights and a transom; 0 is none', () => {
  select(DoorNode.parse({ id: 'door_lights', doorType: 'hinged' }))
  control(render(), 'SliderControl', 'Dimensions', 'Left sidelight').onChange(0.35)
  expect(live('door_lights').sidelightLeft).toBe(0.35)
  control(render(), 'SliderControl', 'Dimensions', 'Right sidelight').onChange(0.3)
  expect(live('door_lights').sidelightRight).toBe(0.3)
  control(render(), 'SliderControl', 'Dimensions', 'Transom').onChange(0.4)
  expect(live('door_lights').transomHeight).toBe(0.4)
  control(render(), 'SliderControl', 'Dimensions', 'Left sidelight').onChange(0)
  expect(live('door_lights').sidelightLeft).toBeUndefined()

  for (const doorType of ['sliding', 'pocket', 'folding'] as const) {
    select(DoorNode.parse({ id: 'door_nolights', doorType }))
    expect(shown('Dimensions', 'Left sidelight')).toBe(false)
    expect(shown('Dimensions', 'Transom')).toBe(false)
  }
})

test('a sliding door picks a patio or bypass layout of two to four panels', () => {
  select(DoorNode.parse({ id: 'door_sliding', doorType: 'sliding', leafCount: 2 }))
  expect(segmented('Slide', 'bypass')!.value).toBe('patio')
  segmented('Slide', 'bypass')!.onChange('bypass')
  expect(live('door_sliding').slidingStyle).toBe('bypass')
  const panels = segmented('Slide', '3')!
  expect(panels.options.map((o: { value: string }) => o.value)).toEqual(['2', '3', '4'])
  panels.onChange('4')
  expect(live('door_sliding').leafCount).toBe(4)

  // Pocket and barn doors have one leaf: no layout, no panel count.
  for (const doorType of ['pocket', 'barn'] as const) {
    select(DoorNode.parse({ id: 'door_single_slide', doorType }))
    expect(segmented('Slide', 'bypass')).toBeUndefined()
    expect(segmented('Slide', '3')).toBeUndefined()
  }
})

test('a folding door folds 2, 4, 6 or 8 panels', () => {
  select(DoorNode.parse({ id: 'door_folding', doorType: 'folding', leafCount: 4 }))
  const panels = segmented('Fold', '6')!
  expect(panels.options.map((o: { value: string }) => o.value)).toEqual(['2', '4', '6', '8'])
  expect(panels.value).toBe('4')
  panels.onChange('8')
  expect(live('door_folding').leafCount).toBe(8)
})
