'use client'

import { Icon } from '@iconify/react'
import { type IconRef, panelRegistry, type PluginPanel } from '@pascal-app/core'
import { type ComponentType, lazy, type ReactNode, Suspense, useSyncExternalStore } from 'react'
import useEditor from '../../../store/use-editor'
import { ErrorBoundary } from '../primitives/error-boundary'
import type { ExtraPanel } from './icon-rail'

/** Resolve a plugin's {@link IconRef} into a rail-sized React node. Mirrors the
 * inspector's `renderIcon`, sized for the 24px icon-rail button. */
function renderIconRef(ref: IconRef): ReactNode {
  if (ref.kind === 'url') {
    return <img alt="" className="h-5 w-5 object-contain" src={ref.src} />
  }
  if (ref.kind === 'iconify') {
    return <Icon height={20} icon={ref.name} width={20} />
  }
  if (ref.kind === 'svg') {
    return (
      <svg height={20} viewBox={ref.viewBox} width={20}>
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

function PluginPanelCrashed({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2 p-4 text-sm">
      <p className="font-medium text-sidebar-foreground">"{label}" plugin crashed</p>
      <p className="text-sidebar-foreground/50 text-xs">
        This panel hit an error and was unloaded for this session. The rest of the editor is
        unaffected — reload to try again.
      </p>
    </div>
  )
}

// `React.lazy` must be called once per loader so the resolved component keeps a
// stable identity across renders (otherwise switching panels remounts the tree
// every time the sidebar re-renders). Cache the wrapped component by its loader.
const wrappedPanelCache = new WeakMap<PluginPanel['component'], ComponentType>()

function resolvePanelComponent(panel: PluginPanel): ComponentType {
  const cached = wrappedPanelCache.get(panel.component)
  if (cached) return cached
  const Lazy = lazy(panel.component)
  const Wrapped: ComponentType = () => (
    <ErrorBoundary fallback={<PluginPanelCrashed label={panel.label} />}>
      <Suspense fallback={<div className="p-4 text-sidebar-foreground/50 text-sm">Loading…</div>}>
        <Lazy />
      </Suspense>
    </ErrorBoundary>
  )
  Wrapped.displayName = `PluginPanel(${panel.id})`
  wrappedPanelCache.set(panel.component, Wrapped)
  return Wrapped
}

/**
 * Merge plugin-contributed panels (from the observable {@link panelRegistry})
 * with the host's `extraPanels`, returning the combined list the icon rail and
 * panel-content area render. Host panels keep their leading order and win on id
 * collisions. Subscribes to the registry so a panel that registers after the
 * first render (plugin discovery is async) makes the rail re-render.
 *
 * Panels are filtered by the current workspace: a panel surfaces only in the
 * workspaces it declares (`PluginPanel.workspaces`, default `['edit']`), so an
 * authoring panel like Nature doesn't ride into the studio rail.
 */
export function usePluginPanels(hostPanels?: ExtraPanel[]): ExtraPanel[] {
  const registered = useSyncExternalStore(
    panelRegistry.subscribe,
    panelRegistry.getSnapshot,
    panelRegistry.getSnapshot,
  )
  const workspaceMode = useEditor((s) => s.workspaceMode)
  const hostIds = new Set(hostPanels?.map((p) => p.id))
  const fromRegistry = registered
    .filter((p) => !hostIds.has(p.id) && (p.workspaces ?? ['edit']).includes(workspaceMode))
    .map(
      (p): ExtraPanel => ({
        id: p.id,
        label: p.label,
        icon: renderIconRef(p.icon),
        component: resolvePanelComponent(p),
      }),
    )
  return [...(hostPanels ?? []), ...fromRegistry]
}
