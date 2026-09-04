'use client'

import { pluginManager } from '@pascal-app/core'
import { Blocks, CheckCircle2, Filter, PackageOpen, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { PLUGIN_CATALOG, getPluginDescriptor } from '@/lib/plugins/catalog'
import { type PluginCategory, usePluginManager } from '@/lib/plugins/use-plugin-manager'
import { cn } from '@/lib/utils'
import { PluginCard } from './PluginCard'
import { PluginDetailDialog } from './PluginDetailDialog'
import { PluginErrorBoundary } from './PluginErrorBoundary'

const CATEGORIES: { id: PluginCategory; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'environment', label: 'Doğa & Çevre' },
  { id: 'engineering', label: 'BIM & Mühendislik' },
  { id: 'assets', label: '3D Varlıklar & AI' },
  { id: 'logistics', label: 'Lojistik & Depo' },
  { id: 'simulation', label: 'Oyun & Simülasyon' },
  { id: 'infrastructure', label: 'Kentsel Altyapı' },
]

export function PluginManagerModal() {
  const isOpen = usePluginManager((s) => s.isModalOpen)
  const setOpen = usePluginManager((s) => s.setModalOpen)
  const searchQuery = usePluginManager((s) => s.searchQuery)
  const setSearchQuery = usePluginManager((s) => s.setSearchQuery)
  const selectedCategory = usePluginManager((s) => s.selectedCategory)
  const setSelectedCategory = usePluginManager((s) => s.setSelectedCategory)
  const activeDetailPluginId = usePluginManager((s) => s.activeDetailPluginId)
  const closeDetail = usePluginManager((s) => s.closeDetail)

  const [onlyInstalledFilter, setOnlyInstalledFilter] = useState(false)

  const snapshot = useSyncExternalStore(
    pluginManager.subscribe,
    pluginManager.getSnapshot,
    pluginManager.getSnapshot,
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen && !activeDetailPluginId) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, activeDetailPluginId, setOpen])

  // Toplam ve kurulu eklenti sayıları
  const totalCount = PLUGIN_CATALOG.length
  const installedCount = useMemo(() => {
    return Object.values(snapshot.states).filter((p) => p.status === 'installed').length
  }, [snapshot.states])

  // Arama ve filtreleme mantığı
  const filteredPlugins = useMemo(() => {
    return PLUGIN_CATALOG.filter((plugin) => {
      // Kurulu filtreleme
      if (onlyInstalledFilter) {
        const state = snapshot.states[plugin.id]
        if (state?.status !== 'installed') return false
      }

      // Kategori filtreleme
      const matchesCategory =
        selectedCategory === 'all' || plugin.category === selectedCategory

      const query = searchQuery.trim().toLowerCase()
      if (!query) return matchesCategory

      const authorName =
        typeof plugin.author === 'string' ? plugin.author : plugin.author?.name ?? ''

      const matchesText =
        plugin.name.toLowerCase().includes(query) ||
        (plugin.description?.toLowerCase().includes(query) ?? false) ||
        authorName.toLowerCase().includes(query) ||
        (plugin.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false)

      return matchesCategory && matchesText
    })
  }, [searchQuery, selectedCategory, onlyInstalledFilter, snapshot.states])

  const activeDetailDescriptor = activeDetailPluginId
    ? getPluginDescriptor(activeDetailPluginId)
    : undefined

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
        onClick={() => setOpen(false)}
      >
        <div
          aria-modal="true"
          className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border/70 bg-background/95 shadow-2xl backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
        >
          {/* Header Bölümü */}
          <div className="border-border/50 border-b bg-accent/15 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
                  <Blocks className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="font-bold text-foreground text-lg sm:text-xl">
                    Eklenti Yöneticisi (Plugin Manager)
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    PascalOrg ekosistemi resmi eklentilerini keşfedin, kurun ve yönetin.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                {/* İstatistik Rozeti */}
                <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-card px-3 py-1.5 font-medium text-xs shadow-sm">
                  <span className="text-muted-foreground">Aktif:</span>
                  <span className="font-semibold text-emerald-400">{installedCount}</span>
                  <span className="text-muted-foreground">/ {totalCount}</span>
                </div>

                <button
                  aria-label="Kapat"
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Arama & Sekme Çubuğu */}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-xl border border-border/60 bg-card py-2 pr-9 pl-10 text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Eklenti adı, yazar veya etiket ara..."
                  type="text"
                  value={searchQuery}
                />
                {searchQuery && (
                  <button
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery('')}
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  className={cn(
                    'flex items-center gap-1 rounded-xl px-3 py-2 font-medium text-xs transition-colors',
                    !onlyInstalledFilter
                      ? 'border border-primary/30 bg-primary/10 text-primary'
                      : 'border border-border/50 bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => setOnlyInstalledFilter(false)}
                  type="button"
                >
                  Tüm Eklentiler
                </button>
                <button
                  className={cn(
                    'flex items-center gap-1 rounded-xl px-3 py-2 font-medium text-xs transition-colors',
                    onlyInstalledFilter
                      ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border border-border/50 bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => setOnlyInstalledFilter(true)}
                  type="button"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Yüklü Olanlar ({installedCount})
                </button>
              </div>
            </div>

            {/* Kategori Seçicileri */}
            <div className="scrollbar-none mt-3.5 flex items-center gap-1.5 overflow-x-auto pb-1">
              {CATEGORIES.map((cat) => (
                <button
                  className={cn(
                    'shrink-0 rounded-lg px-2.5 py-1 font-medium text-xs transition-colors',
                    selectedCategory === cat.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'border border-border/40 bg-card/70 text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  type="button"
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Eklenti Kartları Izgarası */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            {filteredPlugins.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {filteredPlugins.map((plugin) => (
                  <PluginErrorBoundary key={plugin.id} pluginName={plugin.name}>
                    <PluginCard descriptor={plugin} />
                  </PluginErrorBoundary>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground">
                  <PackageOpen className="h-7 w-7" />
                </div>
                <h3 className="mt-4 font-semibold text-foreground text-base">Eklenti Bulunamadı</h3>
                <p className="mt-1 max-w-sm text-muted-foreground text-xs">
                  {searchQuery
                    ? `"${searchQuery}" aramasıyla eşleşen eklenti bulunamadı. Farklı bir terim deneyin.`
                    : 'Bu kategoride henüz eklenti bulunmuyor.'}
                </p>
                {(searchQuery || selectedCategory !== 'all' || onlyInstalledFilter) && (
                  <button
                    className="mt-4 inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 font-medium text-foreground text-xs shadow-sm hover:bg-accent"
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedCategory('all')
                      setOnlyInstalledFilter(false)
                    }}
                    type="button"
                  >
                    Filtreleri Temizle
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ayrıntı Modalı */}
      {activeDetailDescriptor && (
        <PluginDetailDialog descriptor={activeDetailDescriptor} onClose={closeDetail} />
      )}
    </>
  )
}
