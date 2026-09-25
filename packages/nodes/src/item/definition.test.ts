import { expect, test } from 'bun:test'
import { useInteractive } from '@pascal-app/core'
import type { ItemNode } from './schema'
import { itemDefinition } from './definition'

test('selected catalog items expose E for all toggle controls', () => {
  const interactive = {
    controls: [{ kind: 'toggle' as const }, { kind: 'toggle' as const }],
    effects: [{ kind: 'animation' as const, clips: { on: 'On' } }],
  }
  const node = {
    id: 'item_keyboard_lamp',
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
