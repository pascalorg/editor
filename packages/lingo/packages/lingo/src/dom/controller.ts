import {
  firstError,
  type LingoIssue,
  type LingoResult,
  lingo,
  parseQuantity,
  partialState,
  type Quantity,
  type QuantityRange,
  type Span,
} from '../index'
import { AttributeStore, addToken, removeToken } from './attributes'
import {
  acceptedResult,
  defaultCandidate,
  defaultHiddenValue,
  defaultHint,
  failResult,
  formatQuantityForDisplay,
  formatResultForCommit,
  localIssue,
  type Material,
  materialize,
  resultKind,
  toLingoOptions,
} from './format'
import type {
  LingoField,
  LingoFieldState,
  LingoInputOptions,
  LingoValidationBehavior,
} from './index'

export type LingoElement = HTMLInputElement | HTMLTextAreaElement
type ChangeDetail = { state: LingoFieldState; value: number | null; result: LingoResult | null }

interface ParsedBound {
  label: string
  quantity: Quantity
}

export const registry = new WeakMap<LingoElement, LingoField>()
let nextId = 0

export class Controller implements LingoField {
  private opts: LingoInputOptions
  private parseTimer: ReturnType<typeof setTimeout> | null = null
  private hintTimer: ReturnType<typeof setTimeout> | null = null
  private composing = false
  private touched = false
  private destroyed = false
  private hidden: HTMLInputElement | null = null
  private form: HTMLFormElement | null = null
  private errorEl: HTMLElement | null = null
  private hintEl: HTMLElement | null = null
  private errorId: string | null = null
  private readonly attrs: AttributeStore
  private errorAttrs: AttributeStore | null = null
  private hintAttrs: AttributeStore | null = null
  private initialRaw: string
  private currentState: LingoFieldState = 'idle'
  private currentValue: number | null = null
  private currentQuantity: Quantity | QuantityRange | null = null
  private currentResult: LingoResult | null = null
  private min: ParsedBound | null = null
  private max: ParsedBound | null = null

  constructor(
    private readonly el: LingoElement,
    opts: LingoInputOptions,
  ) {
    this.opts = { debounce: 150, display: 'canonical', ...opts }
    this.attrs = new AttributeStore(el)
    this.initialRaw = el.value
    this.applyAttachAttributes()
    this.resolveAuxiliaryElements()
    this.reparseBounds()
    this.configureHidden()
    this.form = el.form
    this.form?.addEventListener('submit', this.onSubmit)
    this.form?.addEventListener('reset', this.onReset)
    el.addEventListener('input', this.onInput)
    el.addEventListener('blur', this.onBlur)
    el.addEventListener('keydown', this.onKeydown)
    el.addEventListener('compositionstart', this.onCompositionStart)
    el.addEventListener('compositionend', this.onCompositionEnd)
    this.updateState('idle', null, false)
  }

  get raw(): string {
    return this.el.value
  }

  get value(): number | null {
    return this.currentValue
  }

  get quantity(): Quantity | QuantityRange | null {
    return this.currentQuantity
  }

  get result(): LingoResult | null {
    return this.currentResult
  }

  get state(): LingoFieldState {
    return this.currentState
  }

  set(v: number | string): void {
    if (this.destroyed) {
      return
    }
    if (typeof v === 'number') {
      if (this.opts.unit) {
        const parsed = parseQuantity(String(v), toLingoOptions(this.opts))
        this.el.value = parsed.ok
          ? formatQuantityForDisplay(parsed.quantity, this.opts.displayUnit ?? this.opts.unit)
          : String(v)
      } else {
        this.el.value = String(v)
      }
    } else {
      this.el.value = v
    }
    this.commitInternal(false)
  }

  commit(): void {
    this.commitInternal(true)
  }

  update(opts: Partial<LingoInputOptions>): void {
    if (this.destroyed) {
      return
    }
    const previousOpts = this.opts
    const previousResult = this.currentState === 'valid' ? this.currentResult : null
    const previousCommitText = previousResult
      ? formatResultForCommit(previousResult, previousOpts)
      : null
    // Reuse the previous result instead of reparsing the rounded display
    // text: after update({ unit: 'cm' }), reparsing "1.83 m" would turn
    // 6 ft into 183 cm instead of 182.88.
    const canReusePrevious =
      previousResult?.ok === true &&
      (this.el.value === previousResult.text ||
        (previousCommitText !== null && this.el.value === previousCommitText)) &&
      (!opts.kind || opts.kind === resultKind(previousResult))
    this.opts = { ...this.opts, ...opts }
    this.applyAttachAttributes()
    this.resolveAuxiliaryElements()
    this.reparseBounds()
    this.configureHidden()
    if (canReusePrevious) {
      const issue = this.rangeIssue(previousResult)
      if (issue) {
        this.updateState('invalid', failResult(this.el.value, [issue]), false)
      } else {
        this.updateState('valid', previousResult, false)
      }
      return
    }
    this.parseNow(false)
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.clearTimers()
    this.el.removeEventListener('input', this.onInput)
    this.el.removeEventListener('blur', this.onBlur)
    this.el.removeEventListener('keydown', this.onKeydown)
    this.el.removeEventListener('compositionstart', this.onCompositionStart)
    this.el.removeEventListener('compositionend', this.onCompositionEnd)
    this.form?.removeEventListener('submit', this.onSubmit)
    this.form?.removeEventListener('reset', this.onReset)
    this.hidden?.remove()
    this.attrs.restore()
    this.errorAttrs?.restore()
    this.hintAttrs?.restore()
    registry.delete(this.el)
  }

  private readonly onInput = () => {
    if (this.composing) {
      return
    }
    this.scheduleParse()
  }

  private readonly onBlur = () => {
    this.commitInternal(true)
  }

  private readonly onKeydown = (event: Event) => {
    const keyEvent = event as KeyboardEvent
    if (keyEvent.key !== 'Enter' || this.composing) {
      return
    }
    const valid = this.commitInternal(true)
    if (!valid && this.validationBehavior() === 'native') {
      if (typeof this.el.reportValidity === 'function') {
        this.el.reportValidity()
      }
      keyEvent.preventDefault()
    }
  }

  private readonly onCompositionStart = () => {
    this.composing = true
  }

  private readonly onCompositionEnd = () => {
    this.composing = false
    this.parseNow(false)
  }

  private readonly onSubmit = (event: SubmitEvent) => {
    const valid = this.commitInternal(true)
    if (!valid && this.validationBehavior() === 'native') {
      if (typeof this.el.reportValidity === 'function') {
        this.el.reportValidity()
      }
      event.preventDefault()
    }
  }

  private readonly onReset = () => {
    this.clearTimers()
    // The reset event fires before the browser restores defaultValue, so
    // state must be cleared on the next tick.
    setTimeout(() => {
      if (this.destroyed) {
        return
      }
      this.touched = false
      this.currentState = 'idle'
      this.currentValue = null
      this.currentQuantity = null
      this.currentResult = null
      if (this.hidden) {
        this.hidden.value = ''
      }
      this.render()
      this.dispatchChange()
    }, 0)
  }

  private validationBehavior(): LingoValidationBehavior {
    return this.opts.validationBehavior ?? (this.errorEl ? 'aria' : 'native')
  }

  private emitCompletions(raw: string, collapsed = false): void {
    if (!(this.opts.complete || this.opts.onComplete)) {
      return
    }
    const list = raw.trim() === '' ? [] : (this.opts.complete?.(raw) ?? [])
    this.attrs.set('aria-expanded', !collapsed && list.length ? 'true' : 'false')
    this.opts.onComplete?.(list, this)
  }

  private clearTimers(): void {
    if (this.parseTimer) {
      clearTimeout(this.parseTimer)
    }
    if (this.hintTimer) {
      clearTimeout(this.hintTimer)
    }
    this.parseTimer = null
    this.hintTimer = null
  }

  private scheduleParse(): void {
    if (this.parseTimer) {
      clearTimeout(this.parseTimer)
    }
    this.parseTimer = setTimeout(() => {
      this.parseTimer = null
      this.parseNow(false)
    }, this.opts.debounce ?? 150)
  }

  private parseNow(fromCommit: boolean): LingoResult | null {
    if (this.parseTimer) {
      clearTimeout(this.parseTimer)
      this.parseTimer = null
    }
    const raw = this.el.value
    this.emitCompletions(raw, fromCommit)
    const partial = partialState(raw, toLingoOptions(this.opts))
    if (partial === 'empty') {
      this.updateState('idle', null, fromCommit)
      return null
    }
    if (partial === 'incomplete') {
      this.updateState('incomplete', null, fromCommit)
      return null
    }
    const result = acceptedResult(lingo(raw, toLingoOptions(this.opts)), this.opts)
    this.opts.onParse?.(result, this)
    this.updateState(result.ok ? 'valid' : 'invalid', result, fromCommit)
    return result
  }

  private commitInternal(markTouched: boolean): boolean {
    if (this.destroyed) {
      return false
    }
    if (markTouched) {
      this.touched = true
    }
    const raw = this.el.value
    if (raw.trim() === '') {
      if (this.opts.required) {
        const issue = localIssue(this.opts, 'REQUIRED', {}, { start: 0, end: raw.length })
        const result = failResult(raw, [issue])
        this.updateState('invalid', result, true)
        this.hiddenValue('')
        this.opts.onError?.(result.issues, this)
        this.opts.onCommit?.(this)
        return false
      }
      this.updateState('idle', null, true)
      this.hiddenValue('')
      this.opts.onCommit?.(this)
      return true
    }

    const result = this.parseNow(true)
    if (!result?.ok) {
      // Any non-valid commit ('invalid' AND 'incomplete') must drop the
      // canonical value: the hidden input may still carry the previous
      // commit, and submitting it would contradict the visible text.
      this.hiddenValue('')
      if (result) {
        this.opts.onError?.(result.issues, this)
      }
      this.opts.onCommit?.(this)
      return false
    }

    const rangeIssue = this.rangeIssue(result)
    if (rangeIssue) {
      const invalid = failResult(raw, [rangeIssue])
      this.updateState('invalid', invalid, true)
      this.hiddenValue('')
      this.opts.onError?.(invalid.issues, this)
      this.opts.onCommit?.(this)
      return false
    }

    const formatted = formatResultForCommit(result, this.opts)
    if (formatted !== null) {
      this.el.value = formatted
    }
    this.updateState('valid', result, true)
    this.opts.onCommit?.(this)
    return true
  }

  private updateState(
    state: LingoFieldState,
    result: LingoResult | null,
    committed: boolean,
  ): void {
    const beforeState = this.currentState
    const beforeValue = this.currentValue
    this.currentState = state
    this.currentResult = result
    const material = materialize(result, this.opts)
    this.currentValue = state === 'valid' ? material.value : null
    this.currentQuantity = state === 'valid' ? material.quantity : null
    if (state === 'valid' && material.quantity) {
      this.syncHidden(material.quantity)
    }
    this.render(committed, material)
    if (beforeState !== this.currentState || beforeValue !== this.currentValue) {
      this.opts.onStateChange?.(this.currentState, this)
      this.dispatchChange()
    }
  }

  private render(
    committed = false,
    material: Material = materialize(this.currentResult, this.opts),
  ): void {
    const error = firstError(this.currentResult)
    const showError = this.currentState === 'invalid' && this.touched && error !== null
    this.attrs.set('data-lingo', 'input')
    this.attrs.set('data-state', this.currentState)

    // Advertise the configured kind even before any parse so browser agents
    // can discover field semantics from the DOM alone (plan 012): an idle
    // height field still reads data-kind="length" data-unit="m".
    const kind =
      (this.currentResult ? resultKind(this.currentResult) : null) ?? this.opts.kind ?? null
    this.attrs.sync('data-kind', kind)
    this.attrs.sync('data-touched', this.touched && '')
    this.attrs.sync('data-dirty', this.el.value !== this.initialRaw && '')
    this.attrs.sync('data-invalid', this.touched && this.currentState === 'invalid' && '')
    this.attrs.sync('data-valid', this.touched && this.currentState === 'valid' && '')
    this.attrs.sync('data-approx', this.currentState === 'valid' && material.approximate && '')
    this.attrs.sync(
      'data-canonical',
      this.currentState === 'valid' && material.canonical !== null && material.canonical,
    )
    this.attrs.sync('data-unit', this.opts.unit || null)
    this.attrs.sync('aria-invalid', showError && 'true')

    if (
      (this.validationBehavior() === 'native' || this.form) &&
      typeof this.el.setCustomValidity === 'function'
    ) {
      this.el.setCustomValidity(this.currentState === 'invalid' && error ? error.message : '')
    }

    this.renderError(showError ? error.message : '', showError, committed)
    this.renderHint()
  }

  private renderError(message: string, show: boolean, committed: boolean): void {
    if (!this.errorEl) {
      return
    }
    if (!this.errorId) {
      if (!this.errorEl.id) {
        this.errorAttrs?.set('id', `lingo-error-${++nextId}`)
      }
      this.errorId = this.errorEl.id
    }
    if (!this.errorEl.getAttribute('role')) {
      this.errorAttrs?.set('role', 'alert')
    }

    if (show && this.errorId) {
      this.attrs.set(
        'aria-describedby',
        addToken(this.el.getAttribute('aria-describedby'), this.errorId),
      )
      if (committed || this.errorEl.textContent !== message) {
        this.errorEl.textContent = message
      }
    } else {
      const next = this.errorId
        ? removeToken(this.el.getAttribute('aria-describedby'), this.errorId)
        : null
      this.attrs.sync('aria-describedby', next)
      this.errorEl.textContent = ''
    }
  }

  private renderHint(): void {
    if (!this.hintEl) {
      return
    }
    if (this.hintTimer) {
      clearTimeout(this.hintTimer)
      this.hintTimer = null
    }
    const result = this.currentState === 'valid' ? this.currentResult : null
    const candidate =
      this.currentState === 'invalid' && this.currentResult && !this.currentResult.ok
        ? this.currentResult.candidate
        : undefined
    if (candidate) {
      this.hintEl.textContent =
        this.opts.formatCandidate?.(candidate) ?? defaultCandidate(candidate)
      return
    }
    if (!result?.ok) {
      this.hintEl.textContent = ''
      return
    }
    this.hintTimer = setTimeout(() => {
      if (this.destroyed || !this.hintEl) {
        return
      }
      this.hintEl.textContent = this.opts.formatHint?.(result) ?? defaultHint(result, this.opts)
    }, 500)
  }

  private rangeIssue(result: LingoResult): LingoIssue | null {
    const material = materialize(result, this.opts)
    const q = material.quantity
    if (!q) {
      return null
    }
    const span: Span = { start: 0, end: this.el.value.length }
    if ('base' in q) {
      if (this.min && q.base < this.min.quantity.base) {
        return localIssue(this.opts, 'RANGE_MIN', { min: this.min.label }, span)
      }
      if (this.max && q.base > this.max.quantity.base) {
        return localIssue(this.opts, 'RANGE_MAX', { max: this.max.label }, span)
      }
      return null
    }
    const min = q.min()
    const max = q.max()
    if (this.min && min && min.base < this.min.quantity.base) {
      return localIssue(this.opts, 'RANGE_MIN', { min: this.min.label }, span)
    }
    if (this.max && max && max.base > this.max.quantity.base) {
      return localIssue(this.opts, 'RANGE_MAX', { max: this.max.label }, span)
    }
    return null
  }

  private parseBound(value: string | number | undefined): ParsedBound | null {
    if (value === undefined) {
      return null
    }
    const text = typeof value === 'number' ? String(value) : value
    const parsed = parseQuantity(text, toLingoOptions(this.opts))
    if (!parsed.ok) {
      return null
    }
    const unit = this.opts.unit ?? parsed.quantity.unit
    const quantity = parsed.quantity.to(unit)
    return { quantity, label: formatQuantityForDisplay(quantity, unit) }
  }

  private reparseBounds(): void {
    this.min = this.parseBound(this.opts.min)
    this.max = this.parseBound(this.opts.max)
  }

  private applyAttachAttributes(): void {
    for (const [name, value] of [
      ['autocomplete', 'off'],
      ['autocorrect', 'off'],
      ['autocapitalize', 'none'],
      ['spellcheck', 'false'],
    ] as const) {
      this.attrs.setDefault(name, value)
    }
    if (this.opts.inputmode !== undefined) {
      this.attrs.set('inputmode', this.opts.inputmode)
    }
    if (this.opts.complete || this.opts.onComplete) {
      this.attrs.setDefault('role', 'combobox')
      this.attrs.setDefault('aria-autocomplete', 'list')
      this.attrs.set('aria-expanded', 'false')
      const listboxId = this.opts.listboxId
      if (listboxId) {
        this.attrs.set('aria-controls', listboxId)
      }
    }
  }

  private resolveAuxiliaryElements(): void {
    const doc = this.el.ownerDocument
    this.errorEl = this.resolveElement(this.opts.errorElement, doc)
    this.hintEl = this.resolveElement(this.opts.hintElement, doc)
    this.errorAttrs = this.errorEl ? new AttributeStore(this.errorEl) : null
    this.hintAttrs = this.hintEl ? new AttributeStore(this.hintEl) : null
    if (this.hintEl) {
      this.hintAttrs?.set('aria-hidden', 'true')
    }
  }

  private resolveElement(
    target: HTMLElement | string | undefined,
    doc: Document,
  ): HTMLElement | null {
    if (!target) {
      return null
    }
    if (typeof target === 'string') {
      return doc.querySelector(target)
    }
    return target
  }

  private configureHidden(): void {
    if (!this.opts.name) {
      this.hidden?.remove()
      this.hidden = null
      return
    }
    if (this.el.getAttribute('name') !== null) {
      this.attrs.remove('name')
    }
    if (!this.hidden) {
      this.hidden = this.el.ownerDocument.createElement('input')
      this.hidden.type = 'hidden'
      this.el.after(this.hidden)
    }
    this.hidden.name = this.opts.name
  }

  private syncHidden(q: Quantity | QuantityRange): void {
    if (!this.hidden) {
      return
    }
    this.hidden.value = this.opts.hiddenFormat?.(q) ?? defaultHiddenValue(q, this.opts.unit)
  }

  private hiddenValue(value: string): void {
    if (this.hidden) {
      this.hidden.value = value
    }
  }

  private dispatchChange(): void {
    const detail: ChangeDetail = {
      state: this.currentState,
      value: this.currentValue,
      result: this.currentResult,
    }
    const win = this.el.ownerDocument.defaultView
    const EventCtor = win?.CustomEvent ?? globalThis.CustomEvent
    let event: Event
    if (typeof EventCtor === 'function') {
      event = new EventCtor('lingo:change', { bubbles: true, detail })
    } else {
      event = this.el.ownerDocument.createEvent('CustomEvent')
      ;(event as CustomEvent).initCustomEvent('lingo:change', true, false, detail)
    }
    this.el.dispatchEvent(event)
  }
}
