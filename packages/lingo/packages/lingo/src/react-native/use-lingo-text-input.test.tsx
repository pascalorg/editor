/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Completion } from '../complete/types'
import { lingo } from '../index'
import {
  type UseLingoTextInputOptions,
  type UseLingoTextInputResult,
  useLingoTextInput,
} from './index'

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
  options,
}: {
  onApi: (api: UseLingoTextInputResult) => void
  options: UseLingoTextInputOptions
}) {
  onApi(useLingoTextInput(options))
  return null
}

function mount(options: UseLingoTextInputOptions) {
  let latest: UseLingoTextInputResult | null = null
  const render = (next: UseLingoTextInputOptions) => {
    act(() => root.render(<Harness onApi={(api) => (latest = api)} options={next} />))
  }
  const api = () => {
    if (!latest) {
      throw new Error('native hook did not render')
    }
    return latest
  }
  render(options)
  return { api, rerender: render }
}

async function change(api: UseLingoTextInputResult, text: string) {
  await act(async () => {
    api.inputProps.onChangeText(text)
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

describe('useLingoTextInput', () => {
  it('parses while typing and canonicalizes on blur', async () => {
    const onValueChange = vi.fn()
    const hook = mount({
      kind: 'length',
      unit: 'm',
      debounce: 0,
      onValueChange,
    })

    await change(hook.api(), '72 in')
    expect(hook.api().text).toBe('72 in')
    expect(hook.api().state).toBe('valid')
    expect(hook.api().value).toBeCloseTo(1.8288)
    expect(hook.api().dirty).toBe(true)

    act(() => hook.api().inputProps.onBlur())
    expect(hook.api().text).toBe('1.83 m')
    expect(hook.api().touched).toBe(true)
    expect(hook.api().submitValue).toBe('1.8288')
    expect(onValueChange).toHaveBeenCalled()
  })

  it('returns required and bound issues with original-input spans', async () => {
    const required = mount({ kind: 'mass', unit: 'kg', required: true })
    act(() => required.api().commit())
    expect(required.api().state).toBe('invalid')
    expect(required.api().result?.issues[0]).toMatchObject({
      code: 'REQUIRED',
      span: { start: 0, end: 0 },
    })

    const bounded = mount({ kind: 'mass', unit: 'kg', max: '10 kg', debounce: 0 })
    await change(bounded.api(), '20 kg')
    expect(bounded.api().state).toBe('valid')
    act(() => bounded.api().inputProps.onSubmitEditing())
    expect(bounded.api().state).toBe('invalid')
    expect(bounded.api().result?.issues[0]).toMatchObject({
      code: 'RANGE_MAX',
      span: { start: 0, end: 5 },
    })
    expect(bounded.api().errorMessage).toContain('10 kg')
  })

  it('surfaces and selects injected completions', async () => {
    const items = [completion('2 ft'), completion('3 ft')]
    const hook = mount({
      kind: 'length',
      unit: 'm',
      debounce: 0,
      complete: () => items,
    })

    await change(hook.api(), '2 f')
    expect(hook.api().state).toBe('incomplete')
    expect(hook.api().completions).toEqual(items)
    expect(hook.api().highlightedIndex).toBe(0)

    act(() => hook.api().setHighlightedIndex(99))
    expect(hook.api().highlightedIndex).toBe(1)
    act(() => hook.api().selectCompletion())
    expect(hook.api().value).toBeCloseTo(0.9144)
    expect(hook.api().text).toBe('0.914 m')
    expect(hook.api().completions).toEqual([])
  })

  it('syncs a controlled canonical value', () => {
    const hook = mount({ kind: 'length', unit: 'm', value: 2 })
    expect(hook.api().value).toBe(2)
    expect(hook.api().text).toBe('2 m')

    hook.rerender({ kind: 'length', unit: 'm', value: 3 })
    expect(hook.api().value).toBe(3)
    expect(hook.api().text).toBe('3 m')

    hook.rerender({ kind: 'length', unit: 'm', value: null })
    expect(hook.api().state).toBe('idle')
    expect(hook.api().text).toBe('')
  })

  it('clears pending parsing work on unmount', async () => {
    const onParse = vi.fn()
    const hook = mount({ kind: 'length', debounce: 50, onParse })
    act(() => hook.api().inputProps.onChangeText('5 ft'))
    act(() => root.render(<div />))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(onParse).not.toHaveBeenCalled()
  })
})
