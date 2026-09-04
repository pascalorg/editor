import type { LingoFieldFormatOptions } from '../dom/format'
import type { LingoInputOptions } from '../dom/index'

const objectIds = new WeakMap<object, number>()
let nextObjectId = 0

/** Serializable field knobs shared by DOM and React Native option signatures. */
export type LingoOptionSignatureInput = LingoFieldFormatOptions &
  Pick<LingoInputOptions, 'debounce' | 'max' | 'min' | 'required'> &
  Partial<
    Pick<
      LingoInputOptions,
      'errorElement' | 'hintElement' | 'inputmode' | 'listboxId' | 'name' | 'validationBehavior'
    >
  >

export function objectSignature(value: unknown): string {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return ''
  }
  let id = objectIds.get(value)
  if (id === undefined) {
    id = ++nextObjectId
    objectIds.set(value, id)
  }
  return `#${id}`
}

export function elementSignature(
  value: LingoInputOptions['errorElement'] | LingoInputOptions['hintElement'] | undefined,
): string {
  if (typeof value === 'string') {
    return `s:${value}`
  }
  return value ? `e:${objectSignature(value)}` : ''
}

export function stableOptionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableOptionValue)
  }
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(input).sort()) {
      const item = input[key]
      if (item !== undefined) {
        out[key] = stableOptionValue(item)
      }
    }
    return out
  }
  return typeof value === 'function' ? 'f' : value
}

export function messagesSignature(messages: LingoInputOptions['messages']): string {
  return messages
    ? Object.keys(messages)
        .sort()
        .map((k) => {
          const v = (messages as Record<string, unknown>)[k]
          return `${k}:${typeof v === 'function' ? 'f' : String(v)}`
        })
        .join('|')
    : ''
}

export function structuralSignature(value: unknown): string {
  return value == null ? '' : (JSON.stringify(value) ?? '')
}

/**
 * Value-based signature of the serializable options. React callers often build
 * `accept`/`messages`/`tolerance` as inline literals on every render; comparing
 * by value prevents update effects from retriggering themselves forever
 * (React error #185). Function-typed options are intentionally excluded here
 * and are live-read through refs by the hook.
 */
export function optionSignature(o: LingoOptionSignatureInput): string {
  const messagesSig = messagesSignature(o.messages)
  return JSON.stringify([
    o.kind,
    o.unit,
    o.displayUnit,
    o.display,
    o.system,
    o.numberFormat,
    o.profile,
    o.strictness,
    stableOptionValue(o.accept),
    stableOptionValue(o.tolerance),
    stableOptionValue(o.escalate),
    messagesSig,
    // Registry and HTMLElement-like options are behavior-affecting but not
    // serializable, so the signature tracks their identity.
    objectSignature(o.registry),
    o.min,
    o.max,
    o.required,
    o.name,
    o.validationBehavior,
    elementSignature(o.errorElement),
    elementSignature(o.hintElement),
    o.inputmode,
    o.listboxId,
    o.debounce,
  ])
}
