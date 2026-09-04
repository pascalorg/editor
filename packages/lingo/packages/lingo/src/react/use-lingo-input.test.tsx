/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Completion } from '../complete/types'
import { lingo } from '../index'
import { type UseLingoInputResult, useLingoInput } from './index'

// Smoke coverage for the ./react entry: mount the hook against a real DOM
// (jsdom), type, commit, and drive it programmatically. The memoization
// internals have their own unit tests in signature.test.ts.

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Harness({
  onApi,
  value,
}: {
  onApi: (api: UseLingoInputResult) => void
  value?: number | null
}) {
  // debounce: 0 — typed input parses synchronously, no timer juggling.
  const api = useLingoInput({ kind: 'length', unit: 'm', name: 'height_m', value, debounce: 0 })
  onApi(api)
  return <input data-state={api.state} ref={api.ref} />
}

function mount(value?: number | null): {
  api: () => UseLingoInputResult
  input: () => HTMLInputElement
  rerender: (value?: number | null) => void
} {
  let latest: UseLingoInputResult | null = null
  const render = (v?: number | null) => {
    act(() => {
      root.render(<Harness onApi={(a) => (latest = a)} value={v} />)
    })
  }
  render(value)
  return {
    api: () => {
      if (!latest) {
        throw new Error('hook did not render')
      }
      return latest
    },
    input: () => {
      const el = container.querySelector('input')
      if (!el) {
        throw new Error('input did not mount')
      }
      return el
    },
    rerender: render,
  }
}

// The controller parses on a debounce timer (setTimeout even at 0ms), so
// typing flushes a macrotask before asserting.
async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 1))
  })
}

function completion(text: string): Completion {
  const result = lingo(text)
  if (!result.ok || result.type === 'number') {
    throw new Error(`invalid completion fixture: ${text}`)
  }
  return { text, result, confidence: result.confidence, source: 'parse' }
}

describe('useLingoInput (jsdom smoke)', () => {
  it('parses typed input into state/value/quantity', async () => {
    const h = mount()
    expect(h.api().state).toBe('idle')

    await type(h.input(), '72 in')
    expect(h.api().state).toBe('valid')
    expect(h.api().value).toBeCloseTo(1.8288)
    // `unit: 'm'` pins the field's canonical unit, so the quantity reads in m.
    expect(h.api().quantity?.toJSON()).toMatchObject({ unit: 'm', base: 1.8288 })
    expect(h.api().result?.ok).toBe(true)
  })

  it('commit() canonicalizes the display text', async () => {
    const h = mount()
    await type(h.input(), '2m')
    act(() => h.api().commit())
    expect(h.input().value).toBe('2 m')
  })

  it('set() drives the field programmatically', () => {
    const h = mount()
    act(() => h.api().set('180 cm'))
    expect(h.api().value).toBeCloseTo(1.8)
  })

  it('controlled value prop updates the field', () => {
    const h = mount(2)
    expect(h.api().value).toBe(2)
    h.rerender(3)
    expect(h.api().value).toBe(3)
  })

  it('cleans up the controller on unmount without throwing', async () => {
    const h = mount()
    await type(h.input(), '5 ft')
    expect(h.api().state).toBe('valid')
    act(() => root.render(<div />))
    expect(container.querySelector('input')).toBeNull()
  })

  it('surfaces, highlights, and selects injected completions', async () => {
    const items = [completion('2 ft'), completion('3 ft')]
    const onComplete = vi.fn()
    let latest: UseLingoInputResult | null = null
    const api = () => {
      if (!latest) {
        throw new Error('completion harness did not render')
      }
      return latest
    }

    function CompletionHarness() {
      const api = useLingoInput({
        kind: 'length',
        unit: 'm',
        debounce: 0,
        listboxId: 'height-options',
        complete: () => items,
        onComplete,
      })
      latest = api
      return (
        <input
          onKeyDownCapture={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              api.setHighlightedIndex(api.highlightedIndex + 1)
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              api.selectCompletion(api.highlightedIndex)
            }
          }}
          ref={api.ref}
        />
      )
    }

    act(() => root.render(<CompletionHarness />))
    const input = container.querySelector('input')
    if (!(input && latest)) {
      throw new Error('completion harness did not mount')
    }

    await type(input, '2 f')
    expect(api().completions).toEqual(items)
    expect(api().highlightedIndex).toBe(0)
    expect(input.getAttribute('aria-controls')).toBe('height-options')
    expect(input.getAttribute('aria-expanded')).toBe('true')

    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      ),
    )
    expect(api().highlightedIndex).toBe(1)

    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    )
    expect(api().value).toBeCloseTo(0.9144)
    expect(api().completions).toEqual([])
    expect(api().highlightedIndex).toBe(-1)
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(onComplete).toHaveBeenCalled()
  })

  it('live-reads a changed completion provider', async () => {
    let latest: UseLingoInputResult | null = null
    const api = () => {
      if (!latest) {
        throw new Error('completion harness did not render')
      }
      return latest
    }
    const first = [completion('2 ft')]
    const second = [completion('3 ft')]

    function CompletionHarness({ items }: { items: readonly Completion[] }) {
      const api = useLingoInput({
        kind: 'length',
        debounce: 0,
        complete: () => items,
      })
      latest = api
      return <input ref={api.ref} />
    }

    act(() => root.render(<CompletionHarness items={first} />))
    const input = container.querySelector('input')
    if (!(input && latest)) {
      throw new Error('completion harness did not mount')
    }
    await type(input, '2 f')
    expect(api().completions).toEqual(first)

    act(() => root.render(<CompletionHarness items={second} />))
    await type(input, '3 f')
    expect(api().completions).toEqual(second)

    act(() => input.dispatchEvent(new FocusEvent('blur')))
    expect(api().completions).toEqual([])
    expect(api().highlightedIndex).toBe(-1)
  })
})
