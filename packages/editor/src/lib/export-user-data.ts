/**
 * Copy `userData` for an export clone. `structuredClone` throws the moment it
 * meets a function, and live scenes keep runtime resources in userData (a
 * plugin's effect material, TSL uniforms, a mesh reference) whose dispose
 * listeners are functions — so a plain `structuredClone(userData)` aborts the
 * whole export. Exports only ever read plain data back out of userData, so
 * runtime resources and functions are dropped instead of cloned.
 */

type RuntimeResource = {
  isObject3D?: boolean
  isMaterial?: boolean
  isTexture?: boolean
  isBufferGeometry?: boolean
  isNode?: boolean
}

function isRuntimeResource(value: object): boolean {
  const flags = value as RuntimeResource
  return Boolean(
    flags.isObject3D ||
      flags.isMaterial ||
      flags.isTexture ||
      flags.isBufferGeometry ||
      flags.isNode,
  )
}

function cloneValue(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value === 'function') return undefined
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (isRuntimeResource(value)) return undefined
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const copy = structuredClone(value)
    seen.set(value, copy)
    return copy
  }
  if (value instanceof Date || value instanceof RegExp) return structuredClone(value)
  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const entry of value) copy.push(cloneValue(entry, seen))
    return copy
  }
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>()
    seen.set(value, copy)
    for (const [key, entry] of value) copy.set(cloneValue(key, seen), cloneValue(entry, seen))
    return copy
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>()
    seen.set(value, copy)
    for (const entry of value) copy.add(cloneValue(entry, seen))
    return copy
  }
  const copy: Record<string, unknown> = {}
  seen.set(value, copy)
  for (const [key, entry] of Object.entries(value)) {
    const cloned = cloneValue(entry, seen)
    if (cloned !== undefined) copy[key] = cloned
  }
  return copy
}

export function cloneExportUserData(userData: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(userData, new Map()) as Record<string, unknown>
}
