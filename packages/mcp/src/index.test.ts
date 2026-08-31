import { expect, test } from 'bun:test'
import packageJson from '../package.json'

test('version module loads', async () => {
  const mod = await import('./index')
  expect(mod.version).toBe(packageJson.version)
})

test('createPascalMcpServer is a function', async () => {
  const mod = await import('./index')
  expect(typeof mod.createPascalMcpServer).toBe('function')
})
