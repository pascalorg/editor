import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DESIGN_EXAMPLE } from '@pascal-app/core/procedural-items'
import { CeilingNode, WallNode } from '@pascal-app/core/schema'
import airHandlerJson from '../../../core/src/procedural-items/__fixtures__/trial-e2-air-handler.json'
import louverJson from '../../../core/src/procedural-items/__fixtures__/trial-e5-louver.json'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

const vase = {
  ...DESIGN_EXAMPLE,
  name: 'Vase',
  parts: [
    {
      id: 'body',
      label: 'Body',
      count: 1,
      shapes: [
        {
          id: 'pot',
          primitive: 'cylinder',
          slot: 'wood',
          size: [0.1, 0.2, 0.1],
          position: [0, 0.1, 0],
        },
      ],
    },
  ],
}

async function connect() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], height: 2.7 })
  bridge.createNode(wall, level.id)
  const ceiling = CeilingNode.parse({
    polygon: [
      [-3, -3],
      [7, -3],
      [7, 7],
      [-3, 7],
    ],
  })
  bridge.createNode(ceiling, level.id)
  const server = createPascalMcpServer({ bridge })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'place-design-test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  await client.listTools()
  return { bridge, client, levelId: level.id, wallId: wall.id, ceilingId: ceiling.id }
}

const place = (client: Client, args: Record<string, unknown>) =>
  client.callTool({ name: 'place_design', arguments: args })

describe('place_design', () => {
  test('a design-surface placement is one undo step', async () => {
    const { bridge, client, levelId } = await connect()
    const table = await place(client, {
      design: DESIGN_EXAMPLE,
      hostId: levelId,
      position: [1, 0, 1],
    })
    const tableId = (table.structuredContent as { designId: string }).designId
    // Start from empty history: at zundo's cap, a new entry evicts the oldest one.
    bridge.clearHistory()
    const onTop = await place(client, {
      design: vase,
      hostId: tableId,
      surfaceId: 'top:0:board:top',
      position: [0.2, 0, 0],
    })
    const vaseId = (onTop.structuredContent as { designId: string }).designId
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo(1)
    expect(bridge.getNode(vaseId as never)).toBeNull()
    expect(bridge.getNode(tableId as never)).toMatchObject({ children: [], attachments: {} })
    await client.close()
  })

  test('creates trial designs on a wall, under a ceiling and on a design surface', async () => {
    const { bridge, client, levelId, wallId, ceilingId } = await connect()
    const louver = await place(client, {
      design: louverJson,
      hostId: wallId,
      position: [2, 1.5, 0],
    })
    const louverId = (louver.structuredContent as { designId: string }).designId
    expect(louver.structuredContent).toMatchObject({ parentId: wallId, surfaceId: null })
    expect(bridge.getNode(louverId as never)).toMatchObject({
      type: 'procedural-item',
      parentId: wallId,
      wallId,
      side: 'front',
    })
    expect((bridge.getNode(wallId as never) as { children: string[] }).children).toContain(louverId)

    const handler = await place(client, {
      design: JSON.stringify(airHandlerJson),
      hostId: ceilingId,
      position: [2, 0, 2],
    })
    expect(handler.structuredContent).toMatchObject({ parentId: ceilingId })

    const table = await place(client, {
      design: DESIGN_EXAMPLE,
      hostId: levelId,
      position: [1, 0, 1],
      parameters: { width: 0.9 },
    })
    const tableId = (table.structuredContent as { designId: string }).designId
    const onTop = await place(client, {
      design: vase,
      hostId: tableId,
      surfaceId: 'top:0:board:top',
      position: [0.2, 0, 0],
    })
    const vaseId = (onTop.structuredContent as { designId: string }).designId
    expect(onTop.structuredContent).toMatchObject({
      parentId: tableId,
      surfaceId: 'top:0:board:top',
    })
    expect(bridge.getNode(tableId as never)).toMatchObject({
      children: [vaseId],
      attachments: { [vaseId]: 'top:0:board:top' },
    })
    expect(bridge.validateScene().valid).toBe(true)
    await client.close()
  })

  test('refusals are coded tool errors and leave the scene unchanged', async () => {
    const { bridge, client, ceilingId, levelId, wallId } = await connect()
    const table = await place(client, {
      design: DESIGN_EXAMPLE,
      hostId: levelId,
      position: [1, 0, 1],
    })
    const tableId = (table.structuredContent as { designId: string }).designId
    const before = JSON.stringify(bridge.getNodes())
    for (const [args, code] of [
      [{ design: louverJson, hostId: ceilingId, position: [0, 0, 0] }, 'wrong_host'],
      [{ design: louverJson, hostId: wallId, position: [2, 2.5, 0] }, 'does_not_fit'],
      [{ design: '{"version":1}', hostId: wallId, position: [2, 1.5, 0] }, 'invalid_design'],
      // An explicit id that exists is refused by the shared apply_patch identity guard.
      [
        { design: DESIGN_EXAMPLE, hostId: levelId, position: [3, 0, 3], id: tableId },
        'node_exists',
      ],
    ] as const) {
      const result = await place(client, args as Record<string, unknown>)
      expect(result.isError).toBe(true)
      const refusal = JSON.parse((result.content as [{ text: string }])[0].text)
      expect(refusal.code).toBe(code)
      expect(refusal.message).toContain(`${code}: `)
    }
    expect(JSON.stringify(bridge.getNodes())).toBe(before)
    await client.close()
  })

  test('is advertised as additive', async () => {
    const { client } = await connect()
    const tool = (await client.listTools()).tools.find((t) => t.name === 'place_design')!
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    })
    expect(tool.inputSchema.required).toEqual(['design', 'hostId', 'position'])
    await client.close()
  })
})
