import { expect, test } from 'bun:test'
import type { AnyNodeId } from '@pascal-app/core'
import { sceneRegistry, useInteractive } from '@pascal-app/core'
import { Group, Vector3 } from 'three'
import { catalogLightSource } from './use-item-light-pool'

test('catalog adapter preserves first toggle, first slider and world offset', () => {
  const id = 'catalog_lamp' as AnyNodeId
  const object = new Group()
  object.position.set(2, 3, 4)
  sceneRegistry.nodes.set(id, object)
  const interactive = {
    controls: [
      { kind: 'toggle' as const },
      {
        kind: 'slider' as const,
        label: 'Dimmer',
        min: 0,
        max: 10,
        step: 1,
        displayMode: 'slider' as const,
      },
      { kind: 'toggle' as const },
    ],
    effects: [],
  }
  useInteractive.getState().initItem(id, interactive)
  const source = catalogLightSource(
    'lamp:0',
    id,
    {
      kind: 'light',
      color: '#ffffff',
      intensityRange: [0, 4],
      distance: 5,
      offset: [1, 0, -1],
    },
    interactive,
  )
  expect(source.isEligible()).toBe(false)
  useInteractive.getState().setControlValue(id, 0, true)
  useInteractive.getState().setControlValue(id, 1, 5)
  expect(source.isEligible()).toBe(true)
  expect(source.getIntensity()).toBe(2)
  const position = new Vector3()
  expect(source.getWorldPosition(position)).toBe(true)
  expect(position.toArray()).toEqual([3, 3, 3])
  useInteractive.getState().removeItem(id)
  sceneRegistry.nodes.delete(id)
})
