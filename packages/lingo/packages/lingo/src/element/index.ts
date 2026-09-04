import { type LingoField, type LingoFieldState, type LingoInputOptions, lingoInput } from '../dom'

const HTMLElementBase =
  typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement

/**
 * Form-associated `<lingo-input>` custom element. It owns a light-DOM
 * `<input type="text">`, keeps native labels and CSS selectors working, and
 * submits the canonical number as the custom element's form value.
 * @example
 * ```ts
 * import { defineLingoInput } from '@pascal-app/lingo/element'
 *
 * defineLingoInput()
 * document.body.innerHTML = `<form><lingo-input name="height_m" kind="length" unit="m"></lingo-input></form>`
 * document.querySelector('lingo-input')!.addEventListener('lingo:change', (event) => {
 *   console.log((event as CustomEvent).detail.value) // 1.8034 after the user commits 5'11"
 * })
 * ```
 */
export class LingoInputElement extends HTMLElementBase {
  static formAssociated = true

  static get observedAttributes(): string[] {
    return [
      'kind',
      'unit',
      'min',
      'max',
      'system',
      'strictness',
      'display',
      'name',
      'required',
      'inputmode',
      'placeholder',
    ]
  }

  #field: LingoField | null = null
  #input: HTMLInputElement | null = null
  #internals: ElementInternals | null = null

  get field(): LingoField | null {
    return this.#field
  }

  get value(): number | null {
    return this.#field?.value ?? null
  }

  connectedCallback(): void {
    this.#internals ??= this.#attachInternals()
    const input = this.#ensureInput()
    this.#syncInputAttributes(input)

    if (this.#field) {
      this.#field.update(this.#optionsFromAttributes())
      this.#syncInternals(this.#field.state, this.#field)
      return
    }

    this.#field = lingoInput(input, {
      ...this.#optionsFromAttributes(),
      onParse: (result, field) => {
        this.#syncInternals(result.ok ? 'valid' : 'invalid', field)
      },
      onStateChange: (state, field) => {
        this.#syncInternals(state, field)
      },
    })
    if (input.value !== '') {
      this.#field.commit()
      return
    }
    this.#syncInternals(this.#field.state, this.#field)
  }

  disconnectedCallback(): void {
    this.#field?.destroy()
    this.#field = null
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) {
      return
    }
    if (this.#input) {
      this.#syncInputAttributes(this.#input)
    }
    this.#field?.update(this.#optionsFromAttributes())
    if (this.#field) {
      this.#syncInternals(this.#field.state, this.#field)
    }
  }

  formResetCallback(): void {
    const input = this.#input
    const field = this.#field
    if (!(input && field)) {
      return
    }
    setTimeout(() => {
      if (this.#input !== input || this.#field !== field || input.parentElement !== this) {
        return
      }
      input.value = input.defaultValue
      field.update(this.#optionsFromAttributes())
      if (input.defaultValue !== '') {
        field.commit()
      }
      this.#syncInternals(field.state, field)
    }, 0)
  }

  formDisabledCallback(disabled: boolean): void {
    if (this.#input) {
      this.#input.disabled = disabled
    }
  }

  #attachInternals(): ElementInternals | null {
    return typeof this.attachInternals === 'function' ? this.attachInternals() : null
  }

  #ensureInput(): HTMLInputElement {
    if (this.#input?.parentElement === this) {
      return this.#input
    }

    const existing = this.querySelector('input')
    if (existing instanceof HTMLInputElement) {
      this.#input = existing
    } else {
      this.#input = this.ownerDocument.createElement('input')
      this.appendChild(this.#input)
    }
    this.#input.type = 'text'
    this.#input.removeAttribute('name')
    return this.#input
  }

  #optionsFromAttributes(): LingoInputOptions {
    return {
      kind: attr(this, 'kind') as LingoInputOptions['kind'],
      unit: attr(this, 'unit'),
      min: attr(this, 'min'),
      max: attr(this, 'max'),
      system: attr(this, 'system') as LingoInputOptions['system'],
      strictness: attr(this, 'strictness') as LingoInputOptions['strictness'],
      display: attr(this, 'display') as LingoInputOptions['display'],
      required: this.hasAttribute('required'),
      inputmode: attr(this, 'inputmode'),
    }
  }

  #syncInputAttributes(input: HTMLInputElement): void {
    input.type = 'text'
    syncAttr(input, 'placeholder', this.getAttribute('placeholder'))
    syncAttr(input, 'inputmode', this.getAttribute('inputmode'))
    input.removeAttribute('name')
  }

  #syncInternals(state: LingoFieldState, field: LingoField): void {
    const internals = this.#internals
    if (!internals || typeof internals.setFormValue !== 'function') {
      return
    }
    const input = this.#input
    internals.setFormValue(field.value == null ? null : String(field.value))
    if (input && typeof internals.setValidity === 'function') {
      const message = state === 'invalid' ? invalidMessage(field) : ''
      internals.setValidity(state === 'invalid' ? { customError: true } : {}, message, input)
    }
  }
}

/**
 * Register the form-associated `<lingo-input>` custom element once.
 * @example
 * ```ts
 * import { defineLingoInput } from '@pascal-app/lingo/element'
 *
 * defineLingoInput()
 * document.body.innerHTML = `<lingo-input name="weight_kg" kind="mass" unit="kg"></lingo-input>`
 * ```
 */
export function defineLingoInput(tag = 'lingo-input'): void {
  if (typeof customElements === 'undefined') {
    return
  }
  if (!customElements.get(tag)) {
    customElements.define(tag, LingoInputElement)
  }
}

function attr(el: Element, name: string): string | undefined {
  return el.getAttribute(name) ?? undefined
}

function syncAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    el.removeAttribute(name)
  } else {
    el.setAttribute(name, value)
  }
}

function invalidMessage(field: LingoField): string {
  const result = field.result
  return result && !result.ok ? (result.issues[0]?.message ?? 'Invalid value.') : 'Invalid value.'
}
