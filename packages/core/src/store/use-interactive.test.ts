import { afterEach, expect, test } from 'bun:test'
import { scriptInteractive } from '../lib/geometry-script-node'
import type { AnyNodeId } from '../schema/types'
import { itemPrompt, operateItem } from './item-interaction'
import { useInteractive } from './use-interactive'

const lamp = {
  controls: [
    { kind: 'toggle' as const, label: 'Power' },
    { kind: 'toggle' as const, label: 'Bulbs' },
  ],
  effects: [
    {
      kind: 'light' as const,
      color: '#ffffff',
      offset: [0, 0, 0] as [number, number, number],
      intensityRange: [0, 2] as [number, number],
    },
  ],
}
const fan = {
  controls: [{ kind: 'toggle' as const, label: 'Spin' }],
  effects: [{ kind: 'animation' as const, clips: { on: 'On' } }],
}

afterEach(() => {
  useInteractive.setState({ items: {}, procedural: {}, lampItems: {}, lampDefault: false })
})

test('lamps follow theme changes and clear session overrides', () => {
  const id = 'item_lamp' as AnyNodeId
  const proceduralId = 'procedural_lamp' as AnyNodeId
  const store = useInteractive.getState()
  store.initItem(id, lamp)
  store.initProcedural(proceduralId, [])
  expect(useInteractive.getState().items[id]?.controlValues).toEqual([false, false])
  expect(useInteractive.getState().procedural[proceduralId]?.lightsOn).toBe(false)

  store.setLampDefault(true)
  expect(useInteractive.getState().items[id]?.controlValues).toEqual([true, false])
  expect(useInteractive.getState().procedural[proceduralId]?.lightsOn).toBe(true)
  store.toggleItemToggles(id, lamp)
  store.toggleProceduralLights(proceduralId)
  expect(useInteractive.getState().items[id]?.controlValues).toEqual([false, false])
  expect(useInteractive.getState().procedural[proceduralId]?.lightsOn).toBe(false)

  store.setLampDefault(false)
  store.setLampDefault(true)
  expect(useInteractive.getState().items[id]?.controlValues).toEqual([true, false])
  expect(useInteractive.getState().procedural[proceduralId]?.lightsOn).toBe(true)
  store.toggleItemToggles(id, lamp)
  store.setLampDefault(true, true)
  expect(useInteractive.getState().items[id]?.controlValues).toEqual([true, false])
})

test('an authored catalog light default wins at initialization', () => {
  const id = 'item_authored_lamp' as AnyNodeId
  useInteractive.getState().initItem(id, {
    ...lamp,
    controls: [{ kind: 'toggle', default: true }],
  })
  expect(useInteractive.getState().items[id]?.controlValues).toEqual([true])
})

test('catalog E toggles all switches together; non-light baked defaults stay on', () => {
  const lampId = 'item_two_switches' as AnyNodeId
  const editorFanId = 'item_editor_fan' as AnyNodeId
  const bakedFanId = 'item_baked_fan' as AnyNodeId
  const store = useInteractive.getState()
  store.initItem(lampId, lamp)
  store.initItem(editorFanId, fan)
  store.initItem(bakedFanId, fan, true)
  store.setControlValue(lampId, 0, true)
  store.toggleItemToggles(lampId, lamp)
  expect(useInteractive.getState().items[lampId]?.controlValues).toEqual([false, false])
  store.toggleItemToggles(lampId, lamp)
  expect(useInteractive.getState().items[lampId]?.controlValues).toEqual([true, true])
  expect(useInteractive.getState().items[editorFanId]?.controlValues).toEqual([false])
  expect(useInteractive.getState().items[bakedFanId]?.controlValues).toEqual([true])
  store.setLampDefault(true)
  expect(useInteractive.getState().items[editorFanId]?.controlValues).toEqual([false])
  expect(useInteractive.getState().items[bakedFanId]?.controlValues).toEqual([true])
})

test('the walkthrough opens an open clip, plays a named clip by its name, and switches the rest', () => {
  const store = useInteractive.getState()
  const garage = scriptInteractive({
    lights: [],
    animations: [{ name: 'open' }, { name: 'loop' }, { name: 'Wave' }],
  } as never)!
  const box = scriptInteractive({
    lights: [],
    animations: [{ name: 'Princess twirl' }, { name: 'Spin' }],
  } as never)!
  const ids = ['garage', 'box', 'lamp'] as AnyNodeId[]
  store.initItem(ids[0]!, garage)
  store.initItem(ids[1]!, box)
  store.initItem(ids[2]!, lamp)

  expect(itemPrompt(ids[0]!, 'Garage door', garage)).toEqual({
    label: 'Garage door',
    verb: 'open',
    isOn: false,
  })
  operateItem(ids[0]!, garage)
  expect(useInteractive.getState().items.garage!.controlValues).toEqual([true, false])

  expect(itemPrompt(ids[1]!, 'Music box', box).label).toBe('Princess twirl')
  operateItem(ids[1]!, box)
  expect(itemPrompt(ids[1]!, 'Music box', box)).toEqual({
    label: 'Princess twirl',
    verb: 'pause',
    isOn: true,
  })
  expect(useInteractive.getState().items.box!.controlValues).toEqual([true, false])

  operateItem(ids[2]!, lamp)
  expect(itemPrompt(ids[2]!, 'Lamp', lamp).verb).toBe('turn off')
  for (const id of ids) store.removeItem(id)
})

test('part switches are isolated and idempotent, and node cleanup removes all of its parts', () => {
  const id = 'window_parts' as AnyNodeId
  const other = 'window_parts_other' as AnyNodeId
  const store = useInteractive.getState()
  store.setMechanismPart(id, 'shutters', true)
  const before = useInteractive.getState()
  store.setMechanismPart(id, 'shutters', true)
  expect(useInteractive.getState()).toBe(before)
  store.setMechanismPart(id, 'shade', false)
  store.setMechanismPart(other, 'shutters', true)
  store.removeMechanismPart(id, 'shutters')
  expect(useInteractive.getState().mechanismParts[`${id}:shutters`]).toBeUndefined()
  expect(useInteractive.getState().mechanismParts[`${id}:shade`]).toBe(false)
  store.setMechanismPart(id, 'shutters', true)
  store.removeMechanism(id)
  expect(useInteractive.getState().mechanismParts[`${id}:shutters`]).toBeUndefined()
  expect(useInteractive.getState().mechanismParts[`${id}:shade`]).toBeUndefined()
  expect(useInteractive.getState().mechanismParts[`${other}:shutters`]).toBe(true)
  store.removeMechanism(other)
})

test('window fields queue and clear independently', () => {
  const id = 'window_tracks' as AnyNodeId
  const store = useInteractive.getState()
  const animation = { from: 0, to: 1, startedAt: null, durationMs: 520, persist: false }
  store.startWindowAnimation(id, { ...animation, field: 'operationState' })
  store.startWindowAnimation(id, { ...animation, field: 'shutterOpen' })
  store.setWindowOpenState(id, { operationState: 0.2, shutterOpen: 0.6 })
  store.cancelWindowAnimation(id, 'shutterOpen')
  store.removeWindowOpenState(id, 'shutterOpen')
  expect(useInteractive.getState().windowAnimations[id]?.operationState?.to).toBe(1)
  expect(useInteractive.getState().windows[id]).toEqual({ operationState: 0.2 })
  store.cancelWindowAnimation(id, 'operationState')
  expect(useInteractive.getState().windowAnimations[id]).toBeUndefined()
  store.removeWindowOpenState(id)
})
