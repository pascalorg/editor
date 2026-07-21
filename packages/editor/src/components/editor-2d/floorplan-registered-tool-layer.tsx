'use client'

import { nodeRegistry } from '@pascal-app/core'
import { type ComponentType, lazy, Suspense } from 'react'
import { getFloorplanNodeExtension } from '../../lib/floorplan/floorplan-extension'
import useEditor from '../../store/use-editor'

const lazyToolCache = new WeakMap<() => Promise<unknown>, ComponentType>()

function registeredFloorplanTool(tool: string | null): ComponentType | null {
  if (!tool) return null
  const loader = getFloorplanNodeExtension(nodeRegistry.get(tool))?.tool
  if (!loader) return null
  const cached = lazyToolCache.get(loader)
  if (cached) return cached
  const component = lazy(() => loader() as Promise<{ default: ComponentType }>)
  lazyToolCache.set(loader, component)
  return component
}

export function FloorplanRegisteredToolLayer() {
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  if (mode !== 'build') return null
  const Tool = registeredFloorplanTool(tool)
  return Tool ? (
    <Suspense fallback={null}>
      <Tool />
    </Suspense>
  ) : null
}
