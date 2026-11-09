import { describe, expect, test } from 'bun:test'
import { createStairCommitGate, swallowFollowUpBrowserClick } from './stair-click-guard'

describe('createStairCommitGate', () => {
  test('allows commits until the session exits', () => {
    const gate = createStairCommitGate()
    expect(gate.shouldCommit()).toBe(true)
    // Repeat continuation: consecutive commits stay allowed.
    expect(gate.shouldCommit()).toBe(true)
  })

  test('refuses every trigger after a single-continuation exit', () => {
    const gate = createStairCommitGate()
    expect(gate.shouldCommit()).toBe(true)
    gate.markExited()
    // The native follow-up click / stray node click of the same gesture.
    expect(gate.shouldCommit()).toBe(false)
    expect(gate.shouldCommit()).toBe(false)
  })
})

describe('swallowFollowUpBrowserClick', () => {
  test('stops exactly one follow-up click', () => {
    const target = new EventTarget()
    swallowFollowUpBrowserClick(target)

    let firstStopped = 0
    const first = new Event('click', { cancelable: true })
    Object.defineProperty(first, 'stopPropagation', { value: () => firstStopped++ })
    target.dispatchEvent(first)
    expect(firstStopped).toBe(1)
    expect(first.defaultPrevented).toBe(true)

    // `once: true` — the next click of the next gesture passes through.
    let secondStopped = 0
    const second = new Event('click', { cancelable: true })
    Object.defineProperty(second, 'stopPropagation', { value: () => secondStopped++ })
    target.dispatchEvent(second)
    expect(secondStopped).toBe(0)
    expect(second.defaultPrevented).toBe(false)
  })

  test('disarms after the timeout when no click follows', async () => {
    const target = new EventTarget()
    swallowFollowUpBrowserClick(target, 5)
    await new Promise((resolve) => setTimeout(resolve, 15))

    let stopped = 0
    const late = new Event('click', { cancelable: true })
    Object.defineProperty(late, 'stopPropagation', { value: () => stopped++ })
    target.dispatchEvent(late)
    expect(stopped).toBe(0)
  })

  test('no-ops without a window-like target', () => {
    expect(() => swallowFollowUpBrowserClick(undefined)).not.toThrow()
  })
})
