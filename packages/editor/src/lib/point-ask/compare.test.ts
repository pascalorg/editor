import { describe, expect, test } from 'bun:test'
import { createCompare } from './compare'

// Hold a control, see the scene as it was before the turn; let go, and it is back. The preview is
// the core's (it writes nothing: its own tests say so); what this decides is when one may start,
// and that it always ends. Written first: a hold that starts under a turn that is writing, or with
// no state to show; a second hold that leaves the first up; a release that is missed.

const snapshot = { nodes: {} } as never

function setup(options: { before?: unknown; working?: boolean; begin?: unknown } = {}) {
  const ended: string[] = []
  const changes: (string | null)[] = []
  let began = 0
  const compare = createCompare({
    before: () => ('before' in options ? (options.before as never) : snapshot),
    turnsWorking: () => options.working ?? false,
    begin: () => {
      began++
      if (options.begin === null) return null
      return { end: () => ended.push('end') }
    },
    onChange: (askId) => changes.push(askId),
  })
  return { compare, ended, changes, began: () => began }
}

describe('why a hold is refused', () => {
  test('says a turn is writing', () => {
    const { compare } = setup({ working: true })
    compare.start('ask_1')
    expect(compare.refusal()).toBe('turn-working')
  })

  test('says history cannot show the before', () => {
    const { compare } = setup({ before: null })
    compare.start('ask_1')
    expect(compare.refusal()).toBe('no-before')
  })

  test('says the scene is held by something else', () => {
    const { compare } = setup({ begin: null })
    compare.start('ask_1')
    expect(compare.refusal()).toBe('history-held')
  })

  test('says nothing after a hold that started', () => {
    const { compare } = setup({ working: true })
    compare.start('ask_1')
    const next = setup()
    next.compare.start('ask_1')
    expect(next.compare.refusal()).toBeNull()
  })
})

describe('start', () => {
  test('shows the before of that ask and says whose', () => {
    const { compare, changes } = setup()

    expect(compare.start('ask_1')).toBe(true)

    expect(compare.current()).toBe('ask_1')
    expect(changes).toEqual(['ask_1'])
  })

  test('does not start while a turn is writing: it would be swallowed or land on the wrong state', () => {
    const { compare, began } = setup({ working: true })

    expect(compare.start('ask_1')).toBe(false)

    expect(began()).toBe(0)
    expect(compare.current()).toBeNull()
  })

  test('does not start when history cannot say what it was before', () => {
    const { compare, began } = setup({ before: null })

    expect(compare.start('ask_1')).toBe(false)

    expect(began()).toBe(0)
  })

  test('does not start when the scene would not take a preview (a gesture holds it)', () => {
    const { compare, changes } = setup({ begin: null })

    expect(compare.start('ask_1')).toBe(false)

    expect(compare.current()).toBeNull()
    expect(changes).toEqual([])
  })

  test('a second hold ends the first before it starts', () => {
    const { compare, ended, changes } = setup()
    compare.start('ask_1')

    compare.start('ask_2')

    expect(ended).toEqual(['end'])
    expect(compare.current()).toBe('ask_2')
    expect(changes).toEqual(['ask_1', null, 'ask_2'])
  })
})

describe('end', () => {
  test('lets the scene go and clears the tag', () => {
    const { compare, ended, changes } = setup()
    compare.start('ask_1')

    compare.end()

    expect(ended).toEqual(['end'])
    expect(compare.current()).toBeNull()
    expect(changes).toEqual(['ask_1', null])
  })

  test('is idempotent: a pointer-up, a blur and a key can all arrive', () => {
    const { compare, ended, changes } = setup()
    compare.start('ask_1')

    compare.end()
    compare.end()
    compare.end()

    expect(ended).toEqual(['end'])
    expect(changes).toEqual(['ask_1', null])
  })

  test('with nothing held is nothing', () => {
    const { compare, changes } = setup()

    compare.end()

    expect(changes).toEqual([])
  })

  test('when the scene let go by itself (a write), the tag follows', () => {
    const { compare, changes } = setup()
    compare.start('ask_1')

    compare.released()

    expect(compare.current()).toBeNull()
    expect(changes).toEqual(['ask_1', null])
  })
})
