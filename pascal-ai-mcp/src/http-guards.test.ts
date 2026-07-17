import { describe, expect, test } from 'bun:test'
import { isValidImageDataUrl, readJsonBody } from './http-guards'

function chunkedRequest(payload: string, chunkSize = 8): Request {
  const bytes = new TextEncoder().encode(payload)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize))
      }
      controller.close()
    },
  })
  // No Content-Length header — mimics a chunked transfer.
  return new Request('http://localhost/chat', { method: 'POST', body: stream })
}

describe('readJsonBody', () => {
  test('parses a body within the limit', async () => {
    const result = await readJsonBody(chunkedRequest('{"sessionId":"s1"}'), 1024)
    expect(result).toEqual({ ok: true, body: { sessionId: 's1' } })
  })

  test('rejects an oversized Content-Length without reading the body', async () => {
    const request = new Request('http://localhost/chat', {
      method: 'POST',
      headers: { 'content-length': '2048' },
      body: '{}',
    })
    const result = await readJsonBody(request, 1024)
    expect(result).toEqual({ ok: false, status: 413, error: 'payload_too_large' })
  })

  // The regression from review: a chunked body carries no Content-Length, so
  // the byte counter is the only thing standing between us and an unbounded
  // read.
  test('rejects a chunked body that exceeds the limit mid-stream', async () => {
    const result = await readJsonBody(chunkedRequest(`{"m":"${'x'.repeat(4096)}"}`), 1024)
    expect(result).toEqual({ ok: false, status: 413, error: 'payload_too_large' })
  })

  test('rejects malformed JSON', async () => {
    const result = await readJsonBody(chunkedRequest('{bad'), 1024)
    expect(result).toEqual({ ok: false, status: 400, error: 'invalid_json' })
  })

  test('rejects a missing body', async () => {
    const result = await readJsonBody(new Request('http://localhost/chat', { method: 'POST' }), 1024)
    expect(result).toEqual({ ok: false, status: 400, error: 'invalid_json' })
  })
})

describe('isValidImageDataUrl', () => {
  const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
  const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64')

  test('accepts png and jpeg payloads with matching magic bytes', () => {
    expect(isValidImageDataUrl(`data:image/png;base64,${pngBase64}`)).toBe(true)
    expect(isValidImageDataUrl(`data:image/jpeg;base64,${jpegBase64}`)).toBe(true)
  })

  test('rejects an empty payload', () => {
    expect(isValidImageDataUrl('data:image/png;base64,')).toBe(false)
  })

  test('rejects non-base64 garbage', () => {
    expect(isValidImageDataUrl('data:image/png;base64,%%%')).toBe(false)
  })

  test('rejects a mime/magic mismatch', () => {
    expect(isValidImageDataUrl(`data:image/png;base64,${jpegBase64}`)).toBe(false)
    expect(isValidImageDataUrl(`data:image/jpeg;base64,${pngBase64}`)).toBe(false)
  })

  test('rejects unsupported mime types', () => {
    expect(isValidImageDataUrl(`data:image/gif;base64,${pngBase64}`)).toBe(false)
    expect(isValidImageDataUrl('data:text/html;base64,PGI+')).toBe(false)
  })
})
