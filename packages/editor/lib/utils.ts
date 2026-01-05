import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Re-export core utilities
export { canPlaceGridItemOnWall, createId, worldPositionToGrid } from '@pascal/core/utils'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
