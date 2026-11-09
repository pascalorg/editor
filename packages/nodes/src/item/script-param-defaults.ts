import type { GeometryScriptParamSpec, GeometryScriptParamValue } from '@pascal-app/core'

/**
 * The value a param takes when the object is built without one: the script's
 * declared default, clamped to its range as the compile does, so a default
 * declared outside its own range still compares equal after a reset.
 */
export function scriptDefault(spec: GeometryScriptParamSpec): GeometryScriptParamValue {
  let value = spec.default
  if (typeof value !== 'number') return value
  if (spec.min !== undefined) value = Math.max(spec.min, value)
  if (spec.max !== undefined) value = Math.min(spec.max, value)
  return value
}

/** Whether `value` is what the script gives the param by default (a missing value is). */
export function isScriptDefault(
  spec: GeometryScriptParamSpec,
  value: GeometryScriptParamValue | undefined,
): boolean {
  if (value === undefined) return true
  const fallback = scriptDefault(spec)
  if (typeof value === 'number' && typeof fallback === 'number') {
    return Math.abs(value - fallback) < 1e-9
  }
  return value === fallback
}

/** The edit that puts every param changed from its script default back to it. */
export function scriptDefaultsPatch(
  specs: GeometryScriptParamSpec[],
  params: Record<string, GeometryScriptParamValue>,
): Record<string, GeometryScriptParamValue> {
  const patch: Record<string, GeometryScriptParamValue> = {}
  for (const spec of specs) {
    if (!isScriptDefault(spec, params[spec.id])) patch[spec.id] = scriptDefault(spec)
  }
  return patch
}
