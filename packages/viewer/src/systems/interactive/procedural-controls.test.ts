import { expect, test } from 'bun:test'
import type { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { proceduralControlDescriptors } from './procedural-controls'

test('motion controls and one Lights switch route to independent commands', () => {
  const parts = [
    { id: 'door', label: 'Door', motion: { kind: 'hinge' } },
    { id: 'bulb', label: 'Bulb', light: {} },
    { id: 'second_bulb', label: 'Second bulb', light: {} },
  ] as unknown as ProceduralItemNode['recipe']['parts']
  const commands: string[] = []
  const controls = proceduralControlDescriptors(
    parts,
    { parts: { door: false }, lightsOn: true },
    (partId) => commands.push(partId),
    () => commands.push('lights'),
  )
  expect(controls.map((control) => control.control.label)).toEqual(['Door', 'Lights'])
  expect(controls.map((control) => control.value)).toEqual([false, true])
  for (const control of controls) control.onChange(false)
  expect(commands).toEqual(['door', 'lights'])
})
