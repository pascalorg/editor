const IFC_GUID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'
const IFC_GUID_PATTERN = /^[0-3][0-9A-Za-z_$]{21}$/

export function isIfcGuid(value: unknown): value is string {
  return typeof value === 'string' && IFC_GUID_PATTERN.test(value)
}

// cyrb128: a fast synchronous 128-bit string hash. Web Crypto digests are
// async-only in browsers, and the GUID only needs to be stable and
// collision-resistant across one model, not cryptographically strong.
function hash128(input: string): Uint8Array {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  const bytes = new Uint8Array(16)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, h1 >>> 0)
  view.setUint32(4, h2 >>> 0)
  view.setUint32(8, h3 >>> 0)
  view.setUint32(12, h4 >>> 0)
  // Mark as an RFC 4122 name-based (v5-style) UUID so tools that validate
  // the underlying GUID accept it.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return bytes
}

function toBase64Digits(value: number, digits: number): string {
  let out = ''
  for (let i = 0; i < digits; i++) {
    out = IFC_GUID_ALPHABET[value % 64] + out
    value = Math.floor(value / 64)
  }
  return out
}

/** Compress 16 GUID bytes into IFC's 22-character base-64 form. */
export function compressGuidBytes(bytes: Uint8Array): string {
  let out = toBase64Digits(bytes[0]!, 2)
  for (let offset = 1; offset < 16; offset += 3) {
    out += toBase64Digits(
      (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!,
      4,
    )
  }
  return out
}

/** Deterministic IFC GlobalId for a seed (a Pascal node id plus an optional role suffix). */
export function ifcGuidFromSeed(seed: string): string {
  return compressGuidBytes(hash128(`pascal:${seed}`))
}

/**
 * Hands out GlobalIds, reusing an imported element's original GUID the first
 * time it is seen. Duplicated nodes copy metadata, so a second claim on the
 * same imported GUID falls back to the node-derived one to stay unique.
 */
export class GuidRegistry {
  private readonly used = new Set<string>()

  claim(seed: string, preferred?: unknown): string {
    if (isIfcGuid(preferred) && !this.used.has(preferred)) {
      this.used.add(preferred)
      return preferred
    }
    let guid = ifcGuidFromSeed(seed)
    for (let attempt = 1; this.used.has(guid); attempt++) {
      guid = ifcGuidFromSeed(`${seed}#${attempt}`)
    }
    this.used.add(guid)
    return guid
  }
}
