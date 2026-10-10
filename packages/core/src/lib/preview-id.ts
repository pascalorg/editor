const stableJson = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(stableJson).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
          .map(
            (key) =>
              `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
          )
          .join(',')}}`
      : JSON.stringify(value)

/**
 * What a preview showed, as a fingerprint the apply step asks for, so nothing is applied in a form
 * nobody looked at (FNV-1a, 32 bits, over the value with its keys sorted). Recomputed at apply: no
 * state is kept between the two calls.
 */
export function previewId(value: unknown): string {
  const text = stableJson(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `pv_${hash.toString(16).padStart(8, '0')}`
}
