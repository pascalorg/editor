'use client'

import type {
  AnyNodeId,
  Collection,
  CollectionId,
  CollectionZoneId,
  ItemNode,
  ZoneNode,
} from '@pascal-app/core'
import { normalizeCollection, pointInPolygon, resolveLevelId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  Check,
  Home,
  Link2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Unlink,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { HomeAssistantImportedResource } from '../../../lib/home-assistant-collections'
import {
  bindResourceToCollection,
  collectionHasHomeAssistantBinding,
  getCollectionBindingDisplayLabel,
  inferCollectionKindFromResource,
  resolveCollectionForSelectedItems,
} from '../../../lib/home-assistant-collections'
import { cn } from '../../../lib/utils'

type HomeAssistantConnectionResponse = {
  entityCount: number
  instanceUrl: string | null
  linked: boolean
  message: string
  success: boolean
}

function isItemNode(value: unknown): value is ItemNode {
  return Boolean(value && typeof value === 'object' && 'type' in value && value.type === 'item')
}

function isZoneNode(value: unknown): value is ZoneNode {
  return Boolean(value && typeof value === 'object' && 'type' in value && value.type === 'zone')
}

function getSelectedItems(nodes: Record<AnyNodeId, unknown>, selectedIds: string[]) {
  return selectedIds
    .map((selectedId) => nodes[selectedId as AnyNodeId])
    .filter((node): node is ItemNode => isItemNode(node))
}

function getCollectionNameFromItems(items: ItemNode[]) {
  if (items.length === 0) {
    return 'Home control'
  }

  if (items.length === 1) {
    return items[0]?.name?.trim() || items[0]?.asset.name?.trim() || 'Home control'
  }

  const firstName = items[0]?.name?.trim() || items[0]?.asset.name?.trim() || 'Control group'
  return `${firstName} group`
}

function getZoneIdsForItems(
  items: ItemNode[],
  zoneNodes: ZoneNode[],
  sceneNodes: Record<AnyNodeId, unknown>,
) {
  const zoneIds = new Set<CollectionZoneId>()

  for (const item of items) {
    for (const zone of zoneNodes) {
      if (resolveLevelId(zone, sceneNodes as Record<AnyNodeId, any>) !== resolveLevelId(item, sceneNodes as Record<AnyNodeId, any>)) {
        continue
      }

      if (zone.polygon.length < 3) {
        continue
      }

      if (pointInPolygon(item.position[0], item.position[2], zone.polygon)) {
        zoneIds.add(zone.id as CollectionZoneId)
      }
    }
  }

  return Array.from(zoneIds)
}

function getResourceBadgeColor(resource: HomeAssistantImportedResource) {
  switch (resource.kind) {
    case 'automation':
      return 'bg-pink-500/14 text-pink-100 border-pink-400/25'
    case 'scene':
      return 'bg-violet-500/14 text-violet-100 border-violet-400/25'
    case 'script':
      return 'bg-amber-500/14 text-amber-100 border-amber-400/25'
    case 'entity':
    default:
      return 'bg-cyan-500/14 text-cyan-100 border-cyan-400/25'
  }
}

export function HomeAssistantPanel() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)
  const collections = useScene((state) => state.collections)
  const createCollection = useScene((state) => state.createCollection)
  const updateCollection = useScene((state) => state.updateCollection)

  const [open, setOpen] = useState(false)
  const [connectionState, setConnectionState] = useState<HomeAssistantConnectionResponse | null>(null)
  const [imports, setImports] = useState<HomeAssistantImportedResource[]>([])
  const [instanceUrlInput, setInstanceUrlInput] = useState('http://localhost:8123')
  const [externalUrlInput, setExternalUrlInput] = useState('')
  const [isRefreshingConnection, setIsRefreshingConnection] = useState(false)
  const [isRefreshingImports, setIsRefreshingImports] = useState(false)
  const [isStartingOauth, setIsStartingOauth] = useState(false)
  const [panelError, setPanelError] = useState('')
  const [statusMessage, setStatusMessage] = useState(
    'Connect Home Assistant, import its controls, then bind them to Pascal collections.',
  )

  const selectedItems = useMemo(
    () => getSelectedItems(nodes as Record<AnyNodeId, unknown>, selectedIds),
    [nodes, selectedIds],
  )
  const zoneNodes = useMemo(
    () =>
      Object.values(nodes as Record<AnyNodeId, unknown>).filter(
        (node): node is ZoneNode => isZoneNode(node),
      ),
    [nodes],
  )

  const selectedCollection = useMemo(
    () =>
      resolveCollectionForSelectedItems({
        collections,
        selectedIds: selectedItems.map((item) => item.id),
      }),
    [collections, selectedItems],
  )

  async function refreshConnectionStatus(options?: { silent?: boolean }) {
    setIsRefreshingConnection(true)
    setPanelError('')

    try {
      const response = await fetch('/api/home-assistant/connection-status', { cache: 'no-store' })
      const payload = (await response.json()) as HomeAssistantConnectionResponse & { error?: string }

      setConnectionState(payload)
      if (payload.instanceUrl) {
        setInstanceUrlInput(payload.instanceUrl)
      }

      if (!response.ok) {
        throw new Error(payload.error || payload.message || 'Failed to connect to Home Assistant.')
      }

      if (!options?.silent) {
        setStatusMessage(payload.message)
      }
      return payload
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect to Home Assistant.'
      setPanelError(message)
      if (!options?.silent) {
        setStatusMessage(message)
      }
      return null
    } finally {
      setIsRefreshingConnection(false)
    }
  }

  async function refreshImports() {
    setIsRefreshingImports(true)
    setPanelError('')

    try {
      const response = await fetch('/api/home-assistant/import-resources', {
        cache: 'no-store',
      })
      const payload = (await response.json()) as {
        error?: string
        resources?: HomeAssistantImportedResource[]
      }

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to import Home Assistant resources.')
      }

      const resources = Array.isArray(payload.resources) ? payload.resources : []
      setImports(resources)
      setStatusMessage(
        resources.length > 0
          ? `Imported ${resources.length} Home Assistant resources.`
          : 'Home Assistant is connected, but no importable resources were found.',
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to import Home Assistant resources.'
      setPanelError(message)
      setStatusMessage(message)
    } finally {
      setIsRefreshingImports(false)
    }
  }

  async function handleStartOauth() {
    setIsStartingOauth(true)
    setPanelError('')

    try {
      const response = await fetch('/api/home-assistant/oauth/start', {
        body: JSON.stringify({
          externalUrl: externalUrlInput.trim() || undefined,
          instanceUrl: instanceUrlInput.trim() || undefined,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
      const payload = (await response.json()) as { authorizeUrl?: string; error?: string }

      if (!response.ok || !payload.authorizeUrl) {
        throw new Error(payload.error || 'Failed to start Home Assistant sign-in.')
      }

      window.location.assign(payload.authorizeUrl)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to start Home Assistant sign-in.'
      setPanelError(message)
      setStatusMessage(message)
      setIsStartingOauth(false)
    }
  }

  function ensureCollectionForSelection() {
    if (selectedCollection) {
      return selectedCollection
    }

    if (selectedItems.length === 0) {
      return null
    }

    const collectionId = createCollection(
      getCollectionNameFromItems(selectedItems),
      selectedItems.map((item) => item.id),
    )
    const zoneIds = getZoneIdsForItems(selectedItems, zoneNodes, nodes as Record<AnyNodeId, unknown>)
    const firstItem = selectedItems[0]

    updateCollection(collectionId, {
      controlNodeId: firstItem?.id,
      kind: selectedItems.length > 1 ? 'group' : 'device',
      presentation: {
        label: firstItem?.name?.trim() || firstItem?.asset.name?.trim() || 'Home control',
      },
      zoneIds,
    })

    return useScene.getState().collections[collectionId] ?? null
  }

  function handleBindResource(resource: HomeAssistantImportedResource) {
    const collection = ensureCollectionForSelection()
    if (!collection) {
      setStatusMessage('Select one or more virtual items to create or target a Pascal collection.')
      return
    }

    const zoneIds = getZoneIdsForItems(selectedItems, zoneNodes, nodes as Record<AnyNodeId, unknown>)
    const nextCollection = bindResourceToCollection({
      collection,
      resource,
      zoneIds,
    })

    updateCollection(collection.id, nextCollection)
    setStatusMessage(
      `Bound ${resource.label} to ${getCollectionBindingDisplayLabel(nextCollection)}.`,
    )
  }

  function handleUnbindResource(collection: Collection, resourceId: string) {
    const nextResources =
      collection.homeAssistant?.resources.filter((resource) => resource.id !== resourceId) ?? []

    updateCollection(collection.id, {
      capabilities: nextResources.flatMap((resource) => resource.capabilities),
      homeAssistant:
        nextResources.length > 0
          ? {
              aggregation:
                nextResources.length > 1
                  ? collection.homeAssistant?.aggregation ?? 'all'
                  : 'single',
              primaryResourceId:
                collection.homeAssistant?.primaryResourceId === resourceId
                  ? nextResources[0]?.id ?? null
                  : collection.homeAssistant?.primaryResourceId ?? nextResources[0]?.id ?? null,
              resources: nextResources,
            }
          : undefined,
      kind:
        nextResources.some((resource) => resource.kind !== 'entity')
          ? 'automation'
          : collection.nodeIds.length > 1
            ? 'group'
            : 'device',
    })

    setStatusMessage(`Removed the Home Assistant binding from ${collection.name}.`)
  }

  useEffect(() => {
    if (!open) {
      return
    }

    void refreshConnectionStatus({ silent: true }).then((payload) => {
      if (payload?.linked) {
        void refreshImports()
      }
    })
  }, [open])

  const activeCollection = selectedCollection
  const collectionLabel = activeCollection
    ? getCollectionBindingDisplayLabel(activeCollection)
    : selectedItems.length > 0
      ? getCollectionNameFromItems(selectedItems)
      : 'No collection selected'
  const boundResources = activeCollection?.homeAssistant?.resources ?? []

  return (
    <div className="relative" data-testid="home-assistant-panel">
      <button
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-2xl border transition',
          open
            ? 'border-cyan-400/45 bg-cyan-500/14 text-cyan-100'
            : 'border-white/10 bg-zinc-950/88 text-zinc-200 hover:border-white/20 hover:bg-zinc-950 hover:text-white',
        )}
        onClick={() => setOpen((currentValue) => !currentValue)}
        type="button"
      >
        <Home className="h-5 w-5" />
      </button>

      {open && (
        <section className="pointer-events-auto absolute top-0 right-[calc(100%+0.75rem)] z-40 flex max-h-[calc(100vh-2rem)] w-[min(92vw,27rem)] flex-col overflow-hidden rounded-3xl border border-cyan-400/25 bg-zinc-950/94 p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Home Assistant
              </p>
              <h2 className="mt-1 font-semibold text-base text-white">
                Connect, Import, Bind
              </h2>
            </div>
            <button
              className="rounded-full border border-white/10 px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-zinc-300 transition hover:border-white/20 hover:text-white"
              onClick={() => setOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/22 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Connection</p>
                  <p className="mt-1 text-sm text-white">
                    {connectionState?.linked ? connectionState.message : 'Not linked yet'}
                  </p>
                </div>
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-200 transition hover:border-white/20 hover:bg-white/8 hover:text-white"
                  onClick={() => void refreshConnectionStatus()}
                  type="button"
                >
                  {isRefreshingConnection ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </button>
              </div>

              {!connectionState?.linked && (
                <div className="mt-3 grid gap-2">
                  <input
                    className="rounded-2xl border border-white/10 bg-black/28 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40"
                    onChange={(event) => setInstanceUrlInput(event.target.value)}
                    placeholder="http://localhost:8123"
                    value={instanceUrlInput}
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-black/28 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40"
                    onChange={(event) => setExternalUrlInput(event.target.value)}
                    placeholder="https://your-ha.example.com (optional)"
                    value={externalUrlInput}
                  />
                  <button
                    className="flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/35 bg-cyan-500/12 px-3 py-2 text-sm font-medium text-cyan-50 transition hover:border-cyan-300/45 hover:bg-cyan-500/18"
                    disabled={isStartingOauth}
                    onClick={() => void handleStartOauth()}
                    type="button"
                  >
                    {isStartingOauth ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                    Connect Home Assistant
                  </button>
                </div>
              )}

              {connectionState?.linked && (
                <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                  <Check className="h-3.5 w-3.5 text-cyan-200" />
                  {connectionState.entityCount} entities visible from HA
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/22 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Pascal Target</p>
                  <p className="mt-1 text-sm text-white">{collectionLabel}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-zinc-300">
                  {activeCollection
                    ? activeCollection.kind ?? 'device'
                    : selectedItems.length > 0
                      ? 'pending'
                      : 'none'}
                </span>
              </div>

              <p className="mt-2 text-xs leading-5 text-zinc-400">
                {selectedItems.length > 0
                  ? activeCollection
                    ? 'Selected items already resolve to a Pascal collection. Imports bind to that collection.'
                    : 'Select imports below to create a Pascal collection from the current item selection.'
                  : 'Select one or more virtual items in Pascal to create or target a collection.'}
              </p>

              {boundResources.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {boundResources.map((resource) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                      key={resource.id}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white">{resource.label}</p>
                        <p className="truncate text-xs text-zinc-400">
                          {resource.kind}
                          {resource.entityId ? ` | ${resource.entityId}` : ''}
                        </p>
                      </div>
                      <button
                        className="flex h-9 w-9 items-center justify-center rounded-2xl border border-rose-500/35 bg-rose-500/10 text-rose-100 transition hover:border-rose-400/45 hover:bg-rose-500/18"
                        onClick={() => activeCollection && handleUnbindResource(activeCollection, resource.id)}
                        type="button"
                      >
                        <Unlink className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 rounded-2xl border border-white/10 bg-black/22 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Imported Resources</p>
                  <p className="mt-1 text-sm text-white">
                    {imports.length > 0 ? `${imports.length} imported` : 'No imports yet'}
                  </p>
                </div>
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-200 transition hover:border-white/20 hover:bg-white/8 hover:text-white disabled:opacity-45"
                  disabled={!connectionState?.linked || isRefreshingImports}
                  onClick={() => void refreshImports()}
                  type="button"
                >
                  {isRefreshingImports ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </button>
              </div>

              <div className="mt-3 max-h-[18rem] overflow-y-auto pr-1">
                <div className="grid gap-2">
                  {imports.map((resource) => {
                    const isBound = Boolean(
                      activeCollection?.homeAssistant?.resources.some((entry) => entry.id === resource.id),
                    )

                    return (
                      <button
                        className={cn(
                          'flex w-full items-start justify-between rounded-2xl border px-3 py-3 text-left transition',
                          isBound
                            ? 'border-cyan-400/45 bg-cyan-500/12'
                            : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8',
                        )}
                        key={resource.id}
                        onClick={() => handleBindResource(resource)}
                        type="button"
                      >
                        <div className="min-w-0 pr-3">
                          <p className="truncate text-sm font-medium text-white">{resource.label}</p>
                          <p className="mt-1 truncate text-xs text-zinc-400">{resource.description}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span
                            className={cn(
                              'rounded-full border px-2 py-1 text-[0.68rem] uppercase tracking-[0.18em]',
                              getResourceBadgeColor(resource),
                            )}
                          >
                            {resource.kind}
                          </span>
                          {isBound ? (
                            <Check className="h-4 w-4 text-cyan-200" />
                          ) : (
                            <Link2 className="h-4 w-4 text-zinc-400" />
                          )}
                        </div>
                      </button>
                    )
                  })}

                  {connectionState?.linked && imports.length === 0 && !isRefreshingImports && (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-zinc-400">
                      Import Home Assistant resources to bind them to Pascal collections.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/22 px-3 py-3 text-sm text-zinc-200">
              {statusMessage}
            </div>

            {panelError && (
              <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                {panelError}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
