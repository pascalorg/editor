export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: 'invalid_json' | 'payload_too_large' }

// Reads and parses the body while enforcing the size cap ourselves. A
// Content-Length precheck alone is bypassable: chunked requests carry no
// Content-Length, and Bun 1.3's maxRequestBodySize does not stop a chunked
// stream either (verified during PR #1 review) — so the stream is counted
// byte-by-byte and cancelled the moment it exceeds the limit.
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const contentLength = Number(request.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, status: 413, error: 'payload_too_large' }
  }
  if (!request.body) return { ok: false, status: 400, error: 'invalid_json' }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false, status: 413, error: 'payload_too_large' }
    }
    chunks.push(value)
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' }
  }
}

// Mirrors the editor upload filter (png/jpeg only) and rejects malformed
// payloads: the base64 must be non-empty, well-formed, and decode to bytes
// carrying the matching magic number — a bare prefix or garbage payload never
// reaches the model provider.
export function isValidImageDataUrl(dataUrl: string): boolean {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) return false
  const mime = match[1]
  const payload = match[2] ?? ''
  if (payload.length % 4 !== 0) return false
  const bytes = Buffer.from(payload, 'base64')
  if (bytes.length < 4) return false
  return mime === 'png'
    ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}
