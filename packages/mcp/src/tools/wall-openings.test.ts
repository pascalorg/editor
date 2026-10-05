import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import {
  openingScene,
  WALL_OPENING_CASES,
} from '../../../core/src/building/__fixtures__/wall-opening-cases'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerAddDoor, registerAddWindow } from './room-tools'

// Layer 2 of 3: the MCP tools, through a real client, on the same cases as the core operation.
type Result = {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent?: Record<string, unknown>
}

describe('add_door / add_window over MCP', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    const { nodes, rootNodeIds } = openingScene()
    bridge.setScene(nodes as never, rootNodeIds as never)
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerAddDoor(server, bridge)
    registerAddWindow(server, bridge)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    await client.listTools()
  })

  for (const c of WALL_OPENING_CASES) {
    test(c.name, async () => {
      const result = (await client.callTool({ name: c.tool, arguments: c.input })) as Result
      const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>
      if ('refusal' in c.expect) {
        expect(result.isError).toBe(true)
        expect(payload.code).toBe(c.expect.refusal)
        for (const text of c.expect.mentions ?? []) expect(String(payload.error)).toContain(text)
        return
      }
      expect(result.isError).toBeFalsy()
      expect(payload.localX as number).toBeCloseTo(c.expect.localX, 6)
      expect(payload.clamped).toBe(c.expect.clamped)
      const node = bridge.getNode((payload.doorId ?? payload.windowId) as AnyNodeId) as {
        position: [number, number, number]
      }
      expect(node.position[1]).toBeCloseTo(c.expect.centerY, 6)
      if (c.expect.glassPanels) expect(JSON.stringify(node)).toContain('"glass"')
    })
  }
})
