import { afterEach, expect, test } from 'bun:test'

const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
afterEach(() => {
  if (saved) Object.defineProperty(globalThis, 'localStorage', saved)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

function stubStorage(storage: Partial<Storage>) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
}

let fresh = 0
/** A new instance of the module, reading storage as a page load would. */
const load = () => import(`./inspector-expanded.ts?load=${++fresh}`)

test('expanding once opens every later panel expanded, across a reload, until folded', async () => {
  const values = new Map<string, string>()
  stubStorage({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  })
  const first = await load()
  expect(first.useInspectorExpanded.getState().expanded).toBe(false)
  first.useInspectorExpanded.getState().setExpanded(true)
  expect((await load()).useInspectorExpanded.getState().expanded).toBe(true)
  first.useInspectorExpanded.getState().setExpanded(false)
  expect((await load()).useInspectorExpanded.getState().expanded).toBe(false)
})

test('without usable storage the panel opens folded and expanding still works', async () => {
  stubStorage({
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  })
  const { useInspectorExpanded } = await load()
  expect(useInspectorExpanded.getState().expanded).toBe(false)
  useInspectorExpanded.getState().setExpanded(true)
  expect(useInspectorExpanded.getState().expanded).toBe(true)
})
