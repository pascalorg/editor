'use client'

import type { LazyPluginDescriptor } from '@pascal-app/core'
import { pluginManager } from '@pascal-app/core'
import { Blocks, ExternalLink, Info, Loader2, RotateCw } from 'lucide-react'
import Image from 'next/image'
import { useSyncExternalStore } from 'react'
import { usePluginManager } from '@/lib/plugins/use-plugin-manager'
import { cn } from '@/lib/utils'
import { PluginStatusBadge } from './PluginStatusBadge'

interface PluginCardProps {
  descriptor: LazyPluginDescriptor
}

export function PluginCard({ descriptor }: PluginCardProps) {
  const snapshot = useSyncExternalStore(
    pluginManager.subscribe,
    pluginManager.getSnapshot,
    pluginManager.getSnapshot,
  )

  const installPlugin = usePluginManager((s) => s.installPlugin)
  const uninstallPlugin = usePluginManager((s) => s.uninstallPlugin)
  const openDetail = usePluginManager((s) => s.openDetail)

  const pluginState = snapshot.states[descriptor.id] ?? {
    id: descriptor.id,
    status: 'unloaded',
    error: null,
  }

  const status = pluginState.status
  const isInstalled = status === 'installed'
  const isLoading = status === 'loading'
  const isError = status === 'error'

  const authorName =
    typeof descriptor.author === 'string' ? descriptor.author : descriptor.author?.name
  const authorUrl = typeof descriptor.author === 'object' ? descriptor.author?.url : undefined
  const isVerified =
    typeof descriptor.author === 'object' ? descriptor.author?.isVerified : false

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-border/60 bg-card/60 p-4.5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-border/90 hover:bg-card/90 hover:shadow-md">
      <div>
        {/* Üst Bilgi Bölümü */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-accent/40 p-2 shadow-inner">
              {typeof descriptor.icon === 'string' ? (
                descriptor.icon.startsWith('/') ? (
                  <Image
                    alt={descriptor.name}
                    className="h-full w-full object-contain"
                    height={32}
                    src={descriptor.icon}
                    width={32}
                  />
                ) : (
                  <img alt={descriptor.name} className="h-full w-full object-contain" src={descriptor.icon} />
                )
              ) : (
                <Blocks className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate font-semibold text-foreground text-sm">{descriptor.name}</h3>
                {isVerified && (
                  <span className="shrink-0 rounded bg-primary/20 px-1 py-0.2 font-medium text-[9px] text-primary">
                    Doğrulandı
                  </span>
                )}
              </div>
              <p className="truncate text-muted-foreground text-xs">
                {authorName && (
                  <span>
                    {authorUrl ? (
                      <a
                        className="inline-flex items-center gap-0.5 text-foreground/80 hover:underline"
                        href={authorUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {authorName}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      authorName
                    )}
                    {' · '}
                  </span>
                )}
                v{descriptor.version ?? '1.0.0'}
              </p>
            </div>
          </div>

          <PluginStatusBadge status={status} />
        </div>

        {/* Açıklama */}
        <p className="mt-3 line-clamp-2 text-foreground/75 text-xs leading-relaxed">
          {descriptor.description}
        </p>

        {/* Etiketler */}
        {descriptor.tags && descriptor.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {descriptor.tags.slice(0, 3).map((tag) => (
              <span
                className="rounded-md border border-border/30 bg-secondary/40 px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                key={tag}
              >
                #{tag}
              </span>
            ))}
            {descriptor.tags.length > 3 && (
              <span className="rounded-md bg-secondary/20 px-1 py-0.5 text-[10px] text-muted-foreground">
                +{descriptor.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Hata Bildirimi */}
        {isError && pluginState.error && (
          <div className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-2 text-rose-300 text-xs">
            {pluginState.error}
          </div>
        )}
      </div>

      {/* Alt Aksiyon Butonları */}
      <div className="mt-4 flex items-center justify-between gap-2 border-border/40 border-t pt-3">
        <button
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={() => openDetail(descriptor.id)}
          type="button"
        >
          <Info className="h-3.5 w-3.5" />
          Ayrıntılar
        </button>

        <div className="flex items-center gap-1.5">
          {isError ? (
            <button
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 font-medium text-rose-300 text-xs hover:bg-rose-500/25"
              disabled={isLoading}
              onClick={() => installPlugin(descriptor.id)}
              type="button"
            >
              <RotateCw className="h-3 w-3" />
              Tekrar Dene
            </button>
          ) : isInstalled ? (
            <button
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/60 bg-card px-2.5 font-medium text-muted-foreground text-xs transition-colors hover:border-destructive/40 hover:bg-destructive/15 hover:text-destructive"
              disabled={isLoading}
              onClick={() => uninstallPlugin(descriptor.id)}
              type="button"
            >
              Kaldır
            </button>
          ) : (
            <button
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary px-3 font-medium text-primary-foreground text-xs shadow-sm hover:bg-primary/90 disabled:opacity-50"
              disabled={isLoading}
              onClick={() => installPlugin(descriptor.id)}
              type="button"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Yükleniyor...
                </>
              ) : (
                'Yükle'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
