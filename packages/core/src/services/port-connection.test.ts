import { expect, test } from 'bun:test'
import { connectionCompatibility, type NodePort, portConnection } from '../index'

const outlet: NodePort = {
  id: 'out',
  position: [0, 0, 0],
  direction: [1, 0, 0],
  diameter: 8,
  system: 'supply',
}
const inlet: NodePort = { ...outlet, id: 'in', direction: [-1, 0, 0] }

test('physical joints require proximity, opposing directions, system and section agreement', () => {
  expect(portConnection(outlet, inlet).status).toBe('match')
  expect(portConnection(outlet, { ...inlet, position: [0.06, 0, 0] }).status).toBe('incompatible')
  expect(portConnection(outlet, { ...inlet, direction: [0, 1, 0] }).status).toBe('incompatible')
  expect(portConnection(outlet, { ...inlet, direction: [0, 0, 0] }).status).toBe('unknown')
  expect(portConnection(outlet, { ...inlet, system: 'return' }).status).toBe('incompatible')
  expect(portConnection(outlet, { ...inlet, diameter: 10 }).status).toBe('adapter')
  expect(portConnection(outlet, { ...inlet, shape: 'rect', width: 8, height: 8 }).status).toBe(
    'adapter',
  )
  expect(portConnection(outlet, { ...inlet, system: undefined }).status).toBe('unknown')
})

test('refrigerant subtypes cannot join, but node-local flow groups need not share an id', () => {
  const suction = { ...outlet, system: 'refrigerant', connectionType: 'suction' }
  const liquid = { ...inlet, system: 'refrigerant', connectionType: 'liquid' }
  expect(portConnection(suction, liquid).status).toBe('incompatible')
  expect(
    portConnection({ ...outlet, group: 'equipment-air' }, { ...inlet, group: 'run' }).status,
  ).toBe('match')
})

test('rectangular profile comparison uses dimensions instead of equivalent diameter', () => {
  const section = { ...outlet, shape: 'rect' as const, width: 12, height: 8 }
  expect(connectionCompatibility(section, { ...section, diameter: 99 }).status).toBe('match')
  expect(connectionCompatibility(section, { ...section, width: 8, height: 12 }).status).toBe(
    'adapter',
  )
  expect(connectionCompatibility(section, { ...section, width: undefined }).status).toBe('unknown')
})
