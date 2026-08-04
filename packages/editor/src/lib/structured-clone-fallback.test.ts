import { afterEach, describe, expect, test } from 'bun:test'

const native = globalThis.structuredClone

afterEach(() => {
  globalThis.structuredClone = native
})

async function installFallback() {
  // Fresh module instance each time — the shim is a module side effect.
  await import(`./structured-clone-fallback?${Math.random()}`)
}

describe('structuredClone fallback', () => {
  test('leaves a native implementation alone', async () => {
    await installFallback()
    expect(globalThis.structuredClone).toBe(native)
  })

  test('installs a JSON-based clone when the global is missing', async () => {
    // @ts-expect-error — simulating a browser without the global.
    globalThis.structuredClone = undefined
    await installFallback()

    const source = { units: [{ factor: 1, id: 'm' }], kind: 'length' }
    const copy = structuredClone(source)

    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.units).not.toBe(source.units)
  })

  test('lets lingo build its registry without the global', async () => {
    // @ts-expect-error — simulating a browser without the global.
    globalThis.structuredClone = undefined
    await installFallback()

    // The actual regression: lingo clones its kind table at module-eval time,
    // so this import throws on a browser lacking structuredClone.
    const { parseQuantity } = await import('@pascal-app/lingo')
    const result = parseQuantity('180cm', { kind: 'length', unit: 'm' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quantity.to('m').value).toBeCloseTo(1.8, 6)
  })
})
