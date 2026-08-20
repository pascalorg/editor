import { afterEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: TestEvent) => void
type CustomElementConstructor = new () => TestHTMLElement

let activeDocument: TestDocument | null = null

class TestEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
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

class TestElement {
  ownerDocument: TestDocument
  readonly children: TestElement[] = []
  parentElement: TestElement | null = null
  textContent = ''
  private readonly attrs = new Map<string, string>()
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(ownerDocument: TestDocument | null = activeDocument) {
    this.ownerDocument = ownerDocument ?? (this as unknown as TestDocument)
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
    const oldValue = this.getAttribute(name)
    const next = String(value)
    this.attrs.set(name, next)
    this.notifyAttributeChanged(name, oldValue, next)
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name)
  }

  removeAttribute(name: string): void {
    const oldValue = this.getAttribute(name)
    this.attrs.delete(name)
    this.notifyAttributeChanged(name, oldValue, null)
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
    child.connectTree()
    return child
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
    this.disconnectTree()
    this.parentElement = null
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
    node.connectTree()
  }

  querySelector(selector: string): TestElement | null {
    if (selector === 'input') {
      return this.find((el) => el instanceof TestInputElement)
    }
    if (selector.startsWith('#')) {
      return this.find((el) => el.id === selector.slice(1))
    }
    return null
  }

  private find(predicate: (el: TestElement) => boolean): TestElement | null {
    if (predicate(this)) {
      return this
    }
    for (const child of this.children) {
      const found = child.find(predicate)
      if (found) {
        return found
      }
    }
    return null
  }

  private notifyAttributeChanged(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    const maybe = this as unknown as {
      attributeChangedCallback?: (
        name: string,
        oldValue: string | null,
        newValue: string | null,
      ) => void
      constructor: { observedAttributes?: string[] }
    }
    if (maybe.constructor.observedAttributes?.includes(name)) {
      maybe.attributeChangedCallback?.(name, oldValue, newValue)
    }
  }

  private connectTree(): void {
    ;(this as unknown as { connectedCallback?: () => void }).connectedCallback?.()
    for (const child of this.children) {
      child.connectTree()
    }
  }

  private disconnectTree(): void {
    for (const child of this.children) {
      child.disconnectTree()
    }
    ;(this as unknown as { disconnectedCallback?: () => void }).disconnectedCallback?.()
  }
}

class TestHTMLElement extends TestElement {
  readonly internals = new TestElementInternals()

  attachInternals(): TestElementInternals {
    return this.internals
  }
}

class TestElementInternals {
  formValue: string | null = null
  validity: Record<string, boolean> = {}
  validationMessage = ''
  anchor: TestElement | null = null

  setFormValue(value: string | null): void {
    this.formValue = value
  }

  setValidity(flags: Record<string, boolean>, message = '', anchor?: TestElement): void {
    this.validity = flags
    this.validationMessage = message
    this.anchor = anchor ?? null
  }
}

class TestInputElement extends TestHTMLElement {
  value = ''
  defaultValue = ''
  type = 'text'
  disabled = false
  validity = { customError: false }
  validationMessage = ''

  get name(): string {
    return this.getAttribute('name') ?? ''
  }

  set name(value: string) {
    this.setAttribute('name', value)
  }

  get form(): TestFormElement | null {
    let current = this.parentElement
    while (current) {
      if (current instanceof TestFormElement) {
        return current
      }
      current = current.parentElement
    }
    return null
  }

  setCustomValidity(message: string): void {
    this.validationMessage = message
    this.validity = { customError: message !== '' }
  }
}

class TestFormElement extends TestHTMLElement {
  reset(): void {
    this.dispatchEvent(new TestEvent('reset'))
    this.callFormReset(this)
  }

  private callFormReset(node: TestElement): void {
    ;(node as unknown as { formResetCallback?: () => void }).formResetCallback?.()
    for (const child of node.children) {
      this.callFormReset(child)
    }
  }
}

class TestCustomElementRegistry {
  private readonly registry = new Map<string, CustomElementConstructor>()

  define(tag: string, ctor: CustomElementConstructor): void {
    this.registry.set(tag, ctor)
  }

  get(tag: string): CustomElementConstructor | undefined {
    return this.registry.get(tag)
  }
}

class TestDocument extends TestElement {
  readonly defaultView: Record<string, unknown>

  constructor(readonly customElements: TestCustomElementRegistry) {
    super(null)
    this.ownerDocument = this
    this.defaultView = { CustomEvent: TestCustomEvent, customElements }
  }

  createElement(tag: string): TestElement {
    const ctor = this.customElements.get(tag)
    if (ctor) {
      return withActiveDocument(this, () => new ctor())
    }
    if (tag === 'input') {
      return new TestInputElement(this)
    }
    if (tag === 'form') {
      return new TestFormElement(this)
    }
    return new TestHTMLElement(this)
  }

  createEvent(): TestCustomEvent {
    return new TestCustomEvent('')
  }
}

function withActiveDocument<T>(doc: TestDocument, fn: () => T): T {
  const previous = activeDocument
  activeDocument = doc
  try {
    return fn()
  } finally {
    activeDocument = previous
  }
}

function installDom(): TestDocument {
  const registry = new TestCustomElementRegistry()
  const doc = new TestDocument(registry)
  activeDocument = doc
  vi.stubGlobal('window', doc.defaultView)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('customElements', registry)
  vi.stubGlobal('HTMLElement', TestHTMLElement)
  vi.stubGlobal('HTMLInputElement', TestInputElement)
  vi.stubGlobal('CustomEvent', TestCustomEvent)
  vi.stubGlobal('Event', TestEvent)
  return doc
}

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  activeDocument = null
  vi.unstubAllGlobals()
})

describe('LingoInputElement', () => {
  it('imports and defineLingoInput no-ops without browser custom-element globals', async () => {
    vi.stubGlobal('HTMLElement', undefined)
    vi.stubGlobal('customElements', undefined)

    const { defineLingoInput } = await import('./index')

    expect(() => defineLingoInput()).not.toThrow()
  })

  it('registers, reads attributes, and reflects committed canonical values', async () => {
    const doc = installDom()
    const { defineLingoInput } = await import('./index')

    defineLingoInput('x-lingo-input')
    defineLingoInput('x-lingo-input')

    expect(customElements.get('x-lingo-input')).toBeDefined()

    const element = doc.createElement('x-lingo-input') as unknown as TestHTMLElement & {
      field: import('../dom').LingoField | null
      internals: TestElementInternals
      value: number | null
    }
    element.setAttribute('kind', 'length')
    element.setAttribute('unit', 'm')
    element.setAttribute('name', 'height_m')
    doc.appendChild(element as unknown as TestElement)

    const input = element.querySelector('input') as TestInputElement | null
    expect(input).not.toBeNull()
    expect(input?.type).toBe('text')
    expect(input?.getAttribute('name')).toBeNull()
    expect(input?.getAttribute('data-kind')).toBe('length')
    expect(input?.getAttribute('data-unit')).toBe('m')

    input!.value = `5'11"`
    input!.dispatchEvent(new TestEvent('blur'))

    expect(element.value).toBeCloseTo(1.8034, 12)
    expect(element.internals.formValue).toBe('1.8034')
    expect(element.internals.validity).toEqual({})

    element.setAttribute('unit', 'cm')
    expect(input?.getAttribute('data-unit')).toBe('cm')
    expect(element.value).toBeCloseTo(180.34, 10)
  })

  it('recommits an existing input value after reconnecting a preserved element', async () => {
    const doc = installDom()
    const { defineLingoInput } = await import('./index')

    defineLingoInput('x-lingo-input')

    const element = doc.createElement('x-lingo-input') as unknown as TestHTMLElement & {
      internals: TestElementInternals
      value: number | null
    }
    element.setAttribute('kind', 'mass')
    element.setAttribute('unit', 'kg')
    doc.appendChild(element as unknown as TestElement)

    const input = element.querySelector('input') as TestInputElement | null
    expect(input).not.toBeNull()

    element.remove()
    input!.value = '3 lbs'
    doc.appendChild(element as unknown as TestElement)

    expect(element.value).toBeCloseTo(1.360_777_11, 10)
    expect(Number(element.internals.formValue)).toBeCloseTo(1.360_777_11, 10)
  })

  it('restores non-empty defaults after the wrapped controller clears on form reset', async () => {
    vi.useFakeTimers()
    const doc = installDom()
    const { defineLingoInput } = await import('./index')

    defineLingoInput('x-lingo-input')

    const form = doc.createElement('form') as TestFormElement
    const element = doc.createElement('x-lingo-input') as unknown as TestHTMLElement & {
      internals: TestElementInternals
      value: number | null
    }
    element.setAttribute('kind', 'mass')
    element.setAttribute('unit', 'kg')
    form.appendChild(element as unknown as TestElement)
    doc.appendChild(form)

    const input = element.querySelector('input') as TestInputElement | null
    expect(input).not.toBeNull()
    input!.defaultValue = '2 lbs'
    input!.value = '5 lbs'
    input!.dispatchEvent(new TestEvent('blur'))
    expect(Number(element.internals.formValue)).toBeCloseTo(2.267_961_85, 10)

    form.reset()
    await vi.runAllTimersAsync()

    expect(element.value).toBeCloseTo(0.907_184_74, 10)
    expect(Number(element.internals.formValue)).toBeCloseTo(0.907_184_74, 10)
  })
})
