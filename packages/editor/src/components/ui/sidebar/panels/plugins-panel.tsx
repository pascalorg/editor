'use client'

import { Icon } from '@iconify/react'
import { type IconRef, useScene } from '@pascal-app/core'
import { ChevronLeft, ChevronRight, ExternalLink, Puzzle } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useState, useSyncExternalStore } from 'react'
import { editorHostPanelRegistry } from '../../../../lib/plugin-panels'
import { Button } from '../../primitives/button'

const PLUGIN_AUTHORING_URL =
  'https://editor.pascal.app/docs/developers/plugins'

function renderPluginIcon(ref: IconRef): ReactNode {
  if (ref.kind === 'url') {
    return <img alt="" className="h-8 w-8 object-contain" src={ref.src} />
  }
  if (ref.kind === 'iconify') {
    return <Icon height={28} icon={ref.name} width={28} />
  }
  if (ref.kind === 'svg') {
    return (
      <svg height={28} viewBox={ref.viewBox} width={28}>
        <path d={ref.path} fill="currentColor" />
      </svg>
    )
  }
  const LazyIcon = lazy(ref.module)
  return (
    <Suspense fallback={<Puzzle className="h-7 w-7" />}>
      <LazyIcon />
    </Suspense>
  )
}

export function PluginsPanel() {
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
  const panels = useSyncExternalStore(
    editorHostPanelRegistry.subscribe,
    editorHostPanelRegistry.getSnapshot,
    editorHostPanelRegistry.getSnapshot,
  )
  const installedPlugins = useScene((state) => state.installedPlugins)
  const setInstalledPlugins = useScene((state) => state.setInstalledPlugins)
  const readOnly = useScene((state) => state.readOnly)
  const plugins = Array.from(
    new Map(
      panels
        .filter((panel) => panel.pluginId)
        .map((panel) => [panel.pluginId as string, panel]),
    ).entries(),
  )
  const selectedPlugin = selectedPluginId
    ? plugins.find(([pluginId]) => pluginId === selectedPluginId)
    : undefined

  if (selectedPlugin) {
    const [pluginId, panel] = selectedPlugin
    const installed = installedPlugins.includes(pluginId)

    return (
      <div className="flex h-full flex-col overflow-y-auto p-4">
        <div>
          <Button
            className="rounded-full"
            onClick={() => setSelectedPluginId(null)}
            size="sm"
            variant="ghost"
          >
            <ChevronLeft className="h-4 w-4" />
            All plugins
          </Button>

          <div className="mt-5 flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-background/60">
              {renderPluginIcon(panel.icon)}
            </div>
            <div className="min-w-0 pt-1">
              <h2 className="font-semibold text-lg text-sidebar-foreground">{panel.label}</h2>
              <p className="text-sidebar-foreground/50 text-sm">
                {installed ? 'Installed' : 'Not installed'}
              </p>
            </div>
          </div>

          <p className="mt-5 text-sidebar-foreground/70 text-sm">
            {panel.description ?? 'Adds a new tool panel to the editor.'}
          </p>

          <dl className="mt-6 divide-y divide-border/50 rounded-xl border border-border/60">
            <div className="p-3">
              <dt className="text-sidebar-foreground/50 text-xs">Plugin ID</dt>
              <dd className="mt-1 break-all text-sidebar-foreground text-sm">{pluginId}</dd>
            </div>
            {panel.creator && (
              <div className="p-3">
                <dt className="text-sidebar-foreground/50 text-xs">Creator</dt>
                <dd className="mt-1 text-sm">
                  {panel.creator.url ? (
                    <a
                      className="inline-flex items-center gap-1 text-sidebar-foreground underline-offset-4 hover:underline"
                      href={panel.creator.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {panel.creator.name}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    panel.creator.name
                  )}
                </dd>
              </div>
            )}
            {panel.pluginUrl && (
              <div className="p-3">
                <dt className="text-sidebar-foreground/50 text-xs">Plugin</dt>
                <dd className="mt-1 text-sm">
                  <a
                    className="inline-flex items-center gap-1 text-sidebar-foreground underline-offset-4 hover:underline"
                    href={panel.pluginUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View plugin
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <Button
            className="mt-5 rounded-full"
            disabled={readOnly}
            onClick={() => {
              const next = installed
                ? installedPlugins.filter((id) => id !== pluginId)
                : [...installedPlugins, pluginId]
              setInstalledPlugins(next, { explicit: true })
            }}
            variant={installed ? 'outline' : 'default'}
          >
            {installed ? 'Uninstall' : 'Install'}
          </Button>
        </div>

        <div className="mt-auto pt-6">
          <a
            className="inline-flex items-center gap-1.5 text-sidebar-foreground/70 text-sm underline-offset-4 hover:text-sidebar-foreground hover:underline"
            href={PLUGIN_AUTHORING_URL}
            rel="noreferrer"
            target="_blank"
          >
            Create a Pascal plugin
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-5">
        <h2 className="font-semibold text-lg text-sidebar-foreground">Plugins</h2>
        <p className="mt-1 text-sidebar-foreground/60 text-sm">
          Add focused tools and content to this project.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {plugins.map(([pluginId, panel]) => {
          const installed = installedPlugins.includes(pluginId)
          return (
            <button
              className="w-full rounded-xl border border-border/60 bg-accent/20 p-3 text-left transition-colors hover:bg-accent/40"
              key={pluginId}
              onClick={() => setSelectedPluginId(pluginId)}
              type="button"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background/60">
                  {renderPluginIcon(panel.icon)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-sidebar-foreground">{panel.label}</h3>
                      <p className="text-sidebar-foreground/50 text-xs">
                        {installed ? 'Installed' : 'Not installed'}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
                  </div>
                  <p className="mt-2 text-sidebar-foreground/60 text-sm">
                    {panel.description ?? 'Adds a new tool panel to the editor.'}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-auto pt-6">
        <a
          className="inline-flex items-center gap-1.5 text-sidebar-foreground/70 text-sm underline-offset-4 hover:text-sidebar-foreground hover:underline"
          href={PLUGIN_AUTHORING_URL}
          rel="noreferrer"
          target="_blank"
        >
          Create a Pascal plugin
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}
