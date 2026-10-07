import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PASCAL_TYPES } from '@pascal-app/core/agent-operations'
import type { AnyNodeId, CompiledGeometryScript } from '@pascal-app/core/schema'
import { ADD_OBJECT_CASES } from '../../../core/src/agent-operations/__fixtures__/add-object-cases'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import { type GeometryScriptHost, registerAddObject } from './add-object'

// Layer 2 of 3: add_object through a real client, the host's compile answering with the case's.
type Result = { isError?: boolean; content: Array<{ type: string; text: string }> }

describe('add_object over MCP', () => {
  let bridge: SceneBridge
  let client: Client
  let compiled: CompiledGeometryScript
  let compiles = 0

  const host: GeometryScriptHost = {
    compile: async () => {
      compiles++
      return { ...compiled, glb: new Uint8Array() }
    },
    storeArtifact: async ({ sha256 }) => sha256,
    readArtifact: async () => null,
  }

  beforeEach(async () => {
    bridge = new SceneBridge()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerAddObject(server, bridge, host)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  for (const c of ADD_OBJECT_CASES) {
    if (c.surfaces && !c.surfaces.includes('mcp')) continue
    test(c.name, async () => {
      const { nodes, rootNodeIds } = c.scene()
      bridge.setScene(nodes as never, rootNodeIds as never)
      bridge.setActiveScene({ id: 'scene_cases', name: 'Cases' } as never)
      compiled = c.compiled
      compiles = 0
      const result = (await client.callTool({ name: 'add_object', arguments: c.input })) as Result
      const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>
      if ('refusal' in c.expect) {
        expect(result.isError).toBe(true)
        expect(payload.code).toBe(c.expect.refusal)
        for (const text of c.expect.mentions ?? []) expect(String(payload.error)).toContain(text)
        if (c.expect.beforeCompile) expect(compiles).toBe(0)
        return
      }
      expect(result.isError).toBeFalsy()
      expect(payload).toMatchObject(c.expect.result)
      // Every write answers what the scene now holds: the object built, or rebuilt.
      expect(payload.achieved).toMatchObject({ created: expect.any(Object), deleted: {} })
      expect(payload.achieved).not.toHaveProperty('unchanged')
      if (c.expect.node)
        expect(bridge.getNode(payload.nodeId as AnyNodeId)).toMatchObject(c.expect.node)
      for (const text of c.expect.mentions ?? []) expect(JSON.stringify(payload)).toContain(text)
    })
  }
})

// A hint that names a tool the server does not offer sends the agent to a call that fails.
test('every tool an add_object hint names is one the server offers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pascal-mcp-hints-'))
  const server = createPascalMcpServer({
    bridge: new SceneBridge(),
    store: new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') }),
  })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'hint-test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const offered = new Set((await client.listTools()).tools.map((tool) => tool.name))
    const named = PASCAL_TYPES.flatMap(([, hint]) => hint.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((name) => !offered.has(name))).toEqual([])
  } finally {
    await client.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
