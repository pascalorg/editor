import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Client,
  type ClientOptions,
  InMemoryTransport,
  SdkErrorCode,
} from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { type AnyNode, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { connectStdio } from './stdio'

const MODERN = '2026-07-28'

const clients: Record<string, ClientOptions> = {
  'an older client (2025 initialize)': {},
  'a negotiating client': { versionNegotiation: { mode: 'auto' } },
  [`a client pinned to ${MODERN}`]: { versionNegotiation: { mode: { pin: MODERN } } },
}

function createServer() {
  const bridge = new SceneBridge()
  bridge.loadDefault()
  return createPascalMcpServer({ bridge })
}

async function expectServed(client: Client, options: ClientOptions) {
  const modern = options.versionNegotiation !== undefined
  expect(client.getProtocolEra()).toBe(modern ? 'modern' : 'legacy')
  if (modern) expect(client.getNegotiatedProtocolVersion()).toBe(MODERN)
  else expect(client.getNegotiatedProtocolVersion()?.startsWith('2025-')).toBe(true)

  const { tools } = await client.listTools()
  expect(tools.some((tool) => tool.name === 'get_scene')).toBe(true)
  const scene = await client.callTool({ name: 'get_scene', arguments: {} })
  expect(scene.isError).toBeFalsy()
}

describe('connectStdio', () => {
  for (const [who, options] of Object.entries(clients)) {
    test(`serves ${who}`, async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const handle = connectStdio(createServer, { transport: serverTransport })
      const client = new Client({ name: 'stdio-test-client', version: '0.0.0' }, options)
      try {
        await client.connect(clientTransport)
        await expectServed(client, options)
      } finally {
        await client.close()
        await handle.close()
      }
    })
  }

  test(`keeps one scene for the whole connection on ${MODERN}`, async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const handle = connectStdio(createServer, { transport: serverTransport })
    const client = new Client(
      { name: 'stdio-test-client', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: MODERN } } },
    )
    try {
      await client.connect(clientTransport)
      const { structuredContent } = await client.callTool({ name: 'get_scene', arguments: {} })
      const nodes = Object.values((structuredContent as { nodes: Record<string, AnyNode> }).nodes)
      const level = nodes.find((node) => node.type === 'level')!
      const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
      const created = await client.callTool({
        name: 'apply_patch',
        arguments: { patches: [{ op: 'create', node: wall, parentId: level.id }] },
      })
      expect(created.isError).toBeFalsy()
      const after = await client.callTool({ name: 'get_scene', arguments: {} })
      expect(Object.keys((after.structuredContent as { nodes: object }).nodes)).toContain(wall.id)
    } finally {
      await client.close()
      await handle.close()
    }
  })

  test(`a server connected to the transport by hand fails a ${MODERN} client`, async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createServer()
    await server.connect(serverTransport)
    const client = new Client(
      { name: 'stdio-test-client', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: MODERN } } },
    )
    try {
      await expect(client.connect(clientTransport)).rejects.toMatchObject({
        code: SdkErrorCode.EraNegotiationFailed,
      })
    } finally {
      await client.close()
      await server.close()
    }
  })
})

describe('pascal-mcp --stdio', () => {
  const bin = fileURLToPath(new URL('../bin/pascal-mcp.ts', import.meta.url))
  let dataDir: string

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'pascal-mcp-stdio-'))
  })

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  for (const [who, options] of Object.entries(clients)) {
    test(`serves ${who}`, async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [bin, '--stdio'],
        env: { ...getDefaultEnvironment(), PASCAL_DATA_DIR: dataDir },
        stderr: 'ignore',
      })
      const client = new Client({ name: 'stdio-process-test-client', version: '0.0.0' }, options)
      try {
        await client.connect(transport)
        await expectServed(client, options)
      } finally {
        await client.close()
      }
    }, 30_000)
  }
})
