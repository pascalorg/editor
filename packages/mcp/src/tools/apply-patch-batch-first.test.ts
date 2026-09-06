import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { buildFromBriefPrompt } from '../prompts/from-brief'
import { AGENT_GUIDE } from '../resources/agent-guide'
import { registerApplyPatch } from './apply-patch'

describe('apply_patch batch-first guidance', () => {
  let client: Client

  beforeEach(async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerApplyPatch(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('tool description states batch-first as the default', async () => {
    const { tools } = await client.listTools()
    const applyPatch = tools.find((tool) => tool.name === 'apply_patch')
    expect(applyPatch).toBeDefined()
    const description = applyPatch!.description ?? ''
    expect(description.toLowerCase()).toContain('batch-first')
    expect(description.toLowerCase()).toContain('do not loop one-op')
    expect(description.toLowerCase()).toContain('validated before any are applied')
  })

  test('agent guide tells agents to batch apply_patch per phase', () => {
    expect(AGENT_GUIDE).toContain('batch-first is the default')
    expect(AGENT_GUIDE).toContain('do not loop one-op `apply_patch` calls')
  })

  test('from_brief preamble says one patch per phase', () => {
    const text = buildFromBriefPrompt({ brief: 'Studio loft' })
    expect(text).toContain('One patch per phase')
    expect(text).toContain('single `apply_patch` call')
    expect(text.toLowerCase()).toContain('instead of looping one-op')
  })

  test('MCP README apply_patch row documents batch-first default', () => {
    const readme = readFileSync(join(import.meta.dir, '../../README.md'), 'utf8')
    expect(readme).toContain('Batch-first is the default')
    expect(readme).toContain('do not loop one-op calls')
  })
})
