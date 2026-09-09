import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from './bridge/scene-bridge'
import { createPascalMcpServer } from './server'

describe('Pascal MCP tool execution', () => {
  test('runs registered tools through the configured executor', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const events: string[] = []
    const server = createPascalMcpServer({
      bridge,
      executeTool: async ({ name, signal, execute }) => {
        events.push(`before:${name}`)
        expect(signal).toBeInstanceOf(AbortSignal)
        const result = await execute()
        events.push(`after:${name}`)
        return result
      },
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'tool-executor-test', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const result = await client.callTool({ name: 'get_scene', arguments: {} })
      expect(result.isError).toBeFalsy()
      expect(events).toEqual(['before:get_scene', 'after:get_scene'])
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('passes request cancellation through the executor before invoking a tool', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    let callbackCalls = 0
    let notifyExecutorStarted: (() => void) | undefined
    const executorStarted = new Promise<void>((resolve) => {
      notifyExecutorStarted = resolve
    })
    let notifyExecutorStopped: (() => void) | undefined
    const executorStopped = new Promise<void>((resolve) => {
      notifyExecutorStopped = resolve
    })
    const server = createPascalMcpServer({
      bridge,
      executeTool: async ({ name, signal, execute }) => {
        if (name !== 'cancel_probe') return execute()
        notifyExecutorStarted?.()
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
        try {
          signal.throwIfAborted()
          return await execute()
        } finally {
          notifyExecutorStopped?.()
        }
      },
    })
    server.registerTool('cancel_probe', { inputSchema: {} }, async () => {
      callbackCalls++
      return { content: [{ type: 'text', text: 'mutated' }] }
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'tool-cancellation-test', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const controller = new AbortController()
      const call = client.callTool({ name: 'cancel_probe', arguments: {} }, undefined, {
        signal: controller.signal,
      })
      await executorStarted
      controller.abort()
      await expect(call).rejects.toThrow()
      await executorStopped
      expect(callbackCalls).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('wraps tools registered through the deprecated tool surface', async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    const executed: string[] = []
    const server = createPascalMcpServer({
      bridge,
      executeTool: async ({ name, execute }) => {
        executed.push(name)
        return execute()
      },
    })
    server.tool('legacy_probe', async () => ({
      content: [{ type: 'text', text: 'legacy result' }],
    }))
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'legacy-tool-executor-test', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const result = await client.callTool({ name: 'legacy_probe', arguments: {} })
      expect(result.isError).toBeFalsy()
      expect(executed).toEqual(['legacy_probe'])
    } finally {
      await client.close()
      await server.close()
    }
  })
})
