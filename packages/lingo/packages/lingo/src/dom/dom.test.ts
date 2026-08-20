import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Completion } from '../complete/types'
import { setDefaultMessages } from '../core/errors'
import { englishMessages } from '../index'
import { lingoInput } from './index'

type Listener = (event: TestEvent) => void

class TestEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly isTrusted = false
  defaultPrevented = false
  target: TestElement | null = null
  currentTarget: TestElement | null = null

  constructor(type: string, init: EventInit = {}) {
    this.type = type
    this.bubbles = init.bubbles ?? false
    this.cancelable = init.cancelable ?? false
  }

  preventDefault(): void {
    if (this.cancelable) {
      this.defaultPrevented = true
    }
  }
}

class TestCustomEvent<T = unknown> extends TestEvent {
  detail: T

  constructor(type: string, init: CustomEventInit<T> = {}) {
    super(type, init)
    this.detail = init.detail as T
  }

  initCustomEvent(type: string, bubbles = false, cancelable = false, detail: T): void {
    Object.defineProperty(this, 'type', { value: type })
    Object.defineProperty(this, 'bubbles', { value: bubbles })
    Object.defineProperty(this, 'cancelable', { value: cancelable })
    this.detail = detail
  }
}

class TestKeyboardEvent extends TestEvent {
  readonly key: string

  constructor(type: string, init: EventInit & { key: string }) {
    super(type, init)
    this.key = init.key
  }
}

class TestElement {
  readonly ownerDocument: TestDocument
  readonly children: TestElement[] = []
  parentElement: TestElement | null = null
  textContent = ''
  private readonly attrs = new Map<string, string>()
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(ownerDocument: TestDocument) {
    this.ownerDocument = ownerDocument
  }

  get id(): string {
    return this.getAttribute('id') ?? ''
  }

  set id(value: string) {
    if (value) {
      this.setAttribute('id', value)
    } else {
      this.removeAttribute('id')
    }
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name)
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type)
    if (existing) {
      existing.add(listener)
    } else {
      this.listeners.set(type, new Set([listener]))
    }
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event: TestEvent): boolean {
    if (!event.target) {
      event.target = this
    }
    event.currentTarget = this
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      listener(event)
    }
    if (event.bubbles && this.parentElement) {
      this.parentElement.dispatchEvent(event)
    }
    return !event.defaultPrevented
  }

  appendChild<T extends TestElement>(child: T): T {
    child.remove()
    this.children.push(child)
    child.parentElement = this
    if (this instanceof TestFormElement && child instanceof TestInputElement) {
      child.form = this
    }
    return child
  }

  after(node: TestElement): void {
    const parent = this.parentElement
    if (!parent) {
      return
    }
    node.remove()
    const index = parent.children.indexOf(this)
    parent.children.splice(index + 1, 0, node)
    node.parentElement = parent
    if (parent instanceof TestFormElement && node instanceof TestInputElement) {
      node.form = parent
    }
  }

  remove(): void {
    const parent = this.parentElement
    if (!parent) {
      return
    }
    const index = parent.children.indexOf(this)
    if (index >= 0) {
      parent.children.splice(index, 1)
    }
    this.parentElement = null
    if (this instanceof TestInputElement) {
      this.form = null
    }
  }

  querySelector(selector: string): TestElement | null {
    if (selector.startsWith('#')) {
      return this.findById(selector.slice(1))
    }
    return null
  }

  private findById(id: string): TestElement | null {
    if (this.id === id) {
      return this
    }
    for (const child of this.children) {
      const found = child.findById(id)
      if (found) {
        return found
      }
    }
    return null
  }
}

class TestInputElement extends TestElement {
  value = ''
  defaultValue = ''
  type = 'text'
  form: TestFormElement | null = null
  validity = { customError: false }
  validationMessage = ''
  reportValidityCalls = 0

  get name(): string {
    return this.getAttribute('name') ?? ''
  }

  set name(value: string) {
    this.setAttribute('name', value)
  }

  setCustomValidity(message: string): void {
    this.validationMessage = message
    this.validity = { customError: message !== '' }
  }

  reportValidity(): boolean {
    this.reportValidityCalls += 1
    return !this.validity.customError
  }
}

class TestFormElement extends TestElement {
  reset(): void {
    for (const child of this.children) {
      if (child instanceof TestInputElement) {
        child.value = child.defaultValue
      }
    }
    this.dispatchEvent(new TestEvent('reset'))
  }

  submitEvent(): TestEvent {
    const event = new TestEvent('submit', { bubbles: true, cancelable: true })
    this.dispatchEvent(event)
    return event
  }
}

class TestDocument extends TestElement {
  readonly defaultView = {
    CustomEvent: TestCustomEvent,
  }

  constructor() {
    super(undefined as unknown as TestDocument)
    Object.defineProperty(this, 'ownerDocument', { value: this })
  }

  createElement(tag: string): TestElement {
    if (tag === 'input') {
      return new TestInputElement(this)
    }
    if (tag === 'form') {
      return new TestFormElement(this)
    }
    return new TestElement(this)
  }

  createEvent(): TestCustomEvent {
    return new TestCustomEvent('')
  }
}

function installDom(): TestDocument {
  const doc = new TestDocument()
  vi.stubGlobal('window', doc.defaultView)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('CustomEvent', TestCustomEvent)
  vi.stubGlobal('Event', TestEvent)
  return doc
}

function input(doc: TestDocument): TestInputElement {
  return doc.createElement('input') as TestInputElement
}

function div(doc: TestDocument): TestElement {
  return doc.createElement('div')
}

function form(doc: TestDocument): TestFormElement {
  return doc.createElement('form') as TestFormElement
}

function typeInto(el: TestInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new TestEvent('input', { bubbles: true }))
}

function blur(el: TestInputElement): void {
  el.dispatchEvent(new TestEvent('blur'))
}

function enter(el: TestInputElement): TestKeyboardEvent {
  const event = new TestKeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event
}

const completion = {
  confidence: 1,
  result: {} as Completion['result'],
  source: 'unit-prefix',
  text: '2 ft',
} satisfies Completion

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('lingoInput', () => {
  it('attaches, restores attrs on destroy, removes listeners, and rejects double attach', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    el.setAttribute('autocomplete', 'email')
    const field = lingoInput(el as unknown as HTMLInputElement, { kind: 'length', unit: 'm' })

    expect(lingoInput.get(el as unknown as HTMLInputElement)).toBe(field)
    expect(() => lingoInput(el as unknown as HTMLInputElement)).toThrow(/already/)
    expect(el.getAttribute('autocomplete')).toBe('email')
    expect(el.getAttribute('autocorrect')).toBe('off')
    expect(el.getAttribute('data-lingo')).toBe('input')

    field.destroy()
    typeInto(el, '2 ft')
    vi.advanceTimersByTime(200)

    expect(lingoInput.get(el as unknown as HTMLInputElement)).toBeUndefined()
    expect(el.getAttribute('autocomplete')).toBe('email')
    expect(el.getAttribute('autocorrect')).toBeNull()
    expect(el.getAttribute('data-lingo')).toBeNull()
    expect(field.state).toBe('idle')
  })

  it('keeps incomplete input quiet while typing', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const error = div(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      errorElement: error as unknown as HTMLElement,
    })

    typeInto(el, '2 f')
    vi.advanceTimersByTime(150)

    expect(field.state).toBe('incomplete')
    expect(el.getAttribute('aria-invalid')).toBeNull()
    expect(error.textContent).toBe('')
  })

  it('parses valid input, shows a debounced hint, and commits canonical display plus hidden value', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const host = form(doc)
    const el = input(doc)
    const hint = div(doc)
    host.appendChild(el)
    host.appendChild(hint)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      name: 'height',
      hintElement: hint as unknown as HTMLElement,
    })

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)
    expect(field.state).toBe('valid')
    expect(field.value).toBeCloseTo(0.6096, 12)
    expect(host.children[1]).toBeInstanceOf(TestInputElement)

    vi.advanceTimersByTime(500)
    expect(hint.textContent).toBe('= 0.61 m')

    blur(el)
    expect(el.value).toBe('0.61 m')
    const hidden = host.children[1] as TestInputElement
    expect(hidden.type).toBe('hidden')
    expect(hidden.name).toBe('height')
    expect(hidden.value).toBe('0.6096')
  })

  it('shows a did-you-mean hint when confirm mode rejects a candidate', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const hint = div(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      strictness: 'confirm',
      hintElement: hint as unknown as HTMLElement,
    })

    typeInto(el, '5 meterz')
    vi.advanceTimersByTime(150)

    expect(field.state).toBe('invalid')
    expect(field.result?.ok).toBe(false)
    expect(field.result?.ok === false ? field.result.candidate?.type : undefined).toBe('quantity')
    expect(hint.textContent).toBe('Did you mean 5 m?')
  })

  it('passes acceptance switches through and renders candidate hints', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const hint = div(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'mass',
      accept: { approximations: false },
      hintElement: hint as unknown as HTMLElement,
    })

    typeInto(el, 'like 5 kg')
    vi.advanceTimersByTime(150)

    expect(field.state).toBe('invalid')
    expect(field.result?.ok).toBe(false)
    expect(field.result?.ok === false ? field.result.candidate?.type : undefined).toBe('quantity')
    expect(hint.textContent).toBe('Did you mean 5 kg?')
  })

  it('preserves the user unit in echo display mode', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      display: 'echo',
    })

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)
    blur(el)

    expect(el.value).toBe('2 ft')
  })

  it('never rewrites the typed text in preserve display mode', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const host = form(doc)
    const el = input(doc)
    host.appendChild(el)
    lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      name: 'height',
      display: 'preserve',
    })

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)
    blur(el)

    // preserve keeps the user's exact text — but still canonicalizes into the
    // hidden input (the contract is "don't touch the text", not "don't parse").
    expect(el.value).toBe('2 ft')
    const hidden = host.children[1] as TestInputElement
    expect(hidden.type).toBe('hidden')
    expect(hidden.value).toBe('0.6096')
  })

  it('surfaces committed errors and clears them after a valid fix', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const error = div(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      errorElement: error as unknown as HTMLElement,
    })

    typeInto(el, 'xyz')
    vi.advanceTimersByTime(150)
    blur(el)

    expect(field.state).toBe('invalid')
    expect(el.getAttribute('data-touched')).toBe('')
    expect(el.getAttribute('aria-invalid')).toBe('true')
    expect(error.textContent.length).toBeGreaterThan(0)
    expect(error.getAttribute('role')).toBe('alert')
    expect(el.getAttribute('aria-describedby')).toContain(error.id)

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)

    expect(field.state).toBe('valid')
    expect(error.textContent).toBe('')
    expect(el.getAttribute('aria-describedby')).toBeNull()
  })

  it('syncs custom validity for form fields that use aria errors', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const host = form(doc)
    const el = input(doc)
    const error = div(doc)
    host.appendChild(el)
    host.appendChild(error)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      errorElement: error as unknown as HTMLElement,
    })

    typeInto(el, 'xyz')
    vi.advanceTimersByTime(150)
    blur(el)

    expect(field.state).toBe('invalid')
    expect(el.validity.customError).toBe(true)
    expect(el.validationMessage.length).toBeGreaterThan(0)

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)

    expect(field.state).toBe('valid')
    expect(el.validity.customError).toBe(false)
    expect(el.validationMessage).toBe('')
  })

  it('validates min, required, native Enter blocking, and form submit', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const host = form(doc)
    const el = input(doc)
    host.appendChild(el)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      min: '50cm',
      required: true,
      validationBehavior: 'native',
    })

    typeInto(el, '10 cm')
    vi.advanceTimersByTime(150)
    blur(el)

    expect(field.state).toBe('invalid')
    expect(field.result?.issues[0]?.code).toBe('RANGE_MIN')
    expect(el.validity.customError).toBe(true)

    el.value = ''
    field.commit()
    expect(field.result?.issues[0]?.code).toBe('REQUIRED')

    typeInto(el, 'xyz')
    vi.advanceTimersByTime(150)
    const key = enter(el)
    expect(key.defaultPrevented).toBe(true)
    expect(el.reportValidityCalls).toBe(1)

    const submit = host.submitEvent()
    expect(submit.defaultPrevented).toBe(true)
  })

  it('renders field-local issue copy from the registered message pack', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      min: '50cm',
    })

    typeInto(el, '10 cm')
    vi.advanceTimersByTime(150)
    blur(el)

    expect(field.result?.issues[0]?.message).toBe('Must be at least 0.5 m.')

    el.value = ''
    lingoInput.get(el as unknown as HTMLInputElement)?.destroy()
    const required = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      required: true,
    })
    required.commit()
    expect(required.result?.issues[0]?.message).toBe('This field is required.')
  })

  it('lets setDefaultMessages overrides reach DOM-produced issues', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      required: true,
    })
    setDefaultMessages({ ...englishMessages, REQUIRED: 'You must fill this in.' })
    try {
      field.commit()
      expect(field.result?.issues[0]?.message).toBe('You must fill this in.')
    } finally {
      setDefaultMessages(englishMessages)
    }
  })

  it('prefers the messages option over the default pack for field-local issues', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      max: '2m',
      messages: { RANGE_MAX: 'Too tall — max {max}.' },
    })

    typeInto(el, '3 m')
    vi.advanceTimersByTime(150)
    blur(el)

    expect(field.result?.issues[0]?.code).toBe('RANGE_MAX')
    expect(field.result?.issues[0]?.message).toBe('Too tall — max 2 m.')
  })

  it('clears the hidden value when a commit lands on incomplete', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const host = form(doc)
    const el = input(doc)
    host.appendChild(el)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      name: 'height',
    })

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)
    const hidden = host.children[1] as TestInputElement
    expect(hidden.value).toBe('0.6096')

    typeInto(el, '2 f')
    vi.advanceTimersByTime(150)
    blur(el)

    expect(field.state).toBe('incomplete')
    expect(hidden.value).toBe('')
  })

  it('clears state and hidden value on form reset', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const host = form(doc)
    const el = input(doc)
    host.appendChild(el)
    const field = lingoInput(el as unknown as HTMLInputElement, {
      kind: 'length',
      unit: 'm',
      name: 'height',
    })

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)
    const hidden = host.children[1] as TestInputElement
    expect(hidden.value).toBe('0.6096')

    host.reset()
    vi.advanceTimersByTime(0)

    expect(field.state).toBe('idle')
    expect(field.value).toBeNull()
    expect(hidden.value).toBe('')
  })

  it('dispatches lingo:change with state detail', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const host = form(doc)
    const el = input(doc)
    host.appendChild(el)
    const states: string[] = []
    host.addEventListener('lingo:change', (event) => {
      states.push((event as TestCustomEvent<{ state: string }>).detail.state)
    })
    lingoInput(el as unknown as HTMLInputElement, { kind: 'length', unit: 'm' })

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)

    expect(states).toContain('valid')
  })

  it('wires completion combobox aria and restores generated attrs', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const onComplete = vi.fn()
    const field = lingoInput(el as unknown as HTMLInputElement, {
      complete: () => [completion],
      listboxId: 'height-options',
      onComplete,
    })

    expect(el.getAttribute('role')).toBe('combobox')
    expect(el.getAttribute('aria-autocomplete')).toBe('list')
    expect(el.getAttribute('aria-controls')).toBe('height-options')
    expect(el.getAttribute('aria-expanded')).toBe('false')

    typeInto(el, '2 f')
    vi.advanceTimersByTime(150)
    expect(el.getAttribute('aria-expanded')).toBe('true')
    expect(onComplete).toHaveBeenLastCalledWith([completion], field)

    typeInto(el, '2 ft')
    vi.advanceTimersByTime(150)
    expect(el.getAttribute('aria-expanded')).toBe('true')
    blur(el)
    expect(el.getAttribute('aria-expanded')).toBe('false')
    expect(onComplete).toHaveBeenLastCalledWith([completion], field)

    typeInto(el, '')
    vi.advanceTimersByTime(150)
    expect(el.getAttribute('aria-expanded')).toBe('false')
    expect(onComplete).toHaveBeenLastCalledWith([], field)

    field.destroy()
    expect(el.getAttribute('role')).toBeNull()
    expect(el.getAttribute('aria-autocomplete')).toBeNull()
    expect(el.getAttribute('aria-controls')).toBeNull()
    expect(el.getAttribute('aria-expanded')).toBeNull()
  })

  it('respects author completion attrs while restoring controlled aria state', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    el.setAttribute('role', 'searchbox')
    el.setAttribute('aria-autocomplete', 'both')
    el.setAttribute('aria-controls', 'author-list')
    el.setAttribute('aria-expanded', 'maybe')
    const field = lingoInput(el as unknown as HTMLInputElement, {
      complete: () => [completion],
      listboxId: 'lingo-list',
    })

    expect(el.getAttribute('role')).toBe('searchbox')
    expect(el.getAttribute('aria-autocomplete')).toBe('both')
    expect(el.getAttribute('aria-controls')).toBe('lingo-list')
    expect(el.getAttribute('aria-expanded')).toBe('false')

    typeInto(el, '2 f')
    vi.advanceTimersByTime(150)
    expect(el.getAttribute('aria-expanded')).toBe('true')

    field.destroy()
    expect(el.getAttribute('role')).toBe('searchbox')
    expect(el.getAttribute('aria-autocomplete')).toBe('both')
    expect(el.getAttribute('aria-controls')).toBe('author-list')
    expect(el.getAttribute('aria-expanded')).toBe('maybe')
  })

  it('supports programmatic set and live option updates', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, { kind: 'length', unit: 'm' })

    field.set(1.8)
    expect(el.value).toBe('1.8 m')
    expect(field.value).toBeCloseTo(1.8, 12)

    field.set('6ft')
    expect(field.value).toBeCloseTo(1.8288, 12)

    field.update({ unit: 'cm' })
    expect(field.value).toBeCloseTo(182.88, 9)
    expect(el.getAttribute('data-unit')).toBe('cm')
  })

  it('advertises the configured kind and unit before any parse (agent discovery)', () => {
    const doc = installDom()
    const el = input(doc)
    lingoInput(el as unknown as HTMLInputElement, { kind: 'length', unit: 'm' })

    expect(el.getAttribute('data-lingo')).toBe('input')
    expect(el.getAttribute('data-kind')).toBe('length')
    expect(el.getAttribute('data-unit')).toBe('m')

    lingoInput.get(el as unknown as HTMLInputElement)?.destroy()
    lingoInput(el as unknown as HTMLInputElement, { kind: 'length', unit: '' })
    expect(el.getAttribute('data-unit')).toBeNull()
  })

  it('processes untrusted synthetic input and waits for compositionend', () => {
    vi.useFakeTimers()
    const doc = installDom()
    const el = input(doc)
    const field = lingoInput(el as unknown as HTMLInputElement, { kind: 'length', unit: 'm' })

    el.dispatchEvent(new TestEvent('compositionstart'))
    typeInto(el, '2 ft')
    vi.advanceTimersByTime(200)
    expect(field.state).toBe('idle')

    el.dispatchEvent(new TestEvent('compositionend'))
    expect(field.state).toBe('valid')

    typeInto(el, '3 ft')
    vi.advanceTimersByTime(150)
    expect(field.value).toBeCloseTo(0.9144, 12)
  })
})
