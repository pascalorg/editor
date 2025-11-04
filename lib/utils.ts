import { type ClassValue, clsx } from 'clsx'
import { customAlphabet } from 'nanoid'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)
export const createId = (prefix?: string) => `${prefix ? `${prefix}_` : ''}${nanoid()}`
