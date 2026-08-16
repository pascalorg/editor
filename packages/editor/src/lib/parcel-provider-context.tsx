import { createContext, useContext } from 'react'
import type { ParcelProvider } from './parcel-provider'

export const ParcelProviderContext = createContext<ParcelProvider | null>(null)

export function useParcelProvider() {
  return useContext(ParcelProviderContext)
}
