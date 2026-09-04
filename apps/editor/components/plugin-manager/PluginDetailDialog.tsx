'use client'

import type { LazyPluginDescriptor } from '@pascal-app/core'
import { pluginManager } from '@pascal-app/core'
import {
  Blocks,
  Check,
  Code2,
  ExternalLink,
  Info,
  RotateCw,
  Sparkles,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useSyncExternalStore } from 'react'
import { usePluginManager } from '@/lib/plugins/use-plugin-manager'
import { cn } from '@/lib/utils'
import { PluginStatusBadge } from './PluginStatusBadge'

interface PluginDetailDialogProps {
  descriptor: LazyPluginDescriptor
  onClose: () => void
}

export function PluginDetailDialog({ descriptor, onClose }: PluginDetailDialogProps) {
  const snapshot = useSyncExternalStore(
    pluginManager.subscribe,
    pluginManager.getSnapshot,
    pluginManager.getSnapshot,
  )

  const installPlugin = usePluginManager((s) => s.installPlugin)
  const uninstallPlugin = usePluginManager((s) => s.uninstallPlugin)

  const state = snapshot.states[descriptor.id] ?? {
    id: descriptor.id,
    status: 'unloaded',
    error: null,
  }

  const status = state.status
  const isInstalled = status === 'installed'
  const isLoading = status === 'loading'
  const isError = status === 'error'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const authorName =
    typeof descriptor.author === 'string' ? descriptor.author : descriptor.author?.name
  const authorUrl = typeof descriptor.author === 'object' ? descriptor.author?.url : undefined
  const isVerified =
    typeof descriptor.author === 'object' ? descriptor.author?.isVerified : false

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border/60 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-border/50 border-b bg-accent/20 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/40 bg-card/80 p-2 shadow-inner">
              {typeof descriptor.icon === 'string' ? (
                descriptor.icon.startsWith('/') ? (
                  <Image
                    alt={descriptor.name}
                    className="h-full w-full object-contain"
                    height={36}
                    src={descriptor.icon}
                    width={36}
                  />
                ) : (
                  <img alt={descriptor.name} className="h-full w-full object-contain" src={descriptor.icon} />
                )
              ) : (
                <Blocks className="h-6 w-6 text-primary" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-foreground text-lg">{descriptor.name}</h2>
                {isVerified && (
                  <span className="rounded bg-primary/20 px-1.5 py-0.5 font-medium text-[10px] text-primary">
                    Doğrulanmış
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                v{descriptor.version ?? '1.0.0'} · {descriptor.category ?? 'Genel'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <PluginStatusBadge status={status} />
            <button
              aria-label="Kapat"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Açıklama */}
          <div>
            <h3 className="font-semibold text-foreground text-xs uppercase tracking-wider text-muted-foreground">
              Açıklama
            </h3>
            <p className="mt-2 text-foreground/85 text-sm leading-relaxed">
              {descriptor.detailedDescription ?? descriptor.description}
            </p>
          </div>

          {/* Özellikler (Features) */}
          {descriptor.features && descriptor.features.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground text-xs uppercase tracking-wider text-muted-foreground">
                Temel Yetenekler & Özellikler
              </h3>
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {descriptor.features.map((feat) => (
                  <div
                    className="flex items-center gap-2 rounded-xl border border-border/40 bg-accent/20 px-3 py-2 text-xs text-foreground/90"
                    key={feat}
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>{feat}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Düğüm Tipleri (Node Kinds) */}
          {descriptor.nodeKinds && descriptor.nodeKinds.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground text-xs uppercase tracking-wider text-muted-foreground">
                3D Düğüm & Nesne Tanımları
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {descriptor.nodeKinds.map((kind) => (
                  <span
                    className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-card px-2.5 py-1 font-mono text-foreground/80 text-xs"
                    key={kind}
                  >
                    <Code2 className="h-3 w-3 text-muted-foreground" />
                    {kind}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Meta Bilgiler Tablosu */}
          <div className="rounded-2xl border border-border/50 bg-card/40 p-4 text-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Eklenti Kimliği (ID):</span>
              <span className="font-mono text-foreground">{descriptor.id}</span>
            </div>
            {authorName && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Geliştirici / Yazar:</span>
                <span className="font-medium text-foreground">
                  {authorUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                      href={authorUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {authorName}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    authorName
                  )}
                </span>
              </div>
            )}
            {descriptor.pluginUrl && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Kaynak / Depo:</span>
                <a
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  href={descriptor.pluginUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  GitHub / Dokümantasyon
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          {/* Etiketler (Tags) */}
          {descriptor.tags && descriptor.tags.length > 0 && (
            <div>
              <div className="flex flex-wrap gap-1.5">
                {descriptor.tags.map((tag) => (
                  <span
                    className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-secondary/40 px-2 py-0.5 text-secondary-foreground text-xs"
                    key={tag}
                  >
                    <Tag className="h-2.5 w-2.5 text-muted-foreground" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Hata uyarısı */}
          {isError && state.error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-300 text-xs">
              <p className="font-medium">Yükleme Hatası:</p>
              <p className="mt-0.5">{state.error}</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-border/50 border-t bg-accent/10 px-6 py-4">
          <button
            className="rounded-xl border border-border px-4 py-2 font-medium text-foreground text-xs hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            Kapat
          </button>

          <div className="flex items-center gap-2">
            {isError ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/20 px-4 py-2 font-medium text-rose-300 text-xs shadow-sm transition-colors hover:bg-rose-500/30"
                disabled={isLoading}
                onClick={() => installPlugin(descriptor.id)}
                type="button"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Yeniden Dene
              </button>
            ) : isInstalled ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-card px-4 py-2 font-medium text-muted-foreground text-xs transition-colors hover:border-destructive/40 hover:bg-destructive/15 hover:text-destructive"
                disabled={isLoading}
                onClick={() => uninstallPlugin(descriptor.id)}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eklentiyi Kaldır
              </button>
            ) : (
              <button
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 font-medium text-primary-foreground text-xs shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
                disabled={isLoading}
                onClick={() => installPlugin(descriptor.id)}
                type="button"
              >
                {isLoading ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    Yükleniyor...
                  </>
                ) : (
                  'Eklentiyi Yükle & Etkinleştir'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
