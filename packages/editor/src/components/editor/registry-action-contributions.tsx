'use client'

import { type AnyNodeId, nodeRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, lazy, Suspense } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getFloorplanNodeExtension } from '../../lib/floorplan/floorplan-extension'

type Loader = () => Promise<{ default: ComponentType }>
const lazyCache = new WeakMap<Loader, ComponentType>()

function contribution(kind: string): ComponentType | null {
  const loader = getFloorplanNodeExtension(nodeRegistry.get(kind))?.actionMenu?.actions
  if (!loader) return null
  const cached = lazyCache.get(loader)
  if (cached) return cached
  const component = lazy(loader)
  lazyCache.set(loader, component)
  return component
}

/**
 * The buttons kinds add to the action menu for selections holding them
 * (`extensions['pascal:editor/floorplan'].actionMenu.actions`), in 2D and 3D
 * alike. Each contribution reads the selection and decides its own visibility.
 */
export function RegistryActionContributions() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const kinds = useScene(
    useShallow((s) =>
      Array.from(
        new Set(
          selectedIds.flatMap((id) => {
            const type = s.nodes[id as AnyNodeId]?.type
            return type ? [type] : []
          }),
        ),
      ).sort(),
    ),
  )
  return (
    <>
      {kinds.map((kind) => {
        const Contribution = contribution(kind)
        return Contribution ? (
          <Suspense fallback={null} key={kind}>
            <Contribution />
          </Suspense>
        ) : null
      })}
    </>
  )
}
