import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'

const FURNITURE_FIT_READ_TOOLS = [
  'check_collisions',
  'export_glb',
  'export_json',
  'find_nodes',
  'get_level_summary',
  'get_node',
  'get_scene',
  'get_walls',
  'get_zones',
  'list_levels',
  'list_scenes',
  'measure',
  'validate_scene',
  'verify_scene',
] as const

describe('read-only MCP tool annotations', () => {
  test('marks the furniture-fit inspection path safe for approval-aware clients', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const directory = mkdtempSync(join(tmpdir(), 'pascal-mcp-annotations-'))
    const store = new SqliteSceneStore({ databasePath: join(directory, 'pascal.db') })
    const server = createPascalMcpServer({ bridge, store })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'annotation-test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const listed = await client.listTools()
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool]))
      for (const name of FURNITURE_FIT_READ_TOOLS) {
        expect(byName.get(name)?.annotations).toEqual({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        })
      }
      expect(byName.get('get_project_status')?.annotations?.readOnlyHint).not.toBe(true)
    } finally {
      await client.close()
      await server.close()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
