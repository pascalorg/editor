import { describe, expect, test } from 'bun:test'
import { resolveLoopCutPointerAction, resolveLoopCutSlideFactor } from './loop-cut-interaction'

describe('loop cut interaction', () => {
  test('uses two confirmations for a cut and slide', () => {
    expect(resolveLoopCutPointerAction('choosing-ring', 0)).toBe('begin-slide')
    expect(resolveLoopCutPointerAction('sliding', 0)).toBe('commit-current')
  })

  test('cancels before the draft and commits centered from the slide stage', () => {
    expect(resolveLoopCutPointerAction('choosing-ring', 2)).toBe('cancel')
    expect(resolveLoopCutPointerAction('sliding', 2)).toBe('commit-centered')
  })

  test('defers multi-cut sliding while retaining single-cut slide input', () => {
    expect(resolveLoopCutSlideFactor(1, 0.8)).toBe(0.8)
    expect(resolveLoopCutSlideFactor(3, 0.8)).toBe(0.5)
  })
})
