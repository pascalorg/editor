/** Structural equality for serialized scene values; object key order is irrelevant. */
export function areSemanticValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right)) || left.length !== right.length) return false
    return left.every((value, index) => areSemanticValuesEqual(value, right[index]))
  }

  if (typeof left !== 'object' || typeof right !== 'object') return false

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!(key in rightRecord) || !areSemanticValuesEqual(leftRecord[key], rightRecord[key])) {
      return false
    }
  }
  return true
}
