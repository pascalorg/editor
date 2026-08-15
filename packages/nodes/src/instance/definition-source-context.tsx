'use client'

import { createContext, type ReactNode, useContext } from 'react'

const DefinitionSourceContext = createContext(false)

export function DefinitionSourceProvider({ children }: { children: ReactNode }) {
  return <DefinitionSourceContext.Provider value>{children}</DefinitionSourceContext.Provider>
}

export function useIsInsideDefinitionSource(): boolean {
  return useContext(DefinitionSourceContext)
}
