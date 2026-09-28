import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DESIGN_EXAMPLE, validateDesign } from '@pascal-app/core/procedural-items'
import airHandlerJson from '../../../core/src/procedural-items/__fixtures__/trial-e2-air-handler.json'
import louverJson from '../../../core/src/procedural-items/__fixtures__/trial-e5-louver.json'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

async function connect() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'validate-design-test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  // Listing first makes the client enforce each tool's output schema, as real hosts do.
  await client.listTools()
  return { bridge, client }
}

describe('validate_design', () => {
  test('returns the core validation for objects and JSON strings, leaving the scene alone', async () => {
    const { bridge, client } = await connect()
    const before = JSON.stringify(bridge.getNodes())
    for (const [design, parameters] of [
      [airHandlerJson, undefined],
      [JSON.stringify(louverJson), { slat_count: 9 }],
    ] as const) {
      const result = await client.callTool({
        name: 'validate_design',
        arguments: { design, ...(parameters ? { parameters } : {}) },
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual(
        JSON.parse(JSON.stringify(validateDesign(design, { parameters }))),
      )
      expect(result.structuredContent).toMatchObject({ valid: true, diagnostics: [] })
    }
    expect(JSON.stringify(bridge.getNodes())).toBe(before)
    await client.close()
  })

  test('reports invalid designs as coded diagnostics, not protocol errors', async () => {
    const { client } = await connect()
    const design = structuredClone(louverJson) as any
    design.parts[0].shapes[0].slot = 'paint'
    const result = await client.callTool({ name: 'validate_design', arguments: { design } })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({
      valid: false,
      diagnostics: [{ severity: 'error', code: 'rule', message: 'Unknown slot paint' }],
      measurements: null,
    })
    const broken = await client.callTool({
      name: 'validate_design',
      arguments: { design: '{"version":' },
    })
    expect(broken.structuredContent).toMatchObject({
      valid: false,
      diagnostics: [{ code: 'invalid_json' }],
    })
    await client.close()
  })

  test('is advertised as read-only', async () => {
    const { client } = await connect()
    const tool = (await client.listTools()).tools.find((t) => t.name === 'validate_design')!
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(tool.inputSchema.required).toEqual(['design'])
    await client.close()
  })
})

describe('pascal://schema/design', () => {
  test('serves the schema, rules and an example that validate_design accepts', async () => {
    const { client } = await connect()
    const listed = await client.listResources()
    expect(listed.resources.map((r) => r.uri)).toContain('pascal://schema/design')
    const read = await client.readResource({ uri: 'pascal://schema/design' })
    const content = read.contents[0] as { mimeType?: string; text?: string }
    expect(content.mimeType).toBe('application/json')
    const payload = JSON.parse(content.text ?? '{}')
    expect(Object.keys(payload.schema.$defs)).toEqual(['Expr'])
    expect(payload.rules.length).toBeGreaterThan(10)
    expect(payload.example).toEqual(DESIGN_EXAMPLE)
    const checked = await client.callTool({
      name: 'validate_design',
      arguments: { design: payload.example },
    })
    expect(checked.structuredContent).toMatchObject({ valid: true, diagnostics: [] })
    await client.close()
  })
})
