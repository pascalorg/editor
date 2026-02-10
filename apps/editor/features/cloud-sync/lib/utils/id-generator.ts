import { customAlphabet } from 'nanoid'

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const nanoid = customAlphabet(alphabet, 16)

/**
 * Generate a unique ID with optional prefix (matches monorepo implementation)
 * @example createId('user') => 'user_Abc123...'
 */
export const createId = (prefix?: string) => {
  const id = nanoid()
  return prefix ? `${prefix}_${id}` : id
}
