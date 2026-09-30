import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type AnyNodeId, SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerValidateScene } from './validate-scene'

describe('validate_scene', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerValidateScene(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('default scene is valid', async () => {
    const result = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.valid).toBe(true)
    expect(Array.isArray(parsed.errors)).toBe(true)
    expect(parsed.warnings).toEqual([])
  })

  test('warns that a hidden site keeps the buildings on it visible', async () => {
    const site = SiteNode.parse({ visible: false })
    bridge.setScene({ [site.id]: site }, [site.id])
    const result = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.valid).toBe(true)
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.warnings[0]).toMatchObject({ nodeId: site.id, path: 'visible' })
    expect(parsed.warnings[0].message).toContain('stay visible')
  })

  test('reports structured errors', async () => {
    const result = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    for (const err of parsed.errors) {
      expect(typeof err.nodeId).toBe('string')
      expect(typeof err.path).toBe('string')
      expect(typeof err.message).toBe('string')
    }
  })

  test('reports a hierarchy cycle that node schemas cannot see individually', async () => {
    const siteA = SiteNode.parse({ id: 'site_a', parentId: 'site_b', children: ['site_b'] })
    const siteB = SiteNode.parse({ id: 'site_b', parentId: 'site_a', children: ['site_a'] })
    bridge.setScene({ [siteA.id]: siteA, [siteB.id]: siteB }, [] as AnyNodeId[])

    const result = await client.callTool({ name: 'validate_scene', arguments: {} })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.valid).toBe(false)
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: siteA.id,
          path: 'parentId',
          message: 'hierarchy cycle detected: site_a -> site_b -> site_a',
        }),
        expect.objectContaining({
          nodeId: siteB.id,
          path: 'parentId',
          message: 'hierarchy cycle detected: site_a -> site_b -> site_a',
        }),
      ]),
    )
  })

  test('returns structuredContent', async () => {
    const result = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    expect(result.structuredContent).toBeDefined()
    expect((result.structuredContent as { valid: boolean }).valid).toBe(true)
  })
})
