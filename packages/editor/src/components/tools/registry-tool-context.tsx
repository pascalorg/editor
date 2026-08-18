'use client'

import type { AnyNodeId, LevelNode, SceneApi } from '@pascal-app/core'
import { createContext, type ReactNode, useContext } from 'react'

export type RegistryToolContextValue = {
  activeLevelId: LevelNode['id'] | null
  sceneApi: SceneApi
  selectNode: (nodeId: AnyNodeId) => void
}

const RegistryToolContext = createContext<RegistryToolContextValue | null>(null)

export function RegistryToolProvider({
  children,
  value,
}: {
  children: ReactNode
  value: RegistryToolContextValue
}) {
  return <RegistryToolContext.Provider value={value}>{children}</RegistryToolContext.Provider>
}

export function useRegistryToolContext(): RegistryToolContextValue {
  const value = useContext(RegistryToolContext)
  if (!value) throw new Error('Registry tools must be mounted by ToolManager')
  return value
}
