import { expect, test } from 'bun:test'
import { createToolHintsStore } from './panel-tool-options'

test('tool hints share subscriptions, react to visibility and chip state, and unsubscribe', () => {
  let visible = false
  let value = 'auto'
  let subscriptions = 0
  let cleanups = 0
  const subscribe = (_listener: () => void) => {
    subscriptions++
    return () => {
      cleanups++
    }
  }
  const store = createToolHintsStore([
    {
      key: 'P',
      label: 'Placement',
      visible: { subscribe, value: () => visible },
      chip: { subscribe, value: () => value, cycle: () => {}, labels: { auto: 'Auto' } },
    },
  ])
  const cleanup = store.subscribe(() => {})
  expect(subscriptions).toBe(1)
  const hidden = store.getSnapshot()
  visible = true
  expect(store.getSnapshot()).not.toBe(hidden)
  const shown = store.getSnapshot()
  value = 'roof'
  expect(store.getSnapshot()).not.toBe(shown)
  expect(store.getSnapshot()).toBe(store.getSnapshot())
  cleanup()
  expect(cleanups).toBe(1)
})
