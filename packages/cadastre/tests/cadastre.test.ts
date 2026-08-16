import { expect, test, describe, mock } from 'bun:test'
import { fetchParcel, fetchIller } from '../src/api'

function mockResponse(body: any, ok: boolean = true, status: number = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body)
  } as Response)
}

describe('fetchParcel', () => {
  test('Parses a successful polygon response (Ankara Çankaya 2705/15)', async () => {
    const fixture = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[32.85587, 39.90166], [32.85590, 39.90170], [32.85587, 39.90166]]] },
      properties: {
        ilAd: 'Ankara',
        ilId: 28,
        ilceAd: 'Çankaya',
        ilceId: 165,
        mahalleAd: 'Remzi Oğuz Arık',
        mahalleId: 1162,
        adaNo: '2705',
        parselNo: '15',
        alan: '1.295,00',
        nitelik: 'Apartman-Beton',
        pafta: 'I29b08d4c'
      }
    }
    
    const fetchMock = mock((url, opts) => mockResponse(fixture))
    
    const result = await fetchParcel(
      { kind: 'administrative', mahalleId: 1162, ada: '2705', parsel: '15' },
      { fetch: fetchMock as any }
    )
    
    expect(result).not.toBeNull()
    expect(result?.il).toBe('Ankara')
    expect(result?.ada).toBe('2705')
    expect(result?.parsel).toBe('15')
    // Area kept raw
    expect(result?.registeredAreaRaw).toBe('1.295,00')
    // Normalised ring (closed ring removed)
    expect(result?.ring.length).toBe(2)
  })

  test('Keeps raw area across different locale formats', async () => {
    const fixture = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
      properties: { alan: '1,295.00' }
    }
    const fetchMock = mock((url, opts) => mockResponse(fixture))
    const result = await fetchParcel({ kind: 'point', latitude: 0, longitude: 0 }, { fetch: fetchMock as any })
    expect(result?.registeredAreaRaw).toBe('1,295.00')
  })

  test('Returns null on 404', async () => {
    const fetchMock = mock((url, opts) => mockResponse({}, false, 404))
    const result = await fetchParcel({ kind: 'point', latitude: 0, longitude: 0 }, { fetch: fetchMock as any })
    expect(result).toBeNull()
  })

  test('Returns null when 200 but message contains "Bulunamadı"', async () => {
    const fixture = { Message: "Parsel Bulunamadı: Enlem = 0" }
    const fetchMock = mock((url, opts) => mockResponse(fixture))
    const result = await fetchParcel({ kind: 'point', latitude: 0, longitude: 0 }, { fetch: fetchMock as any })
    expect(result).toBeNull()
  })

  test('Throws on network error (e.g. 500)', async () => {
    const fetchMock = mock((url, opts) => mockResponse({}, false, 500))
    expect(fetchParcel({ kind: 'point', latitude: 0, longitude: 0 }, { fetch: fetchMock as any }))
      .rejects.toThrow('TKGM API error: HTTP 500')
  })

  test('Throws on invalid JSON', async () => {
    const fetchMock = mock((url, opts) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => { throw new SyntaxError('Unexpected token') }
    } as any))
    expect(fetchParcel({ kind: 'point', latitude: 0, longitude: 0 }, { fetch: fetchMock as any }))
      .rejects.toThrow('Unexpected token')
  })

  test('Supports AbortSignal', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = mock((url, opts) => {
      if (opts?.signal?.aborted) {
        return Promise.reject(new Error('AbortError'))
      }
      return mockResponse({})
    })
    
    expect(fetchParcel({ kind: 'point', latitude: 0, longitude: 0 }, { fetch: fetchMock as any, signal: controller.signal }))
      .rejects.toThrow('AbortError')
  })
})
