import { expect, spyOn, test } from 'bun:test'
import { swallowNextClick } from './use-handle-drag'

test('deferred click cleanup removes the listener from its original window', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const target = new EventTarget()
  const remove = spyOn(target, 'removeEventListener')
  let cleanup: (() => void) | undefined
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: Parameters<typeof setTimeout>[0],
  ) => {
    cleanup = callback as () => void
    return undefined as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout)
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target })
    swallowNextClick()
    Reflect.deleteProperty(globalThis, 'window')
    expect(cleanup).toBeDefined()
    expect(() => cleanup?.()).not.toThrow()
    expect(remove).toHaveBeenCalledTimes(1)
  } finally {
    timer.mockRestore()
    remove.mockRestore()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
