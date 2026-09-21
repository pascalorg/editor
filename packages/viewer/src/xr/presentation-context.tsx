'use client'

import { createContext, type ReactNode, useContext } from 'react'

const ImmersiveXRPresentationContext = createContext(false)

export function ImmersiveXRPresentationProvider({
  children,
  enabled,
}: {
  children: ReactNode
  enabled: boolean
}) {
  return (
    <ImmersiveXRPresentationContext.Provider value={enabled}>
      {children}
    </ImmersiveXRPresentationContext.Provider>
  )
}

export function useImmersiveXRPresentation() {
  return useContext(ImmersiveXRPresentationContext)
}
