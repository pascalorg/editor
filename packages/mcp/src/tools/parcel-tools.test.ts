import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { useScene } from '@pascal-app/core'
import type { SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations/scene-operations'
import { createSceneOperations } from '../operations/scene-operations'
import { executeSearchParcel, registerParcelTools } from './parcel-tools'

/** A 40 m × 30 m rectangle near Ankara, in the shape `search_parcel` returns. */
const PARCEL = {
  ring: [
    { latitude: 39.9, longitude: 32.85 },
    { latitude: 39.9, longitude: 32.850467 },
    { latitude: 39.900269, longitude: 32.850467 },
    { latitude: 39.900269, longitude: 32.85 },
  ],
  il: 'Ankara',
  ilce: 'Çankaya',
  mahalle: 'Kızılay',
  mahalleId: 12345,
  ada: '2705',
  parsel: '15',
  registeredAreaRaw: '1.295,00',
  nitelik: 'Arsa',
  pafta: 'A12',
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ type: string; text: string }> }).content[0]!.text
}

function siteOf(operations: SceneOperations): SiteNode {
  return operations.getSiteNode() as SiteNode
}

/** A stub registry that answers with TKGM's own GeoJSON shape for `PARCEL`. */
function foundFetch(): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'Feature',
        geometry: { coordinates: [PARCEL.ring.map((p) => [p.longitude, p.latitude])] },
        properties: {
          ilAd: PARCEL.il,
          ilceAd: PARCEL.ilce,
          mahalleAd: PARCEL.mahalle,
          mahalleId: PARCEL.mahalleId,
          adaNo: PARCEL.ada,
          parselNo: PARCEL.parsel,
          alan: PARCEL.registeredAreaRaw,
          nitelik: PARCEL.nitelik,
          pafta: PARCEL.pafta,
        },
      }),
    }) as unknown as Response) as unknown as typeof fetch
}

describe('parcel tools', () => {
  let client: Client
  let bridge: SceneBridge
  let operations: SceneOperations

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    // `useScene` is a module singleton and zundo caps history at 50 entries, so
    // without this the depth assertion below saturates once enough sibling test
    // files have run and silently stops measuring anything.
    useScene.temporal.getState().clear()
    operations = createSceneOperations({ bridge })
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerParcelTools(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('registers all four tools on the server', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'apply_parcel_to_site',
      'get_buildable_area',
      'search_parcel',
      'set_setbacks',
    ])
  })

  test('apply_parcel_to_site writes the polygon, the location and the record', async () => {
    const before = siteOf(operations).polygon
    const result = await client.callTool({
      name: 'apply_parcel_to_site',
      arguments: { parcelData: PARCEL },
    })
    expect(result.isError).toBeFalsy()

    const site = siteOf(operations)
    expect(site.polygon).not.toEqual(before)
    expect(site.polygon?.points).toHaveLength(4)
    // The ring is centred on the parcel, so the corners sit either side of zero.
    const xs = site.polygon!.points.map(([x]) => x)
    expect(Math.min(...xs)).toBeLessThan(0)
    expect(Math.max(...xs)).toBeGreaterThan(0)
    // 40 m × 30 m, from the degree spans above.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 0)

    expect(site.latitude).toBeCloseTo(39.9001345, 4)
    expect(site.longitude).toBeCloseTo(32.8502335, 4)
    expect(site.parcel).toMatchObject({
      source: 'tkgm',
      edited: false,
      il: 'Ankara',
      ilce: 'Çankaya',
      mahalle: 'Kızılay',
      mahalleId: 12345,
      ada: '2705',
      parsel: '15',
      nitelik: 'Arsa',
      pafta: 'A12',
    })
  })

  // TKGM returns `alan` in two decimal conventions for the same parcel, and
  // `parseFloat('1.295,00')` is 1.295 — a 1000× understatement that would land
  // in the record and drive every TAKS reading off it.
  test('apply_parcel_to_site reads the registered area in either convention', async () => {
    await client.callTool({
      name: 'apply_parcel_to_site',
      arguments: { parcelData: PARCEL },
    })
    expect(siteOf(operations).parcel?.registeredArea).toBe(1295)

    await client.callTool({
      name: 'apply_parcel_to_site',
      arguments: { parcelData: { ...PARCEL, registeredAreaRaw: '1,295.00' } },
    })
    expect(siteOf(operations).parcel?.registeredArea).toBe(1295)
  })

  test('apply_parcel_to_site is one undo step', async () => {
    const before = siteOf(operations).polygon
    const depthBefore = useScene.temporal.getState().pastStates.length

    await client.callTool({
      name: 'apply_parcel_to_site',
      arguments: { parcelData: PARCEL },
    })
    expect(siteOf(operations).parcel).toBeDefined()
    // Zundo records per tracked `set`, so a tool that writes the polygon, the
    // location and the record separately would cost the user three undos.
    expect(useScene.temporal.getState().pastStates.length - depthBefore).toBe(1)

    expect(bridge.undo(1)).toBe(1)
    const reverted = siteOf(operations)
    expect(reverted.parcel).toBeUndefined()
    expect(reverted.polygon).toEqual(before)
  })

  test('apply_parcel_to_site rejects a parcel that is not a search_parcel result', async () => {
    const result = await client.callTool({
      name: 'apply_parcel_to_site',
      arguments: { parcelData: { ring: [{ latitude: 39.9, longitude: 32.85 }], il: 'Ankara' } },
    })
    expect(result.isError).toBe(true)
    expect(siteOf(operations).parcel).toBeUndefined()
  })

  test('set_setbacks merges per-edge rules over the default', async () => {
    await client.callTool({
      name: 'set_setbacks',
      arguments: {
        defaultSetback: 3,
        edges: [{ index: '0', role: 'road', distance: 5 }],
      },
    })

    const site = siteOf(operations)
    expect(site.defaultSetback).toBe(3)
    expect(site.setbacks['0']).toEqual({ role: 'road', distance: 5 })

    // A second call keeps the edge it does not name — the record is sparse,
    // not a snapshot of every edge.
    await client.callTool({
      name: 'set_setbacks',
      arguments: { edges: [{ index: '2', role: 'rear', distance: 2 }] },
    })
    const after = siteOf(operations)
    expect(after.setbacks['0']).toEqual({ role: 'road', distance: 5 })
    expect(after.setbacks['2']).toEqual({ role: 'rear', distance: 2 })
    expect(after.defaultSetback).toBe(3)
  })

  test('get_buildable_area reports the ring the setbacks leave', async () => {
    // The default site is a 30 m square, so a 5 m setback all round leaves 20 m.
    await client.callTool({
      name: 'set_setbacks',
      arguments: { defaultSetback: 5 },
    })
    const result = await client.callTool({ name: 'get_buildable_area', arguments: {} })
    const reading = JSON.parse(textOf(result))

    expect(reading.parcelArea).toBeCloseTo(900, 2)
    expect(reading.buildableArea).toBeCloseTo(400, 2)
    expect(reading.rings).toHaveLength(1)
  })

  test('get_buildable_area reports no ground left when the setbacks swallow the parcel', async () => {
    await client.callTool({ name: 'set_setbacks', arguments: { defaultSetback: 20 } })
    const reading = JSON.parse(
      textOf(await client.callTool({ name: 'get_buildable_area', arguments: {} })),
    )
    expect(reading.rings).toHaveLength(0)
    expect(reading.buildableArea).toBe(0)
  })

  // Read-only by design: the agent finds the parcel, tells the user, and only
  // then applies. One step that silently overwrote the site would be a surprise
  // even though it is undoable.
  test('search_parcel leaves the scene alone', async () => {
    const before = JSON.stringify(operations.exportSceneGraph())
    const result = await executeSearchParcel(
      { query: { kind: 'administrative', mahalleId: 12345, ada: '2705', parsel: '15' } },
      foundFetch(),
    )
    expect(result.isError).toBeUndefined()
    expect(JSON.stringify(operations.exportSceneGraph())).toBe(before)
  })
})

describe('search_parcel transport failures', () => {
  test('reports a parcel the registry does not have without throwing', async () => {
    const notFound = (async () =>
      ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch

    const result = await executeSearchParcel(
      { query: { kind: 'administrative', mahalleId: 1, ada: '1', parsel: '1' } },
      notFound,
    )
    expect(result.isError).toBe(true)
    expect(textOf(result).length).toBeGreaterThan(0)
  })

  // The registry is a third party the process cannot assume is up. A rejected
  // fetch has to come back as a tool error, not take the server down with it.
  test('reports an unreachable registry without taking the process down', async () => {
    const offline = (async () => {
      throw new Error('getaddrinfo ENOTFOUND cbsapi.tkgm.gov.tr')
    }) as unknown as typeof fetch

    const result = await executeSearchParcel(
      { query: { kind: 'point', latitude: 39.9, longitude: 32.85 } },
      offline,
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('ENOTFOUND')
  })

  test('returns the registry payload when the parcel is found', async () => {
    const result = await executeSearchParcel(
      { query: { kind: 'administrative', mahalleId: 12345, ada: '2705', parsel: '15' } },
      foundFetch(),
    )
    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(textOf(result))
    expect(parsed.ada).toBe('2705')
    expect(parsed.ring).toHaveLength(4)
  })
})
