import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The shadcn/ui `cn` helper: conditional classes, last-wins on conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
