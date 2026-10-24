import { describe, expect, test } from 'bun:test'
import type { PointAskSubmit } from '../agent-operations/point-context'
import { hasPointAskHandler, registerPointAskHandler, submitPointAsk } from './point-ask'

// Point and ask is offered only where a host answers it (the open-source editor has no chat), and
// an ask is never lost silently: no handler or a throwing one comes back as a reason in words.
const submit = { askId: 'ask_1', text: 'Make it wider' } as unknown as PointAskSubmit

describe('the point-ask handler', () => {
  test('is absent until a host registers, and gone when it unregisters', () => {
    expect(hasPointAskHandler()).toBe(false)
    const off = registerPointAskHandler(async () => ({ ok: true }))
    expect(hasPointAskHandler()).toBe(true)
    off()
    expect(hasPointAskHandler()).toBe(false)
  })

  test('hands the ask to the handler and returns its answer', async () => {
    const seen: string[] = []
    const off = registerPointAskHandler(async (s) => {
      seen.push(s.askId)
      return { ok: true }
    })

    expect(await submitPointAsk(submit)).toEqual({ ok: true })
    expect(seen).toEqual(['ask_1'])
    off()
  })

  test('with no handler, says it is unavailable instead of dropping the ask', async () => {
    const result = await submitPointAsk(submit)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unavailable')
  })

  test('a throwing handler is an error result, not an exception', async () => {
    const off = registerPointAskHandler(async () => {
      throw new Error('socket closed')
    })
    const result = await submitPointAsk(submit)

    expect(result).toEqual({ ok: false, code: 'error', message: 'socket closed' })
    off()
  })

  test('a stale unregister does not remove a newer handler', () => {
    const offOld = registerPointAskHandler(async () => ({ ok: true }))
    const offNew = registerPointAskHandler(async () => ({ ok: true }))
    offOld()

    expect(hasPointAskHandler()).toBe(true)
    offNew()
  })
})
