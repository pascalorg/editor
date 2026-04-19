import { expect, test } from 'bun:test'

test('version module loads', async () => {
  const mod = await import('./index')
  expect(mod.version).toBe('0.1.0')
})

test('createPascalMcpServer is a function', async () => {
  const mod = await import('./index')
  expect(typeof mod.createPascalMcpServer).toBe('function')
})
