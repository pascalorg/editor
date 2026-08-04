import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode, WindowNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerDescribeNode } from './describe-node'

describe('describe_node', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerDescribeNode(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('describes a wall with human sentence', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')
    expect(level).toBeDefined()
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level!.id)

    const result = await client.callTool({
      name: 'describe_node',
      arguments: { id: wall.id },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.type).toBe('wall')
    expect(parsed.parentId).toBe(level!.id)
    expect(typeof parsed.description).toBe('string')
    expect(parsed.description).toContain('Wall from')
    expect(Array.isArray(parsed.ancestryIds)).toBe(true)
    expect(Array.isArray(parsed.childrenIds)).toBe(true)
    expect(typeof parsed.properties).toBe('object')
  })

  test('ancestry for wall includes level and building', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [3, 0] })
    bridge.createNode(wall, level.id)
    const result = await client.callTool({
      name: 'describe_node',
      arguments: { id: wall.id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.ancestryIds).toContain(level.id)
  })

  test('errors on unknown id', async () => {
    const result = await client.callTool({
      name: 'describe_node',
      arguments: { id: 'wall_nope' },
    })
    expect(result.isError).toBe(true)
  })

  type Coverage = {
    faces: Array<{
      role: string
      formed: boolean
      reason: string
      physicalAreaSqM: number
      measuredAreaSqM: number
      deductions: Array<{ reason: string; measuredSqM: number; physicalSqM: number }>
      neighbourId?: string
    }>
    openings: Array<{
      openingId: string
      kind: string
      areaSqM: number
      reason: string
      revealSides: number
      revealAreaSqM: number
      revealsMeasured: boolean
      extraOverBand?: string
    }>
    physicalAreaSqM: number
    measuredAreaSqM: number
    measurementStandard: string
    measurementStandardRef: string
  }

  async function coverageOf(id: string, measurementStandard?: string) {
    const result = await client.callTool({
      name: 'describe_node',
      arguments: measurementStandard ? { id, measurementStandard } : { id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    return parsed.formworkCoverage as Coverage | undefined
  }

  test('omits coverage for a wall with no formwork', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [3, 0] })
    bridge.createNode(wall, level.id)
    expect(await coverageOf(wall.id)).toBeUndefined()
  })

  test('freestanding wall reports all four faces formed, with reasons', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({
      start: [0, 0],
      end: [3, 0],
      height: 2.5,
      thickness: 0.2,
      formworkType: 'plywood',
    })
    bridge.createNode(wall, level.id)

    const coverage = await coverageOf(wall.id)
    const formed = coverage!.faces.filter((face) => face.formed).map((face) => face.role)
    expect(formed.sort()).toEqual(['end-end', 'end-start', 'side-a', 'side-b'])
    for (const face of coverage!.faces) {
      expect(typeof face.reason).toBe('string')
    }
  })

  test('wall between earlier-cast walls reports its ends as abutting hardened concrete', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const first = WallNode.parse({ start: [0, 0], end: [0, 3], castOrder: 1 })
    const second = WallNode.parse({ start: [3, 0], end: [3, 3], castOrder: 1 })
    const wall = WallNode.parse({
      start: [0, 0],
      end: [3, 0],
      formworkType: 'plywood',
      castOrder: 2,
    })
    bridge.createNode(first, level.id)
    bridge.createNode(second, level.id)
    bridge.createNode(wall, level.id)

    const coverage = await coverageOf(wall.id)
    const formed = coverage!.faces.filter((face) => face.formed).map((face) => face.role)
    expect(formed.sort()).toEqual(['side-a', 'side-b'])
    const startEnd = coverage!.faces.find((face) => face.role === 'end-start')!
    expect(startEnd.reason).toBe('ABUTS_HARDENED_CONCRETE')
    expect(startEnd.neighbourId).toBe(first.id)
  })

  test('reports both areas and names the standard they were measured under', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({
      start: [0, 0],
      end: [5, 0],
      height: 3,
      thickness: 0.2,
      formworkType: 'plywood',
    })
    bridge.createNode(wall, level.id)

    const coverage = await coverageOf(wall.id)
    // Blank freestanding wall: nothing to deduct, so the two agree.
    expect(coverage!.physicalAreaSqM).toBeCloseTo(31.2, 6)
    expect(coverage!.measuredAreaSqM).toBeCloseTo(31.2, 6)
    expect(coverage!.measurementStandard).toContain('HKSMM4')
    expect(coverage!.measurementStandardRef.length).toBeGreaterThan(0)
  })

  test('AI can price the same wall under a different contract standard', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({
      start: [0, 0],
      end: [5, 0],
      height: 3,
      thickness: 0.2,
      formworkType: 'plywood',
    })
    bridge.createNode(wall, level.id)
    const window = WindowNode.parse({
      wallId: wall.id,
      parentId: wall.id,
      position: [2.5, 1.5, 0],
      width: 1.2,
      height: 1.5,
    })
    bridge.createNode(window, wall.id)

    // HKSMM4 deducts the 1.8 m² void from both faces and measures the reveals:
    // net -2.52 m². NRM2 deducts nothing and deems the reveals included.
    const hksmm4 = await coverageOf(wall.id, 'HKSMM4')
    expect(hksmm4!.measuredAreaSqM).toBeCloseTo(31.2 - 2.52, 6)
    expect(hksmm4!.openings[0]!.reason).toBe('OPENING')
    expect(hksmm4!.openings[0]!.revealSides).toBe(4)

    const nrm2 = await coverageOf(wall.id, 'NRM2')
    expect(nrm2!.measuredAreaSqM).toBeCloseTo(31.2, 6)
    expect(nrm2!.openings[0]!.reason).toBe('OPENING_EXTRA_OVER')
    expect(nrm2!.openings[0]!.extraOverBand).toBe('≤ 5.00 m²')

    // The plywood you cut does not depend on the contract.
    expect(nrm2!.physicalAreaSqM).toBeCloseTo(hksmm4!.physicalAreaSqM, 6)
  })

  test('records why a small opening was not deducted, rather than omitting it', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({
      start: [0, 0],
      end: [5, 0],
      height: 3,
      thickness: 0.2,
      formworkType: 'plywood',
    })
    bridge.createNode(wall, level.id)
    const duct = WindowNode.parse({
      wallId: wall.id,
      parentId: wall.id,
      position: [2.5, 1.5, 0],
      width: 0.6,
      height: 0.6,
    })
    bridge.createNode(duct, wall.id)

    const coverage = await coverageOf(wall.id, 'HKSMM4')
    // Small openings INCREASE formwork: reveals added, nothing deducted.
    expect(coverage!.measuredAreaSqM).toBeCloseTo(31.2 + 0.48, 6)
    const sideA = coverage!.faces.find((face) => face.role === 'side-a')!
    expect(sideA.deductions).toHaveLength(1)
    expect(sideA.deductions[0]!.reason).toBe('OPENING_BELOW_THRESHOLD')
    expect(sideA.deductions[0]!.measuredSqM).toBe(0)
    expect(sideA.deductions[0]!.physicalSqM).toBeCloseTo(0.36, 6)
  })
})
