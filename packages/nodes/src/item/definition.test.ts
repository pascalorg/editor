import { expect, test } from 'bun:test'
import { useInteractive } from '@pascal-app/core'
import { itemDefinition } from './definition'
import type { ItemNode } from './schema'

test('E on a selected catalog item runs its mechanisms, like the action bar', () => {
  const interactive = {
    controls: [{ kind: 'toggle' as const }, { kind: 'toggle' as const }],
    effects: [{ kind: 'animation' as const, clips: { on: 'On' } }],
  }
  const node = {
    id: 'item_keyboard_lamp',
    type: 'item',
    asset: { interactive },
  } as ItemNode
  const action = itemDefinition.keyboardActions?.e
  expect(action?.appliesTo(node)).toBe(true)
  action?.run(node)
  expect(useInteractive.getState().items[node.id]?.controlValues).toEqual([true, true])
  action?.run(node)
  expect(useInteractive.getState().items[node.id]?.controlValues).toEqual([false, false])
  useInteractive.getState().removeItem(node.id)
})
