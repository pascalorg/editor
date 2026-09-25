import { afterEach, expect, test } from 'bun:test'
import { type AnyNode, useInteractive } from '@pascal-app/core'
import {
  itemHasLights,
  itemHasMechanisms,
  itemLightsOn,
  itemMechanismsOn,
  toggleItemLights,
  toggleItemMechanisms,
} from './item-interactions'

const catalogItem = (id: string, interactive: unknown) =>
  ({ id, type: 'item', asset: { interactive } }) as unknown as AnyNode

const proceduralItem = (id: string, parts: unknown[]) =>
  ({ id, type: 'procedural-item', recipe: { parts } }) as unknown as AnyNode

const ids: string[] = []
afterEach(() => {
  const state = useInteractive.getState()
  for (const id of ids.splice(0)) {
    state.removeItem(id as never)
    state.removeProcedural(id as never)
  }
})

test('a catalog lamp with an animated part splits its first toggle off as the light', () => {
  const node = catalogItem('item_lamp_fan', {
    controls: [{ kind: 'toggle' }, { kind: 'toggle' }],
    effects: [
      { kind: 'light', color: '#fff', intensityRange: [0, 1], offset: [0, 0, 0] },
      { kind: 'animation', clips: { on: 'Spin' } },
    ],
  })
  ids.push(node.id)
  expect(itemHasLights(node)).toBe(true)
  expect(itemHasMechanisms(node)).toBe(true)

  toggleItemMechanisms(node)
  expect(useInteractive.getState().items[node.id as never]?.controlValues).toEqual([false, true])
  expect(itemMechanismsOn(node, useInteractive.getState())).toBe(true)
  expect(itemLightsOn(node, useInteractive.getState())).toBe(false)

  toggleItemLights(node)
  expect(useInteractive.getState().items[node.id as never]?.controlValues).toEqual([true, true])

  toggleItemMechanisms(node)
  expect(useInteractive.getState().items[node.id as never]?.controlValues).toEqual([true, false])
})

test('a catalog item without an animation effect has no mechanisms', () => {
  const node = catalogItem('item_plain_lamp', {
    controls: [{ kind: 'toggle' }, { kind: 'slider', label: 'Intensity', min: 0, max: 1 }],
    effects: [{ kind: 'light', color: '#fff', intensityRange: [0, 1], offset: [0, 0, 0] }],
  })
  expect(itemHasMechanisms(node)).toBe(false)
  expect(itemHasLights(node)).toBe(true)
})

test('procedural motion parts toggle together: any running stops all, else starts all', () => {
  const node = proceduralItem('procedural_cabinet', [
    { id: 'door', motion: { kind: 'hinge' } },
    { id: 'drawer', motion: { kind: 'slide' } },
    { id: 'bulb', light: {} },
  ])
  ids.push(node.id)
  expect(itemHasMechanisms(node)).toBe(true)
  expect(itemHasLights(node)).toBe(true)

  useInteractive.getState().setProceduralParts(node.id as never, ['door'], true)
  toggleItemMechanisms(node)
  expect(useInteractive.getState().procedural[node.id as never]?.parts).toEqual({
    door: false,
    drawer: false,
  })
  toggleItemMechanisms(node)
  expect(itemMechanismsOn(node, useInteractive.getState())).toBe(true)

  const lit = itemLightsOn(node, useInteractive.getState())
  toggleItemLights(node)
  expect(itemLightsOn(node, useInteractive.getState())).toBe(!lit)
})
