import { describe, expect, it } from 'vitest'
import {
  elementSignature,
  messagesSignature,
  objectSignature,
  optionSignature,
  stableOptionValue,
  structuralSignature,
} from './signature'

describe('React option signatures', () => {
  it('uses structural values for inline option objects', () => {
    const a = optionSignature({
      kind: 'length',
      accept: { ranges: true, fuzzy: undefined },
      tolerance: { ambiguity: 'assume', typos: 'fix' },
      escalate: { UNIT_ASSUMED: 'error', AMBIGUOUS_NUMBER: 'warning' },
    })
    const b = optionSignature({
      kind: 'length',
      accept: { fuzzy: undefined, ranges: true },
      tolerance: { typos: 'fix', ambiguity: 'assume' },
      escalate: { AMBIGUOUS_NUMBER: 'warning', UNIT_ASSUMED: 'error' },
    })

    expect(a).toBe(b)
  })

  it('tracks messages by keys and string/function shape, not function identity', () => {
    expect(
      messagesSignature({
        NO_VALUE: () => 'first',
        UNIT_ASSUMED: 'Confirm.',
      }),
    ).toBe(
      messagesSignature({
        UNIT_ASSUMED: 'Confirm.',
        NO_VALUE: () => 'second',
      }),
    )
  })

  it('tracks registry and element identity; callbacks stay off the signature type', () => {
    const registryA = {}
    const registryB = {}
    const elementA = {}
    const elementB = {}

    expect(optionSignature({ kind: 'length', debounce: 150 })).toBe(
      optionSignature({ kind: 'length', debounce: 150 }),
    )
    expect(optionSignature({ registry: registryA as never })).toBe(
      optionSignature({ registry: registryA as never }),
    )
    expect(optionSignature({ registry: registryA as never })).not.toBe(
      optionSignature({ registry: registryB as never }),
    )
    expect(elementSignature(elementA as HTMLElement)).toBe(`e:${objectSignature(elementA)}`)
    expect(elementSignature(elementA as HTMLElement)).not.toBe(
      elementSignature(elementB as HTMLElement),
    )
    expect(elementSignature('#hint')).toBe('s:#hint')
  })

  it('normalizes nested option values and snapshots', () => {
    expect(stableOptionValue({ b: 2, c: undefined, a: { z: 1, y: undefined } })).toEqual({
      a: { z: 1 },
      b: 2,
    })
    expect(structuralSignature({ b: 2, a: 1 })).toBe('{"b":2,"a":1}')
    expect(structuralSignature(null)).toBe('')
  })
})
