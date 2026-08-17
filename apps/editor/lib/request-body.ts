/**
 * Reads a JSON request body, gunzipping it when the client compressed it.
 *
 * Next does not decompress request bodies — `Content-Encoding` on a *request*
 * is not something the platform handles for you, and `request.json()` on a
 * gzipped body throws on the first byte. Scene graphs compress about 10×, which
 * is what puts a large one back under the 64 KB cap the browser imposes on the
 * `keepalive` unload flush.
 *
 * `DecompressionStream` rather than `node:zlib` so the routes stay runtime-
 * agnostic; it is a web standard available in every runtime this app runs on.
 */

export class UnreadableBodyError extends Error {
  readonly code = 'invalid_request' as const
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const encoding = request.headers.get('content-encoding')?.trim().toLowerCase()

  if (!encoding || encoding === 'identity') {
    try {
      return await request.json()
    } catch {
      throw new UnreadableBodyError('body must be valid JSON')
    }
  }

  if (encoding !== 'gzip') {
    throw new UnreadableBodyError(`unsupported content-encoding: ${encoding}`)
  }

  if (!request.body) throw new UnreadableBodyError('body is required')

  try {
    const stream = request.body.pipeThrough(new DecompressionStream('gzip'))
    return JSON.parse(await new Response(stream).text())
  } catch {
    throw new UnreadableBodyError('body must be valid gzipped JSON')
  }
}
