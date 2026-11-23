import { expect, test } from 'bun:test'
import type { AnyNodeId, Interactive, InteractiveState } from '@pascal-app/core'
import type { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { calloutSubtitle, interactiveActions, proceduralActions } from './callout-actions'

const state = (procedural: InteractiveState['procedural'] = {}) =>
  ({ procedural, lampDefault: false }) as unknown as InteractiveState

test('a procedural item offers each moving part by name, then one Lights switch', () => {
  const parts = [
    { id: 'door', label: 'Door', motion: { kind: 'hinge' } },
    { id: 'bulb', label: 'Bulb', light: {} },
    { id: 'second_bulb', label: 'Second bulb', light: {} },
  ] as unknown as ProceduralItemNode['recipe']['parts']
  const actions = proceduralActions(
    'item_a' as AnyNodeId,
    'Lamp',
    { parts },
    state({ item_a: { parts: { door: false }, lightsOn: true } } as never),
  )
  expect(
    actions.map((action) =>
      action.kind === 'toggle' ? [action.icon, action.text, action.on] : null,
    ),
  ).toEqual([
    ['door', 'Door', false],
    ['light', undefined, true],
  ])
})

test('continuous joints start running, fixed ones get no control', () => {
  const parts = [
    { id: 'lid', label: 'Lid' },
    { id: 'fan', label: 'Fan' },
    { id: 'plate', label: 'Plate' },
  ] as unknown as ProceduralItemNode['recipe']['parts']
  const joints = [
    { child: 'lid', kind: 'revolute' },
    { child: 'fan', kind: 'continuous' },
    { child: 'plate', kind: 'fixed' },
  ] as unknown as ProceduralItemNode['recipe']['joints']
  const actions = proceduralActions('item_b' as AnyNodeId, 'Cooker', { parts, joints }, state())
  expect(actions.map((action) => [action.key, action.kind === 'toggle' && action.on])).toEqual([
    ['lid', false],
    ['fan', true],
  ])
})

test("a lamp's first toggle is its light switch; an open clip reads Open and Closed", () => {
  const interactive = {
    controls: [
      { kind: 'toggle' },
      { kind: 'toggle', label: 'Open' },
      { kind: 'slider', label: 'Dim', min: 0, max: 10, step: 1 },
    ],
    effects: [
      { kind: 'light', color: '#fff', intensityRange: [0, 1], offset: [0, 0, 0] },
      { kind: 'animation', mode: 'open-close', control: 1, clips: {} },
    ],
  } as unknown as Interactive
  const set: [number, unknown][] = []
  const actions = interactiveActions('Cabinet lamp', interactive, [true, false, 4], (i, v) =>
    set.push([i, v]),
  )
  expect(
    actions.map((action) => (action.kind === 'toggle' ? [action.icon, action.on] : action.kind)),
  ).toEqual([['light', true], ['door', false], 'range'])
  for (const action of actions) if (action.kind === 'toggle') action.toggle()
  expect(set).toEqual([
    [0, false],
    [1, true],
  ])
})

test('the detail line names the kind of opening', () => {
  const message = (node: object) =>
    (calloutSubtitle(node as never, 'Kitchen') as { message?: string } | null)?.message
  expect(message({ type: 'window', windowType: 'single-hung' })).toBe('Single-hung window')
  expect(message({ type: 'door', doorType: 'garage-rollup' })).toBe('Roll-up garage door')
  expect(message({ type: 'door', openingKind: 'opening' })).toBe('Opening')
})
