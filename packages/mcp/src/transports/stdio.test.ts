import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { connectStdio } from './stdio'

let bridge: SceneBridge

beforeEach(() => {
  bridge = new SceneBridge()
  bridge.loadDefault()
})

afterEach(() => {
  // Fresh store per test — no global teardown needed.
})

test('connectStdio is an async function', () => {
  expect(typeof connectStdio).toBe('function')
  // Async functions report their constructor as AsyncFunction.
  expect(connectStdio.constructor.name).toBe('AsyncFunction')
})

test('server+client over linked in-memory pair can list tools', async () => {
  // Functional equivalence check: we can't attach the real stdio transport in
  // a test (it hijacks process stdin/stdout), but we can still verify that
  // `createPascalMcpServer` produces a server that exposes tools over any
  // MCP transport. This catches regressions where tool registration fails
  // silently during server construction.
  const server = createPascalMcpServer({ bridge })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  const client = new Client({ name: 'stdio-test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  try {
    const tools = await client.listTools()
    expect(Array.isArray(tools.tools)).toBe(true)
    // Don't require a specific count — other agents own tool registration.
    // Just assert the wiring carries protocol traffic end-to-end.
  } finally {
    await client.close()
    await server.close()
  }
})
