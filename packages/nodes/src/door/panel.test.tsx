import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, DoorNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { control, renderPanelControls } from '../__tests__/panel-controls'
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
