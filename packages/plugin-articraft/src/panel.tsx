'use client'

import { useScene } from '@pascal-app/core'
import { SegmentedControl, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  cancelGeneration,
  createGeneration,
  createReferenceRender,
  fetchCatalog,
  fetchGeneration,
  fetchGenerationConfiguration,
  fetchProjectImages,
} from './api'
import { useArticraftStore } from './store'
import type {
  ArticraftCatalogItem,
  ArticraftCategory,
  ArticraftGeneration,
  ArticraftGenerationConfiguration,
  ArticraftGenerationDraft,
  ArticraftGenerationModel,
  ArticraftGenerationQueueItem,
  ArticraftProjectImage,
  ArticraftReferenceProvider,
  ArticraftReferenceRender,
} from './types'

type Mode = 'browse' | 'generate'

const ACCENT = '#ff6b3d'
const PAGE_SIZE = 16

const inputStyle: CSSProperties = {
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--foreground)',
  font: 'inherit',
  fontSize: 12,
  outline: 'none',
  padding: '9px 10px',
  width: '100%',
}

const primaryButton: CSSProperties = {
  alignItems: 'center',
  background: ACCENT,
  border: 0,
  borderRadius: 999,
  color: '#17120f',
  cursor: 'pointer',
  display: 'flex',
  fontSize: 12,
  fontWeight: 700,
  gap: 7,
  justifyContent: 'center',
  padding: '10px 14px',
}

function arm(item: ArticraftCatalogItem) {
  useArticraftStore.getState().setSelectedItem(item)
  ;(useEditor.getState().setTool as (tool: string) => void)('articraft:asset')
  useEditor.getState().setMode('build')
}

export default function ArticraftPanel() {
  const [mode, setMode] = useState<Mode>('browse')
  const content = useRef<HTMLDivElement>(null)
  const count = useScene(
    (state) =>
      Object.values(state.nodes).filter((node) => (node.type as string) === 'articraft:asset')
        .length,
  )

  useEffect(() => {
    content.current?.scrollTo({ top: 0 })
  }, [mode])

  return (
    <div
      style={{
        color: 'var(--sidebar-foreground)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          borderBottom: '1px solid var(--sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          flex: '0 0 auto',
          gap: 13,
          padding: '15px 15px 13px',
        }}
      >
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ alignItems: 'center', display: 'flex', gap: 9 }}>
            <div
              aria-hidden
              style={{
                alignItems: 'center',
                background: ACCENT,
                borderRadius: 8,
                color: '#17120f',
                display: 'flex',
                fontSize: 10,
                fontWeight: 900,
                height: 25,
                justifyContent: 'center',
                letterSpacing: '-0.04em',
                width: 25,
              }}
            >
              A10
            </div>
            <div>
              <h2
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  margin: 0,
                }}
              >
                Articraft
              </h2>
              <span
                style={{
                  color: 'var(--muted-foreground)',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                Articulated object library
              </span>
            </div>
          </div>
          <span
            style={{
              background: 'var(--sidebar-accent)',
              border: '1px solid var(--sidebar-border)',
              borderRadius: 999,
              color: 'var(--muted-foreground)',
              fontSize: 10,
              padding: '4px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {count} placed
          </span>
        </div>
        <SegmentedControl
          onChange={setMode}
          options={[
            { label: 'Browse', value: 'browse' },
            { label: 'Generate', value: 'generate' },
          ]}
          value={mode}
        />
      </header>

      <div
        data-articraft-scroll-region
        ref={content}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          padding: mode === 'browse' ? '0 15px 15px' : 15,
        }}
      >
        {mode === 'browse' ? <Catalog scrollContainer={content} /> : <Generate />}
      </div>

      <footer
        style={{
          borderTop: '1px solid var(--sidebar-border)',
          color: 'var(--muted-foreground)',
          flex: '0 0 auto',
          fontSize: 10,
          lineHeight: 1.45,
          padding: '10px 15px',
        }}
      >
        Articraft-10K · CC BY 4.0 · Cambridge Visual Structure Learning Lab
      </footer>
    </div>
  )
}

function Catalog({ scrollContainer }: { scrollContainer: { current: HTMLDivElement | null } }) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 250)
  const [category, setCategory] = useState<ArticraftCategory | undefined>()
  const [categories, setCategories] = useState<Array<{ count: number; name: ArticraftCategory }>>(
    [],
  )
  const [items, setItems] = useState<ArticraftCatalogItem[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const initialLoadingRef = useRef(true)
  const loadingMoreRef = useRef(false)
  const loadMoreController = useRef<AbortController | null>(null)
  const requestKey = useRef('')

  useEffect(() => {
    const controller = new AbortController()
    const key = `${category ?? ''}\u0000${debouncedQuery}`
    requestKey.current = key
    loadMoreController.current?.abort()
    loadMoreController.current = null
    initialLoadingRef.current = true
    loadingMoreRef.current = false
    setLoadingMore(false)
    setPage(1)
    setLoading(true)
    setError('')
    setItems([])
    void fetchCatalog({
      category,
      query: debouncedQuery,
      page: 1,
      pageSize: PAGE_SIZE,
      signal: controller.signal,
    })
      .then((response) => {
        if (requestKey.current !== key) return
        setItems(response.items)
        setTotal(response.total)
        setCategories(response.categories)
        scrollContainer.current?.scrollTo({ top: 0 })
      })
      .catch((cause) => {
        if (!(controller.signal.aborted || requestKey.current !== key)) {
          setError(errorMessage(cause))
        }
      })
      .finally(() => {
        if (!(controller.signal.aborted || requestKey.current !== key)) {
          initialLoadingRef.current = false
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [category, debouncedQuery, scrollContainer])

  useEffect(() => () => loadMoreController.current?.abort(), [])

  const loadMore = useCallback(async () => {
    if (initialLoadingRef.current || loading || loadingMoreRef.current || items.length >= total) {
      return
    }
    const key = requestKey.current
    if (!key) return
    const nextPage = page + 1
    const controller = new AbortController()
    loadMoreController.current = controller
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError('')
    try {
      const response = await fetchCatalog({
        category,
        query: debouncedQuery,
        page: nextPage,
        pageSize: PAGE_SIZE,
        signal: controller.signal,
      })
      if (controller.signal.aborted || requestKey.current !== key) return
      setItems((current) => uniqueItems(current, response.items))
      setPage(nextPage)
      setTotal(response.total)
      setCategories(response.categories)
    } catch (cause) {
      if (!(controller.signal.aborted || requestKey.current !== key)) {
        setError(errorMessage(cause))
      }
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [category, debouncedQuery, items.length, loading, page, total])

  useEffect(() => {
    const target = sentinel.current
    const root = scrollContainer.current
    if (!(target && root)) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore()
      },
      { root, rootMargin: '500px 0px', threshold: 0.01 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [loadMore, scrollContainer])

  const suggestions = debouncedQuery
    ? items
        .filter((item) => item.title.toLocaleLowerCase() !== debouncedQuery.toLocaleLowerCase())
        .slice(0, 3)
    : []
  const allCount = categories.reduce((sum, entry) => sum + entry.count, 0)
  const hasMore = items.length < total

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        aria-label="Catalog controls"
        data-articraft-catalog-controls
        role="group"
        style={{
          background: 'var(--sidebar-background, var(--background))',
          borderBottom: '1px solid var(--sidebar-border)',
          boxShadow: '0 8px 18px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          margin: '0 -15px',
          padding: '15px 15px 10px',
          position: 'sticky',
          top: 0,
          zIndex: 4,
        }}
      >
        <div>
          <div style={{ position: 'relative' }}>
            <Icon name="search" style={{ left: 10, position: 'absolute', top: 10, zIndex: 1 }} />
            <input
              aria-label="Search Articraft catalog"
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              placeholder="Search hinges, chairs, tools…"
              style={{
                ...inputStyle,
                paddingLeft: 31,
                paddingRight: query ? 30 : 10,
              }}
              value={query}
            />
            {query && (
              <button
                aria-label="Clear search"
                onClick={() => setQuery('')}
                style={iconButtonStyle({
                  position: 'absolute',
                  right: 5,
                  top: 5,
                })}
                type="button"
              >
                ×
              </button>
            )}
          </div>
          {searchFocused && suggestions.length > 0 && (
            <div
              aria-label="Search suggestions"
              role="group"
              style={{
                border: '1px solid var(--border)',
                borderRadius: 9,
                marginTop: 5,
                overflow: 'hidden',
              }}
            >
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setQuery(item.title)
                    setSearchFocused(false)
                  }}
                  style={{
                    alignItems: 'center',
                    background: 'transparent',
                    border: 0,
                    borderBottom: '1px solid var(--border)',
                    color: 'inherit',
                    cursor: 'pointer',
                    display: 'flex',
                    fontSize: 10,
                    gap: 7,
                    padding: '7px 9px',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  type="button"
                >
                  <Icon name="corner" size={11} />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <fieldset
          aria-label="Filter by category"
          style={{
            border: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            margin: 0,
            minWidth: 0,
            padding: 0,
            width: '100%',
          }}
        >
          <CategoryChip
            active={!category}
            count={allCount || total}
            label="All"
            onClick={() => setCategory(undefined)}
          />
          {categories.map((entry) => (
            <CategoryChip
              active={category === entry.name}
              count={entry.count}
              key={entry.name}
              label={entry.name}
              onClick={() => setCategory(entry.name)}
            />
          ))}
        </fieldset>
      </div>

      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ color: 'var(--muted-foreground)', fontSize: 10 }}>
          {loading
            ? 'Reading catalog…'
            : `${items.length.toLocaleString()} of ${total.toLocaleString()} articulated assets`}
        </span>
      </div>

      {error && <Status error>{error}</Status>}
      {loading ? (
        <div style={catalogGridStyle}>
          {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((key) => (
            <CatalogSkeleton key={key} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          detail="Try another object name or clear the active category."
          icon="search"
          title="No matching assets"
        />
      ) : (
        <div style={catalogGridStyle}>
          {items.map((item) => (
            <CatalogCard item={item} key={item.id} />
          ))}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div
          ref={sentinel}
          style={{
            alignItems: 'center',
            color: 'var(--muted-foreground)',
            display: 'flex',
            fontSize: 9,
            justifyContent: 'center',
            minHeight: 32,
          }}
        >
          {loadingMore ? (
            'Loading more…'
          ) : hasMore ? (
            <button onClick={() => void loadMore()} style={secondaryButton(false)} type="button">
              Load more
            </button>
          ) : total > PAGE_SIZE ? (
            `All ${total.toLocaleString()} assets loaded`
          ) : null}
        </div>
      )}
    </section>
  )
}

function uniqueItems(
  current: ArticraftCatalogItem[],
  next: ArticraftCatalogItem[],
): ArticraftCatalogItem[] {
  const items = new Map(current.map((item) => [item.id, item]))
  for (const item of next) items.set(item.id, item)
  return [...items.values()]
}

function CategoryChip({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'color-mix(in srgb, #ff6b3d 14%, var(--background))' : 'transparent',
        border: `1px solid ${active ? ACCENT : 'var(--border)'}`,
        borderRadius: 999,
        color: active ? ACCENT : 'var(--muted-foreground)',
        cursor: 'pointer',
        flex: '0 1 auto',
        fontSize: 9,
        minHeight: 26,
        maxWidth: '100%',
        padding: '4px 6px',
        whiteSpace: 'nowrap',
      }}
      type="button"
    >
      {label} <span style={{ opacity: 0.62 }}>{count.toLocaleString()}</span>
    </button>
  )
}

function CatalogCard({ item }: { item: ArticraftCatalogItem }) {
  const selected = useArticraftStore((state) => state.selectedItem?.id === item.id)
  const activeTool = useEditor((state) => state.tool)
  const armed = selected && activeTool === 'articraft:asset'
  const movingJoints = item.joints.filter((joint) => joint.type !== 'fixed').length

  return (
    <button
      aria-label={`Place ${item.title}`}
      onClick={() => arm(item)}
      style={{
        background: armed
          ? 'color-mix(in srgb, #ff6b3d 10%, var(--background))'
          : 'var(--background)',
        border: `1px solid ${armed ? ACCENT : 'var(--sidebar-border)'}`,
        borderRadius: 11,
        color: 'inherit',
        cursor: 'pointer',
        contentVisibility: 'auto',
        display: 'flex',
        flexDirection: 'column',
        containIntrinsicSize: '170px',
        minWidth: 0,
        overflow: 'hidden',
        padding: 0,
        position: 'relative',
        textAlign: 'left',
      }}
      type="button"
    >
      <div
        style={{
          aspectRatio: '4 / 3',
          background: 'var(--muted)',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <PreviewFallback category={item.category} />
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: '8px 8px 9px',
          width: '100%',
        }}
      >
        <span
          style={{
            display: '-webkit-box',
            fontSize: 11,
            fontWeight: 650,
            lineHeight: 1.3,
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            alignItems: 'center',
            color: 'var(--muted-foreground)',
            display: 'flex',
            fontSize: 9,
            gap: 4,
          }}
        >
          <Icon name="joint" size={10} />
          {movingJoints} {movingJoints === 1 ? 'joint' : 'joints'} · {item.parts.length} parts
        </span>
      </div>
      {armed && (
        <span
          style={{
            background: ACCENT,
            borderRadius: 999,
            color: '#17120f',
            fontSize: 8,
            fontWeight: 800,
            padding: '3px 6px',
            position: 'absolute',
            right: 6,
            top: 6,
          }}
        >
          ARMED
        </span>
      )}
    </button>
  )
}

function PreviewFallback({ category }: { category?: ArticraftCategory }) {
  return (
    <div
      aria-hidden
      data-articraft-preview="metadata"
      style={{
        alignItems: 'center',
        background: 'linear-gradient(145deg, #202228, #151619)',
        color: '#828892',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        height: '100%',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          border: '1px solid #4b4f58',
          borderRadius: 999,
          display: 'flex',
          height: 42,
          justifyContent: 'center',
          width: 42,
        }}
      >
        <Icon name="cube" size={21} />
      </div>
      <span
        style={{
          color: '#9da3ad',
          fontSize: 7,
          letterSpacing: '0.13em',
          textTransform: 'uppercase',
        }}
      >
        {category ?? '3D asset'}
      </span>
    </div>
  )
}

function CatalogSkeleton() {
  return (
    <div
      aria-hidden
      style={{
        border: '1px solid var(--sidebar-border)',
        borderRadius: 11,
        overflow: 'hidden',
      }}
    >
      <div style={{ aspectRatio: '4 / 3', background: 'var(--muted)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8 }}>
        <div
          style={{
            background: 'var(--muted)',
            borderRadius: 4,
            height: 9,
            width: '82%',
          }}
        />
        <div
          style={{
            background: 'var(--muted)',
            borderRadius: 4,
            height: 7,
            width: '55%',
          }}
        />
      </div>
    </div>
  )
}

function Generate() {
  const projectId = useViewer((state) => state.projectId)
  const [prompt, setPrompt] = useState('')
  const [localImage, setLocalImage] = useState<File | null>(null)
  const [projectImage, setProjectImage] = useState<ArticraftProjectImage | null>(null)
  const [referenceRender, setReferenceRender] = useState<ArticraftReferenceRender | null>(null)
  const [projectImages, setProjectImages] = useState<ArticraftProjectImage[]>([])
  const [showAllFiles, setShowAllFiles] = useState(false)
  const [filesLoading, setFilesLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [referenceDialogOpen, setReferenceDialogOpen] = useState(false)
  const [referencePrompt, setReferencePrompt] = useState('')
  const [referenceProvider, setReferenceProvider] =
    useState<ArticraftReferenceProvider>('azure-openai')
  const [configuration, setConfiguration] = useState<ArticraftGenerationConfiguration | null>(null)
  const [configurationLoading, setConfigurationLoading] = useState(true)
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [error, setError] = useState('')
  const [referenceNotice, setReferenceNotice] = useState('')
  const [referenceElapsed, setReferenceElapsed] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [generatingReference, setGeneratingReference] = useState(false)
  const [canceling, setCanceling] = useState<string[]>([])
  const generationQueue = useArticraftStore((state) => state.generationQueue)
  const addGeneration = useArticraftStore((state) => state.addGeneration)
  const removeGeneration = useArticraftStore((state) => state.removeGeneration)
  const updateGeneration = useArticraftStore((state) => state.updateGeneration)
  const fileInput = useRef<HTMLInputElement>(null)
  const queueSection = useRef<HTMLElement>(null)
  const referenceController = useRef<AbortController | null>(null)

  const localPreview = useMemo(
    () => (localImage ? URL.createObjectURL(localImage) : null),
    [localImage],
  )
  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    },
    [localPreview],
  )

  const referenceUrl = localPreview ?? referenceRender?.imageUrl ?? projectImage?.url ?? null
  const referenceName =
    referenceRender?.projectImage.name ??
    localImage?.name ??
    projectImage?.name ??
    'Reference image'

  useEffect(() => {
    const controller = new AbortController()
    setConfigurationLoading(true)
    void fetchGenerationConfiguration(controller.signal)
      .then((next) => {
        setConfiguration(next)
        setSelectedModelKey((current) =>
          next.models.some((model) => generationModelKey(model) === current)
            ? current
            : generationModelKey({
                model: next.model,
                provider: next.provider,
              }),
        )
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setConfigurationLoading(false)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!generatingReference) {
      setReferenceElapsed(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setReferenceElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [generatingReference])

  useEffect(
    () => () => {
      referenceController.current?.abort()
    },
    [],
  )

  useEffect(() => {
    if (!projectId) return
    const controller = new AbortController()
    setFilesLoading(true)
    void fetchProjectImages(projectId, controller.signal)
      .then(setProjectImages)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setFilesLoading(false)
      })
    return () => controller.abort()
  }, [projectId])

  const activeGenerationIds = generationQueue
    .filter((entry) => isGenerationActive(entry.generation))
    .map((entry) => entry.generation.id)
    .join('\u0000')

  useEffect(() => {
    if (!activeGenerationIds) return
    let disposed = false
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const generations = await Promise.all(
          activeGenerationIds.split('\u0000').map((id) => fetchGeneration(id)),
        )
        if (!disposed) generations.forEach(updateGeneration)
      } catch (cause) {
        if (!disposed) setError(errorMessage(cause))
      } finally {
        polling = false
      }
    }
    const timer = window.setInterval(() => void poll(), 2000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activeGenerationIds, updateGeneration])

  const chooseLocalImage = (file: File | undefined) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Reference image must be JPEG, PNG, or WebP.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Reference image must be 10 MB or smaller.')
      return
    }
    setError('')
    setLocalImage(file)
    setProjectImage(null)
    setReferenceRender(null)
  }

  const generateReference = async () => {
    if (!(projectId && referencePrompt.trim())) return
    referenceController.current?.abort()
    const controller = new AbortController()
    referenceController.current = controller
    setError('')
    setReferenceNotice('')
    setGeneratingReference(true)
    try {
      const source = localImage
        ? localImage
        : referenceUrl
          ? await imageFileFromUrl(referenceUrl, referenceName, controller.signal)
          : undefined
      const render = await createReferenceRender({
        ...(source ? { image: source } : {}),
        projectId,
        prompt: referencePrompt.trim(),
        provider: referenceProvider,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setReferenceRender(render)
      setLocalImage(null)
      setProjectImage(null)
      setProjectImages((current) => [
        render.projectImage,
        ...current.filter((image) => image.id !== render.projectImage.id),
      ])
      setReferenceDialogOpen(false)
    } catch (cause) {
      if (isAbortError(cause)) {
        setReferenceNotice('Reference generation canceled. Nothing was saved.')
      } else {
        setError(errorMessage(cause))
      }
    } finally {
      if (referenceController.current === controller) {
        referenceController.current = null
        setGeneratingReference(false)
      }
    }
  }

  const cancelReference = () => {
    setReferenceNotice('Canceling generation…')
    referenceController.current?.abort()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const selectedModel = configuration?.models.find(
      (model) => generationModelKey(model) === selectedModelKey,
    )
    if (!selectedModel) {
      setError('Choose an available Articraft model.')
      return
    }
    setError('')
    setSubmitting(true)
    const form = new FormData()
    const cleanPrompt = prompt.trim()
    form.set('prompt', cleanPrompt)
    form.set('provider', selectedModel.provider)
    form.set('model', selectedModel.model)
    const draft: ArticraftGenerationDraft = {
      model: selectedModel.model,
      prompt: cleanPrompt,
      provider: selectedModel.provider,
      ...(localImage
        ? { reference: { file: localImage, kind: 'file' as const } }
        : referenceRender
          ? {
              reference: {
                image: referenceRender.projectImage,
                kind: 'project' as const,
              },
            }
          : projectImage
            ? { reference: { image: projectImage, kind: 'project' as const } }
            : {}),
    }
    try {
      if (localImage) {
        form.set('image', localImage)
      } else if (referenceUrl) {
        form.set('image', await imageFileFromUrl(referenceUrl, referenceName))
      }
      const generation = await createGeneration(form)
      addGeneration(generation, draft)
      setPrompt('')
      setLocalImage(null)
      setProjectImage(null)
      setReferenceRender(null)
      setReferencePrompt('')
      setReferenceNotice('')
      window.requestAnimationFrame(() => queueSection.current?.scrollIntoView({ block: 'nearest' }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const editGeneration = (draft: ArticraftGenerationDraft) => {
    setPrompt(draft.prompt)
    setSelectedModelKey(generationModelKey(draft))
    setReferenceRender(null)
    setReferencePrompt('')
    if (draft.reference?.kind === 'file') {
      setLocalImage(draft.reference.file)
      setProjectImage(null)
    } else if (draft.reference?.kind === 'project') {
      setProjectImage(draft.reference.image)
      setLocalImage(null)
    } else {
      setLocalImage(null)
      setProjectImage(null)
    }
  }

  const cancelQueuedGeneration = async (generation: ArticraftGeneration) => {
    setCanceling((current) => [...current, generation.id])
    setError('')
    try {
      updateGeneration(await cancelGeneration(generation.id))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setCanceling((current) => current.filter((id) => id !== generation.id))
    }
  }

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragging(false)
    chooseLocalImage(event.dataTransfer.files[0])
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
      <style>{`@keyframes articraft-queue-pulse { from { opacity: .24; transform: scaleX(.42); } to { opacity: .72; transform: scaleX(1); } } @media (prefers-reduced-motion: reduce) { [data-articraft-active-progress] { animation: none !important; } }`}</style>
      <Step eyebrow="01 · Reference · Optional" title="Start with the object">
        {referenceUrl ? (
          <div
            style={{
              background: 'var(--muted)',
              border: `1px solid ${referenceRender ? ACCENT : 'var(--border)'}`,
              borderRadius: 11,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <img
              alt="Selected reference"
              src={referenceUrl}
              style={{
                aspectRatio: '16 / 10',
                display: 'block',
                objectFit: 'cover',
                width: '100%',
              }}
            />
            <div
              style={{
                alignItems: 'center',
                background: 'color-mix(in srgb, var(--background) 92%, transparent)',
                bottom: 0,
                display: 'flex',
                gap: 7,
                left: 0,
                padding: '7px 8px',
                position: 'absolute',
                right: 0,
              }}
            >
              <Icon name={referenceRender ? 'sparkles' : 'image'} size={12} />
              <span
                style={{
                  flex: 1,
                  fontSize: 9,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {referenceName}
              </span>
              {referenceRender && (
                <span style={{ color: ACCENT, fontSize: 8, whiteSpace: 'nowrap' }}>
                  Saved to Files
                </span>
              )}
              <button
                aria-label="Remove reference"
                onClick={() => {
                  setLocalImage(null)
                  setProjectImage(null)
                  setReferenceRender(null)
                }}
                style={iconButtonStyle()}
                type="button"
              >
                ×
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileInput.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            style={{
              alignItems: 'center',
              background: dragging
                ? 'color-mix(in srgb, #ff6b3d 10%, var(--background))'
                : 'var(--background)',
              border: `1px dashed ${dragging ? ACCENT : 'var(--border)'}`,
              borderRadius: 11,
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '16px 12px',
              textAlign: 'center',
              width: '100%',
            }}
            type="button"
          >
            <Icon name="upload" size={20} />
            <span style={{ fontSize: 11, fontWeight: 650 }}>Drop a product image here</span>
            <span style={{ color: 'var(--muted-foreground)', fontSize: 9 }}>
              Or choose a recent Pascal File below
            </span>
          </button>
        )}

        <input
          accept="image/png,image/jpeg,image/webp"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            chooseLocalImage(event.target.files?.[0])
          }
          ref={fileInput}
          style={{ display: 'none' }}
          type="file"
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div
            style={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 650 }}>Recent project images</span>
            <span style={{ color: 'var(--muted-foreground)', fontSize: 9 }}>
              {filesLoading ? 'Loading…' : `${projectImages.length} files`}
            </span>
          </div>
          {filesLoading ? (
            <Status>Reading Pascal Files…</Status>
          ) : projectImages.length === 0 ? (
            <Status>Generated references will be saved here automatically.</Status>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 6,
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              }}
            >
              {(showAllFiles ? projectImages : projectImages.slice(0, 6)).map((image) => (
                <button
                  aria-label={`Use ${image.name}`}
                  key={image.id}
                  onClick={() => {
                    setProjectImage(image)
                    setLocalImage(null)
                    setReferenceRender(null)
                  }}
                  style={{
                    background: 'var(--muted)',
                    border: `1px solid ${projectImage?.id === image.id ? ACCENT : 'var(--border)'}`,
                    borderRadius: 9,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    padding: 0,
                    position: 'relative',
                  }}
                  title={image.name}
                  type="button"
                >
                  <img
                    alt=""
                    loading="lazy"
                    src={image.url}
                    style={{
                      aspectRatio: '1 / 1',
                      display: 'block',
                      objectFit: 'cover',
                      width: '100%',
                    }}
                  />
                </button>
              ))}
            </div>
          )}
          {projectImages.length > 6 && (
            <button
              onClick={() => setShowAllFiles((value) => !value)}
              style={secondaryButton(false, { alignSelf: 'flex-start' })}
              type="button"
            >
              {showAllFiles ? 'Show recent only' : `Show all ${projectImages.length}`}
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gap: 6,
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          }}
        >
          <ReferenceAction
            icon="upload"
            label="Upload image"
            onClick={() => fileInput.current?.click()}
          />
          <ReferenceAction
            icon="sparkles"
            label={referenceRender ? 'Refine reference' : 'Generate reference'}
            onClick={() => {
              setReferenceNotice('')
              if (!referencePrompt && prompt.trim()) {
                setReferencePrompt(
                  `Clean product reference of ${prompt.trim()}. Single articulated object, fully visible, neutral studio background, clear separation between moving parts, no text.`,
                )
              }
              setReferenceDialogOpen(true)
            }}
          />
        </div>

        {referenceDialogOpen && (
          <div
            aria-label="Generate reference image"
            role="dialog"
            style={{
              background: 'color-mix(in srgb, #ff6b3d 5%, var(--background))',
              border: '1px solid color-mix(in srgb, #ff6b3d 35%, var(--border))',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 10,
            }}
          >
            <div
              style={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 700 }}>Reference studio</span>
                <span style={{ color: 'var(--muted-foreground)', fontSize: 8 }}>
                  The result is saved to Pascal Files
                </span>
              </div>
              <button
                aria-label="Close reference studio"
                onClick={() => {
                  if (generatingReference) cancelReference()
                  setReferenceDialogOpen(false)
                }}
                style={iconButtonStyle()}
                type="button"
              >
                ×
              </button>
            </div>
            <div
              aria-label="Reference provider"
              role="group"
              style={{
                display: 'grid',
                gap: 6,
                gridTemplateColumns: '1fr 1fr',
              }}
            >
              <ReferenceProviderButton
                active={referenceProvider === 'azure-openai'}
                detail="GPT Image 2"
                disabled={generatingReference}
                label="Azure OpenAI"
                onClick={() => setReferenceProvider('azure-openai')}
              />
              <ReferenceProviderButton
                active={referenceProvider === 'google'}
                detail="Nano Banana 2"
                disabled={generatingReference}
                label="Google"
                onClick={() => setReferenceProvider('google')}
              />
            </div>
            <label style={labelStyle}>
              Image prompt
              <textarea
                aria-label="Reference image prompt"
                disabled={generatingReference}
                onChange={(event) => setReferencePrompt(event.target.value)}
                placeholder="A studio product photograph of a compact articulated desk lamp…"
                rows={4}
                style={{ ...inputStyle, lineHeight: 1.45, resize: 'vertical' }}
                value={referencePrompt}
              />
            </label>
            {referenceUrl && (
              <div
                style={{
                  alignItems: 'center',
                  color: 'var(--muted-foreground)',
                  display: 'flex',
                  fontSize: 9,
                  gap: 6,
                }}
              >
                <Icon name="image" size={12} />
                The selected image will be used as visual context.
              </div>
            )}
            {generatingReference ? (
              <ReferenceGenerationProgress
                elapsed={referenceElapsed}
                onCancel={cancelReference}
                provider={referenceProvider}
              />
            ) : (
              <button
                disabled={!(projectId && referencePrompt.trim())}
                onClick={() => void generateReference()}
                style={{
                  ...primaryButton,
                  opacity: !(projectId && referencePrompt.trim()) ? 0.48 : 1,
                }}
                type="button"
              >
                <Icon color="#17120f" name="sparkles" size={14} />
                Generate and save reference
              </button>
            )}
            {referenceNotice && <Status>{referenceNotice}</Status>}
          </div>
        )}
      </Step>

      {generationQueue.length > 0 && (
        <GenerationQueue
          canceling={canceling}
          entries={generationQueue}
          onCancel={(generation) => void cancelQueuedGeneration(generation)}
          onEdit={editGeneration}
          onRemove={removeGeneration}
          sectionRef={queueSection}
        />
      )}

      <Step eyebrow="02 · Articulation" title="Describe what should move">
        <textarea
          aria-label="Prompt"
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="A compact task chair with adjustable arms and a tilting back…"
          required
          rows={5}
          style={{ ...inputStyle, lineHeight: 1.5, resize: 'vertical' }}
          value={prompt}
        />
        <div
          style={{
            color: 'var(--muted-foreground)',
            display: 'flex',
            fontSize: 9,
            gap: 5,
          }}
        >
          <Icon name="joint" size={11} />
          Name moving parts, hinges, sliders, and expected range of motion.
        </div>
      </Step>

      <ArticraftEngine
        configuration={configuration}
        loading={configurationLoading}
        onChange={setSelectedModelKey}
        value={selectedModelKey}
      />

      <button
        disabled={
          submitting ||
          !prompt.trim() ||
          generatingReference ||
          configurationLoading ||
          !configuration?.ready
        }
        style={{
          ...primaryButton,
          opacity:
            submitting ||
            !prompt.trim() ||
            generatingReference ||
            configurationLoading ||
            !configuration?.ready
              ? 0.48
              : 1,
        }}
        type="submit"
      >
        <Icon color="#17120f" name="cube" size={14} />
        {submitting ? 'Starting Articraft…' : 'Generate articulated asset'}
      </button>

      {error && <Status error>{error}</Status>}
      <p
        style={{
          color: 'var(--muted-foreground)',
          fontSize: 9,
          lineHeight: 1.45,
          margin: 0,
        }}
      >
        Generation runs through Pascal’s credentialed Articraft worker. Provider keys never leave
        the server.
      </p>
    </form>
  )
}

function Step({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode
  eyebrow: string
  title: string
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            color: ACCENT,
            fontSize: 8,
            fontWeight: 750,
            letterSpacing: '0.11em',
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </span>
        <h3 style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>{title}</h3>
      </div>
      {children}
    </section>
  )
}

function GenerationQueue({
  canceling,
  entries,
  onCancel,
  onEdit,
  onRemove,
  sectionRef,
}: {
  canceling: string[]
  entries: ArticraftGenerationQueueItem[]
  onCancel: (generation: ArticraftGeneration) => void
  onEdit: (draft: ArticraftGenerationDraft) => void
  onRemove: (id: string) => void
  sectionRef: { current: HTMLElement | null }
}) {
  const activeCount = entries.filter((entry) => isGenerationActive(entry.generation)).length
  return (
    <section
      aria-label="Generation queue"
      ref={sectionRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        scrollMarginTop: 12,
      }}
    >
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              color: ACCENT,
              fontSize: 8,
              fontWeight: 750,
              letterSpacing: '0.11em',
            }}
          >
            GENERATION QUEUE
          </span>
          <h3 style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>Your Articraft runs</h3>
        </div>
        <span
          style={{
            border: '1px solid var(--border)',
            borderRadius: 999,
            color: 'var(--muted-foreground)',
            fontSize: 8,
            fontVariantNumeric: 'tabular-nums',
            padding: '4px 7px',
          }}
        >
          {activeCount > 0 ? `${activeCount} active` : `${entries.length} saved`}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {entries.map((entry) => (
          <GenerationQueueCard
            canceling={canceling.includes(entry.generation.id)}
            entry={entry}
            key={entry.generation.id}
            onCancel={onCancel}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  )
}

function GenerationQueueCard({
  canceling,
  entry,
  onCancel,
  onEdit,
  onRemove,
}: {
  canceling: boolean
  entry: ArticraftGenerationQueueItem
  onCancel: (generation: ArticraftGeneration) => void
  onEdit: (draft: ArticraftGenerationDraft) => void
  onRemove: (id: string) => void
}) {
  const { draft, generation } = entry
  const active = isGenerationActive(generation)
  const elapsed = useGenerationElapsed(entry.createdAt, active)
  const tone = generationStatusTone(generation.status)
  return (
    <article
      data-articraft-generation={generation.id}
      style={{
        background: 'var(--background)',
        border: `1px solid ${tone.border}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        overflow: 'hidden',
        padding: 10,
        position: 'relative',
      }}
    >
      {active && (
        <div
          aria-hidden
          data-articraft-active-progress
          style={{
            animation: 'articraft-queue-pulse 1.6s ease-in-out infinite alternate',
            background: ACCENT,
            height: 2,
            left: 0,
            opacity: 0.55,
            position: 'absolute',
            right: 0,
            top: 0,
          }}
        />
      )}
      <div style={{ alignItems: 'flex-start', display: 'flex', gap: 9 }}>
        <GenerationReferenceThumbnail draft={draft} />
        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: 4,
            minWidth: 0,
          }}
        >
          <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
            <span
              style={{
                color: tone.color,
                fontSize: 8,
                fontWeight: 750,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {generationStatusLabel(generation.status)}
            </span>
            <span
              style={{
                color: 'var(--muted-foreground)',
                fontSize: 8,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatElapsed(elapsed)}
            </span>
          </div>
          <span
            style={{
              display: '-webkit-box',
              fontSize: 10,
              fontWeight: 650,
              lineHeight: 1.35,
              overflow: 'hidden',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
            }}
          >
            {draft.prompt}
          </span>
          <span
            style={{
              color: 'var(--muted-foreground)',
              fontSize: 8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {providerLabel(draft.provider)} · {draft.model}
          </span>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gap: 6,
          gridTemplateColumns: `repeat(${generation.status === 'succeeded' ? 3 : 2}, minmax(0, 1fr))`,
        }}
      >
        <GenerationAction icon="edit" label="Edit input" onClick={() => onEdit(draft)} />
        {active ? (
          <GenerationAction
            disabled={canceling}
            icon="stop"
            label={canceling ? 'Stopping…' : 'Stop'}
            onClick={() => onCancel(generation)}
          />
        ) : generation.status === 'succeeded' && generation.item ? (
          <>
            <GenerationAction
              accent
              icon="place"
              label="Place"
              onClick={() => arm(generation.item!)}
            />
            <GenerationAction icon="trash" label="Remove" onClick={() => onRemove(generation.id)} />
          </>
        ) : (
          <GenerationAction icon="trash" label="Remove" onClick={() => onRemove(generation.id)} />
        )}
      </div>
      {generation.message && generation.status !== 'succeeded' && (
        <span
          style={{
            color: 'var(--muted-foreground)',
            fontSize: 8,
            lineHeight: 1.35,
          }}
        >
          {generation.message}
        </span>
      )}
    </article>
  )
}

function GenerationReferenceThumbnail({ draft }: { draft: ArticraftGenerationDraft }) {
  const localUrl = useMemo(
    () => (draft.reference?.kind === 'file' ? URL.createObjectURL(draft.reference.file) : null),
    [draft.reference],
  )
  useEffect(
    () => () => {
      if (localUrl) URL.revokeObjectURL(localUrl)
    },
    [localUrl],
  )
  const url = localUrl ?? (draft.reference?.kind === 'project' ? draft.reference.image.url : null)
  return url ? (
    <img
      alt=""
      src={url}
      style={{
        border: '1px solid color-mix(in srgb, var(--foreground) 14%, transparent)',
        borderRadius: 8,
        height: 45,
        objectFit: 'cover',
        width: 45,
      }}
    />
  ) : (
    <div
      aria-hidden
      style={{
        alignItems: 'center',
        background: 'var(--muted)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        color: 'var(--muted-foreground)',
        display: 'flex',
        height: 45,
        justifyContent: 'center',
        width: 45,
      }}
    >
      <Icon name="cube" size={17} />
    </div>
  )
}

function GenerationAction({
  accent = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  accent?: boolean
  disabled?: boolean
  icon: IconName
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        alignItems: 'center',
        background: accent ? ACCENT : 'var(--secondary)',
        border: `1px solid ${accent ? ACCENT : 'var(--border)'}`,
        borderRadius: 999,
        color: accent ? '#17120f' : 'var(--secondary-foreground)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        fontSize: 9,
        fontWeight: 650,
        gap: 5,
        justifyContent: 'center',
        minHeight: 40,
        opacity: disabled ? 0.45 : 1,
        padding: '7px 8px',
        transition: 'background-color 120ms ease, border-color 120ms ease, opacity 120ms ease',
      }}
      type="button"
    >
      <Icon name={icon} size={12} />
      {label}
    </button>
  )
}

function ArticraftEngine({
  configuration,
  loading,
  onChange,
  value,
}: {
  configuration: ArticraftGenerationConfiguration | null
  loading: boolean
  onChange: (value: string) => void
  value: string
}) {
  const ready = configuration?.ready === true
  const selected = configuration?.models.find((model) => generationModelKey(model) === value)
  return (
    <section
      aria-label="Articraft engine"
      style={{
        background: ready
          ? 'color-mix(in srgb, #ff6b3d 7%, var(--background))'
          : 'var(--background)',
        border: `1px solid ${ready ? 'color-mix(in srgb, #ff6b3d 30%, var(--border))' : 'var(--border)'}`,
        borderRadius: 11,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 9 }}>
        <div
          style={{
            alignItems: 'center',
            background: ready ? ACCENT : 'var(--muted)',
            borderRadius: 8,
            color: ready ? '#17120f' : 'var(--muted-foreground)',
            display: 'flex',
            height: 30,
            justifyContent: 'center',
            width: 30,
          }}
        >
          <Icon name="cube" size={15} />
        </div>
        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: 2,
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700 }}>Articraft model</span>
          <span style={{ color: 'var(--muted-foreground)', fontSize: 9 }}>
            {loading
              ? 'Checking the generation worker…'
              : selected
                ? `${providerLabel(selected.provider)} · ${selected.model}`
                : 'The generation worker is unavailable on this host.'}
          </span>
        </div>
        <span
          style={{
            border: `1px solid ${ready ? ACCENT : 'var(--border)'}`,
            borderRadius: 999,
            color: ready ? ACCENT : 'var(--muted-foreground)',
            fontSize: 8,
            fontWeight: 750,
            padding: '3px 6px',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'CHECKING' : ready ? 'READY' : 'OFFLINE'}
        </span>
      </div>
      {configuration && (
        <label style={labelStyle}>
          Model
          <select
            aria-label="Articraft generation model"
            disabled={!ready || configuration.models.length < 2}
            onChange={(event) => onChange(event.target.value)}
            style={{ ...inputStyle, cursor: ready ? 'pointer' : 'default' }}
            value={value}
          >
            {configuration.models.map((model) => (
              <option key={generationModelKey(model)} value={generationModelKey(model)}>
                {model.label} · {providerLabel(model.provider)}
                {model.model === configuration.model && model.provider === configuration.provider
                  ? ' (Default)'
                  : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  )
}

function ReferenceGenerationProgress({
  elapsed,
  onCancel,
  provider,
}: {
  elapsed: number
  onCancel: () => void
  provider: ArticraftReferenceProvider
}) {
  return (
    <div
      aria-live="polite"
      data-articraft-reference-progress
      role="status"
      style={{
        background: 'var(--background)',
        border: '1px solid color-mix(in srgb, #ff6b3d 42%, var(--border))',
        borderRadius: 11,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        overflow: 'hidden',
        padding: 10,
        position: 'relative',
      }}
    >
      <style>{`@keyframes articraft-reference-sweep { from { transform: translateX(-110%); } to { transform: translateX(310%); } }`}</style>
      <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
        <div
          aria-hidden
          style={{
            alignItems: 'center',
            background: ACCENT,
            borderRadius: 999,
            color: '#17120f',
            display: 'flex',
            height: 27,
            justifyContent: 'center',
            width: 27,
          }}
        >
          <Icon name="sparkles" size={13} />
        </div>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700 }}>{referenceProgressLabel(elapsed)}</span>
          <span style={{ color: 'var(--muted-foreground)', fontSize: 8 }}>
            {provider === 'azure-openai' ? 'Azure OpenAI · GPT Image 2' : 'Google · Nano Banana 2'}
            {' · '}
            {formatElapsed(elapsed)}
          </span>
        </div>
      </div>
      <div
        aria-hidden
        style={{
          background: 'color-mix(in srgb, #ff6b3d 14%, var(--muted))',
          borderRadius: 999,
          height: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            animation: 'articraft-reference-sweep 1.35s ease-in-out infinite',
            background: ACCENT,
            borderRadius: 999,
            height: '100%',
            width: '34%',
          }}
        />
      </div>
      <div
        style={{
          alignItems: 'center',
          color: 'var(--muted-foreground)',
          display: 'flex',
          fontSize: 8,
          gap: 7,
          justifyContent: 'space-between',
        }}
      >
        <span>The image is saved to Files only after generation finishes.</span>
        <button onClick={onCancel} style={secondaryButton(false)} type="button">
          Cancel
        </button>
      </div>
    </div>
  )
}

function ReferenceProviderButton({
  active,
  detail,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean
  detail: string
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        alignItems: 'flex-start',
        background: active
          ? 'color-mix(in srgb, #ff6b3d 12%, var(--background))'
          : 'var(--background)',
        border: `1px solid ${active ? ACCENT : 'var(--border)'}`,
        borderRadius: 999,
        color: active ? ACCENT : 'var(--foreground)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0,
        opacity: disabled ? 0.58 : 1,
        padding: '7px 10px',
        textAlign: 'left',
      }}
      type="button"
    >
      <span style={{ fontSize: 9, fontWeight: 700 }}>{label}</span>
      <span style={{ color: 'var(--muted-foreground)', fontSize: 8 }}>{detail}</span>
    </button>
  )
}

function ReferenceAction({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  icon: IconName
  label: string
  onClick: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        alignItems: 'center',
        background: active
          ? 'color-mix(in srgb, #ff6b3d 10%, var(--background))'
          : 'var(--background)',
        border: `1px solid ${active ? ACCENT : 'var(--border)'}`,
        borderRadius: 999,
        color: active ? ACCENT : 'var(--foreground)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        fontSize: 9,
        gap: 4,
        justifyContent: 'center',
        minHeight: 49,
        opacity: disabled ? 0.42 : 1,
        padding: '6px 3px',
      }}
      type="button"
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  )
}

function EmptyState({ detail, icon, title }: { detail: string; icon: IconName; title: string }) {
  return (
    <div
      style={{
        alignItems: 'center',
        border: '1px dashed var(--border)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '24px 16px',
        textAlign: 'center',
      }}
    >
      <Icon name={icon} size={21} />
      <span style={{ fontSize: 11, fontWeight: 650 }}>{title}</span>
      <span
        style={{
          color: 'var(--muted-foreground)',
          fontSize: 9,
          lineHeight: 1.4,
        }}
      >
        {detail}
      </span>
    </div>
  )
}

function Status({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <p
      style={{
        background: error ? 'color-mix(in srgb, #ef4444 12%, transparent)' : 'var(--muted)',
        border: `1px solid ${error ? 'color-mix(in srgb, #ef4444 35%, transparent)' : 'transparent'}`,
        borderRadius: 10,
        color: error ? '#ef6d6d' : 'var(--muted-foreground)',
        fontSize: 10,
        lineHeight: 1.45,
        margin: 0,
        padding: '8px 9px',
      }}
    >
      {children}
    </p>
  )
}

type IconName =
  | 'corner'
  | 'cube'
  | 'edit'
  | 'folder'
  | 'image'
  | 'joint'
  | 'place'
  | 'search'
  | 'sparkles'
  | 'stop'
  | 'trash'
  | 'upload'

const iconPaths: Record<IconName, ReactNode> = {
  corner: <path d="m9 7 5 5-5 5M4 4v4a4 4 0 0 0 4 4h6" />,
  cube: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9" />,
  edit: <path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Zm10.5-12 2.8 2.8" />,
  folder: (
    <path d="M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2v1Z" />
  ),
  image: <path d="M4 5h16v14H4zM4 15l4-4 4 4 2-2 6 6M15.5 9.5h.01" />,
  joint: <path d="M6 12a3 3 0 1 0 0 .01M18 12a3 3 0 1 0 0 .01M9 12h6" />,
  place: <path d="M12 21V9m0 0 4 4m-4-4-4 4M5 5h14" />,
  search: <path d="m20 20-4.4-4.4M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />,
  sparkles: (
    <path d="m12 3 1.1 3.4L16.5 7.5l-3.4 1.1L12 12l-1.1-3.4-3.4-1.1 3.4-1.1L12 3ZM18 13l.8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13ZM6 12l.8 2.2L9 15l-2.2.8L6 18l-.8-2.2L3 15l2.2-.8L6 12Z" />
  ),
  stop: <path d="M7 7h10v10H7z" />,
  trash: <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />,
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />,
}

function Icon({
  color = 'currentColor',
  name,
  size = 15,
  style,
}: {
  color?: string
  name: IconName
  size?: number
  style?: CSSProperties
}) {
  return (
    <svg
      aria-hidden
      fill="none"
      height={size}
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      style={{ flex: '0 0 auto', ...style }}
      viewBox="0 0 24 24"
      width={size}
    >
      <title>{name}</title>
      {iconPaths[name]}
    </svg>
  )
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [delay, value])
  return debounced
}

async function imageFileFromUrl(url: string, name: string, signal?: AbortSignal): Promise<File> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not read the selected reference (${response.status}).`)
  const blob = await response.blob()
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const basename = name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .slice(0, 80)
  return new File([blob], `${basename || 'reference'}.${extension}`, {
    type: blob.type,
  })
}

function generationModelKey(model: Pick<ArticraftGenerationModel, 'model' | 'provider'>): string {
  return `${model.provider}\u0000${model.model}`
}

function isGenerationActive(generation: ArticraftGeneration): boolean {
  return generation.status === 'queued' || generation.status === 'running'
}

function useGenerationElapsed(createdAt: number, active: boolean): number {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - createdAt) / 1000)),
  )
  useEffect(() => {
    setElapsed(Math.max(0, Math.floor((Date.now() - createdAt) / 1000)))
    if (!active) return
    const timer = window.setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - createdAt) / 1000))),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [active, createdAt])
  return elapsed
}

function generationStatusLabel(status: ArticraftGeneration['status']): string {
  return {
    canceled: 'Canceled',
    failed: 'Failed',
    queued: 'Queued',
    running: 'Generating',
    succeeded: 'Ready to place',
  }[status]
}

function generationStatusTone(status: ArticraftGeneration['status']): {
  border: string
  color: string
} {
  if (status === 'succeeded')
    return {
      border: 'color-mix(in srgb, #22c55e 34%, var(--border))',
      color: '#43cf75',
    }
  if (status === 'failed')
    return {
      border: 'color-mix(in srgb, #ef4444 34%, var(--border))',
      color: '#ef6d6d',
    }
  if (status === 'canceled') return { border: 'var(--border)', color: 'var(--muted-foreground)' }
  return {
    border: 'color-mix(in srgb, #ff6b3d 38%, var(--border))',
    color: ACCENT,
  }
}

function providerLabel(provider: ArticraftGenerationConfiguration['provider']): string {
  return {
    anthropic: 'Anthropic',
    gemini: 'Google Gemini',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
  }[provider]
}

function referenceProgressLabel(elapsed: number): string {
  if (elapsed < 3) return 'Connecting to the image studio…'
  if (elapsed < 15) return 'Composing the articulated reference…'
  if (elapsed < 35) return 'Rendering shape, materials, and joints…'
  return 'Finishing the image and saving to Files…'
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError'
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

const catalogGridStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
}

const labelStyle: CSSProperties = {
  color: 'var(--muted-foreground)',
  display: 'flex',
  flexDirection: 'column',
  fontSize: 9,
  gap: 5,
}

function iconButtonStyle(extra?: CSSProperties): CSSProperties {
  return {
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    borderRadius: 999,
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    display: 'flex',
    fontSize: 17,
    height: 28,
    justifyContent: 'center',
    padding: 0,
    width: 28,
    ...extra,
  }
}

function secondaryButton(disabled: boolean, extra?: CSSProperties): CSSProperties {
  return {
    background: 'var(--secondary)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    color: 'var(--secondary-foreground)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 10,
    opacity: disabled ? 0.45 : 1,
    padding: '7px 11px',
    ...extra,
  }
}
