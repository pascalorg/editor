import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { type AnyNodeId, DoorNode, WallNode, WindowNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'
import { doorPropertiesSchema, windowPropertiesSchema } from './opening-properties'

describe('opening design properties', () => {
  test('omitted choices stay absent so partial design changes do not restore native defaults', () => {
    expect(doorPropertiesSchema.parse({})).toEqual({})
    expect(windowPropertiesSchema.parse({})).toEqual({})
    expect(doorPropertiesSchema.parse({ doorType: 'french' })).toEqual({ doorType: 'french' })
    expect(windowPropertiesSchema.parse({ windowType: 'awning' })).toEqual({ windowType: 'awning' })
  })

  test.each([
    'id',
    'type',
    'parentId',
    'children',
    'metadata',
    'wallId',
    'roofSegmentId',
    'dormerId',
    'position',
    'rotation',
    'width',
    'height',
  ])('rejects %s in design properties', (key) => {
    expect(doorPropertiesSchema.safeParse({ [key]: 1 }).success).toBe(false)
    expect(windowPropertiesSchema.safeParse({ [key]: 1 }).success).toBe(false)
  })

  test('retains native enum and operation bounds rather than accepting arbitrary design strings', () => {
    expect(doorPropertiesSchema.safeParse({ doorType: 'magic' }).success).toBe(false)
    expect(windowPropertiesSchema.safeParse({ windowType: 'magic' }).success).toBe(false)
    expect(doorPropertiesSchema.safeParse({ operationState: 2 }).success).toBe(false)
    expect(windowPropertiesSchema.safeParse({ operationState: -1 }).success).toBe(false)
    expect(doorPropertiesSchema.safeParse({ garagePanelCount: 13 }).success).toBe(false)
  })

  test('parses arched French door and sliding garage choices through the native schema', () => {
    const properties = doorPropertiesSchema.parse({
      doorType: 'french',
      leafCount: 2,
      openingShape: 'arch',
      archHeight: 0.4,
      frameThickness: 0.04,
      segments: [{ type: 'glass', heightRatio: 1, columnRatios: [1, 1] }],
    })
    const door = DoorNode.parse({
      ...properties,
      wallId: 'wall_host',
      parentId: 'wall_host',
      position: [2, 1.1, 0],
      width: 1.6,
      height: 2.2,
    })
    expect(door).toMatchObject({
      ...properties,
      position: [2, 1.1, 0],
      width: 1.6,
      doorType: 'french',
    })
    expect(
      DoorNode.parse({
        ...doorPropertiesSchema.parse({ doorType: 'sliding', trackStyle: 'visible' }),
      }).doorType,
    ).toBe('sliding')
    expect(
      DoorNode.parse({
        ...doorPropertiesSchema.parse({
          doorCategory: 'garage',
          doorType: 'garage-sectional',
          garagePanelCount: 6,
        }),
      }).garagePanelCount,
    ).toBe(6)
  })

  test('parses awning and divided casement windows while preserving wall placement', () => {
    const properties = windowPropertiesSchema.parse({
      windowType: 'awning',
      awningDirection: 'down',
      openingShape: 'rounded',
      openingCornerRadii: [0.1, 0.2, 0.1, 0.2],
      frameDepth: 0.1,
      sill: false,
    })
    const window = WindowNode.parse({
      ...properties,
      wallId: 'wall_host',
      parentId: 'wall_host',
      position: [2, 1.7, 0],
      width: 1.2,
      height: 1.4,
    })
    expect(window).toMatchObject({ ...properties, wallId: 'wall_host', position: [2, 1.7, 0] })
    expect(
      WindowNode.parse(
        windowPropertiesSchema.parse({
          windowType: 'casement',
          casementStyle: 'french',
          columnRatios: [1, 1],
          rowRatios: [1, 2],
        }),
      ),
    ).toMatchObject({ windowType: 'casement', casementStyle: 'french', rowRatios: [1, 2] })
  })

  test('exposes ordinary array input schemas for bounded radii and padding, then checks native tuple arity', () => {
    for (const [schema, field, valid] of [
      [doorPropertiesSchema, 'openingTopRadii', [0.1, 0.2]],
      [doorPropertiesSchema, 'contentPadding', [0.05, 0.05]],
      [windowPropertiesSchema, 'openingCornerRadii', [0.1, 0.2, 0.3, 0.4]],
    ] as const) {
      const json = z.toJSONSchema(schema, { io: 'input' })
      expect(json.properties?.[field]).toMatchObject({
        type: 'array',
        minItems: valid.length,
        maxItems: valid.length,
        items: { type: 'number' },
      })
      expect(schema.safeParse({ [field]: valid }).success).toBe(true)
      expect(schema.safeParse({ [field]: [0.1] }).success).toBe(false)
    }
  })

  test('a listed MCP client creates an arched French door and an awning window with native design choices and trusted wall poses', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const doorWall = WallNode.parse({ start: [0, 0], end: [6, 0], height: 3.4 })
    const windowWall = WallNode.parse({ start: [0, 4], end: [6, 4], height: 3.4 })
    bridge.createNode(doorWall, level.id)
    bridge.createNode(windowWall, level.id)
    const server = createPascalMcpServer({ bridge })
    const client = new Client({ name: 'opening-design-integration', version: '0.0.0' })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const listed = await client.listTools()
      expect(
        listed.tools.find((tool) => tool.name === 'add_door')?.inputSchema.properties,
      ).toHaveProperty('properties')
      expect(
        listed.tools.find((tool) => tool.name === 'add_window')?.inputSchema.properties,
      ).toHaveProperty('properties')
      const doorResult = await client.callTool({
        name: 'add_door',
        arguments: {
          wallId: doorWall.id,
          t: 0.5,
          width: 1.6,
          height: 2.4,
          properties: {
            doorType: 'french',
            leafCount: 2,
            openingShape: 'arch',
            archHeight: 0.4,
            openingTopRadii: [0.12, 0.12],
            contentPadding: [0.03, 0.04],
            frameThickness: 0.045,
            segments: [
              { type: 'glass', heightRatio: 0.75, columnRatios: [1, 1] },
              { type: 'panel', heightRatio: 0.25 },
            ],
          },
        },
      })
      expect(doorResult.isError).toBeFalsy()
      const doorId = doorResult.structuredContent!.doorId as AnyNodeId
      const door = bridge.getNode(doorId)
      expect(DoorNode.safeParse(door).success).toBe(true)
      expect(door).toMatchObject({
        parentId: doorWall.id,
        wallId: doorWall.id,
        position: [3, 1.2, 0],
        width: 1.6,
        height: 2.4,
        doorType: 'french',
        leafCount: 2,
        openingShape: 'arch',
        archHeight: 0.4,
        contentPadding: [0.03, 0.04],
        frameThickness: 0.045,
        segments: [
          { type: 'glass', heightRatio: 0.75, columnRatios: [1, 1] },
          { type: 'panel', heightRatio: 0.25 },
        ],
      })
      expect(bridge.getChildren(doorWall.id).map((node) => node.id)).toContain(doorId)

      const windowResult = await client.callTool({
        name: 'add_window',
        arguments: {
          wallId: windowWall.id,
          t: 0.25,
          width: 1.2,
          height: 1.4,
          sillHeight: 0.8,
          properties: {
            windowType: 'awning',
            awningDirection: 'up',
            openingShape: 'rounded',
            openingCornerRadii: [0.1, 0.1, 0.05, 0.05],
            columnRatios: [1, 2],
            rowRatios: [1, 1],
            frameThickness: 0.04,
            operationState: 0.25,
          },
        },
      })
      expect(windowResult.isError).toBeFalsy()
      const windowId = windowResult.structuredContent!.windowId as AnyNodeId
      const window = bridge.getNode(windowId)
      expect(WindowNode.safeParse(window).success).toBe(true)
      expect(window).toMatchObject({
        parentId: windowWall.id,
        wallId: windowWall.id,
        position: [1.5, 1.5, 0],
        width: 1.2,
        height: 1.4,
        windowType: 'awning',
        openingShape: 'rounded',
        openingCornerRadii: [0.1, 0.1, 0.05, 0.05],
        columnRatios: [1, 2],
        rowRatios: [1, 1],
        frameThickness: 0.04,
        operationState: 0.25,
      })
      expect(bridge.getChildren(windowWall.id).map((node) => node.id)).toContain(windowId)
      expect(bridge.validateScene()).toEqual({ valid: true, errors: [] })

      const beforeInvalid = bridge.exportJSON()
      const invalid = await client.callTool({
        name: 'add_window',
        arguments: {
          wallId: windowWall.id,
          properties: { wallId: doorWall.id, position: [999, 999, 999] },
        },
      })
      expect(invalid.isError).toBe(true)
      expect(bridge.exportJSON()).toEqual(beforeInvalid)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
