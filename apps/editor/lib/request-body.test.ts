import { describe, expect, test } from 'bun:test'
import { readJsonBody, UnreadableBodyError } from './request-body'

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api', { method: 'POST', body, headers })
}

describe('readJsonBody', () => {
  test('reads a plain JSON body', async () => {
    const request = post(JSON.stringify({ a: 1 }), { 'Content-Type': 'application/json' })
    expect(await readJsonBody(request)).toEqual({ a: 1 })
  })

  test('gunzips a compressed body', async () => {
    const payload = { name: 'Scene', nodes: Array.from({ length: 200 }, (_, i) => ({ id: i })) }
    const request = post(await gzip(JSON.stringify(payload)), {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    })
    expect(await readJsonBody(request)).toEqual(payload)
  })

  test('treats an explicit identity encoding as plain', async () => {
    const request = post(JSON.stringify({ a: 1 }), { 'Content-Encoding': 'identity' })
    expect(await readJsonBody(request)).toEqual({ a: 1 })
  })

  // A body that claims gzip and is not one used to surface as an unhandled
  // throw out of `request.json()`; the caller needs a 400, not a 500.
  test('reports a body that lies about being gzipped', async () => {
    const request = post(JSON.stringify({ a: 1 }), { 'Content-Encoding': 'gzip' })
    expect(readJsonBody(request)).rejects.toThrow(UnreadableBodyError)
  })

  test('reports malformed JSON', async () => {
    expect(readJsonBody(post('{not json'))).rejects.toThrow(UnreadableBodyError)
  })

  test('refuses an encoding it cannot undo rather than guessing', async () => {
    const request = post(JSON.stringify({ a: 1 }), { 'Content-Encoding': 'br' })
    expect(readJsonBody(request)).rejects.toThrow(/unsupported content-encoding: br/)
  })
})
