'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNodeId,
  getInspectorExtensions,
  type IconRef,
  useRegistryVersion,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { lazy, Suspense, useMemo } from 'react'
import { IconRefImage } from '../icon-ref'

/**
 * The plugin inspector extensions (`Plugin.inspectorExtensions`) for the single selected node,
 * gated on their plugin being installed, and the one that owns the card body for it
 * (`primaryWhen`). Read by the inspector card and by the action menu that opens them.
 */
export function useInspectorExtensions() {
  const registryVersion = useRegistryVersion()
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : undefined,
  ) as AnyNodeId | undefined
  // Subscribe to the selected node's *type* only — a string primitive that
  // doesn't change as fields are edited (same trick as ParametricInspector).
  const selectedType = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))
  const installedPlugins = useScene((s) => s.installedPlugins)
  const extensions = useMemo(() => {
    // re-derive when plugin extensions register after mount (async plugin load)
    void registryVersion
    if (!selectedType) return []
    return getInspectorExtensions(selectedType).filter(
      (extension) => !extension.pluginId || installedPlugins.includes(extension.pluginId),
    )
  }, [selectedType, installedPlugins, registryVersion])
  const primaryExtensionId = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId] : undefined
    return node ? extensions.find((extension) => extension.primaryWhen?.(node))?.id : undefined
  })
  const primaryExtension = extensions.find((extension) => extension.id === primaryExtensionId)
  return { selectedId, extensions, primaryExtension }
}

/** An extension's 16px icon — mirrors the parametric inspector's `renderIcon` (plain <img> so no next/image server deps). */
export function renderExtensionIcon(ref: IconRef): React.ReactNode {
  if (ref.kind === 'url') {
    return <IconRefImage className="h-4 w-4 shrink-0" src={ref.src} />
  }
  if (ref.kind === 'iconify') {
    return <Icon height={16} icon={ref.name} width={16} />
  }
  if (ref.kind === 'svg') {
    return (
      <svg height={16} viewBox={ref.viewBox} width={16}>
        <path d={ref.path} fill="currentColor" />
      </svg>
    )
  }
  const LazyIcon = lazy(ref.module)
  return (
    <Suspense fallback={null}>
      <LazyIcon />
    </Suspense>
  )
}
