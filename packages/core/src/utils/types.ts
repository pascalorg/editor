/**
 * Type guard to check if a value is a plain object (and not null or an array).
 * Useful for narrowing down Zod's generic JSON types.
 */
export const isObject = (val: unknown): val is Record<string, any> => {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}