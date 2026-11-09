// Scene JSON omits undefined object properties, including nested material and intent fields.
export function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => omitUndefined(entry))
    return entries.some((entry, index) => entry !== value[index]) ? (entries as T) : value
  }
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value)
  const cleaned = entries
    .filter(([, entry]) => entry !== undefined)
    .map(([key, entry]) => [key, omitUndefined(entry)] as const)
  return cleaned.length !== entries.length ||
    cleaned.some(([, entry], index) => entry !== entries[index]![1])
    ? (Object.fromEntries(cleaned) as T)
    : value
}
