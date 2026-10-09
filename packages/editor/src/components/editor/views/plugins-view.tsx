'use client'

import { useScene } from '@pascal-app/core'
import {
  Check,
  ChevronRight,
  Coins,
  ExternalLink,
  Image,
  Link2,
  Lock,
  type LucideIcon,
  Map as MapIcon,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  type EditorHostPanel,
  editorHostPanelRegistry,
  type PluginAccess,
  type PluginDirectoryContext,
  type PluginInstallLock,
  pluginDirectoryContext,
  pluginInstallLocks,
} from '../../../lib/plugin-panels'
import { cn } from '../../../lib/utils'
import { IconRefGlyph } from '../../ui/icon-ref'
import { Button } from '../../ui/primitives/button'

const PLUGIN_AUTHORING_URL = 'https://editor.pascal.app/docs/developers/plugins'
const OTHER_CATEGORY = 'Other'
/** Below this width the categories fold into a select and the detail floats over the list. */
const WIDE = 900

const ACCESS_ICON: Record<PluginAccess['kind'], LucideIcon> = {
  ai: Sparkles,
  media: Image,
  data: MapIcon,
  account: Link2,
  sharing: Users,
}

type PluginEntry = {
  id: string
  panel: EditorHostPanel
  category: string
  installed: boolean
}

type Status = 'all' | 'installed' | 'available'

function useRegistry<T>(store: {
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => T
}) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(WIDE)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function usesCredits(panel: EditorHostPanel) {
  return panel.access?.some((access) => access.usesCredits) ?? false
}

function creditsLabel(credits: PluginDirectoryContext['credits']) {
  if (!credits) return null
  return 'unlimited' in credits
    ? 'Unlimited'
    : `${Math.ceil(credits.remaining).toLocaleString('en-US')} left`
}

function PluginIcon({ panel, size }: { panel: EditorHostPanel; size: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-border/60 bg-background/60',
        size === 'md' ? 'h-11 w-11 rounded-xl' : 'h-14 w-14 rounded-2xl',
      )}
    >
      <IconRefGlyph icon={panel.icon} size={size === 'md' ? 28 : 36} />
    </span>
  )
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-[5px] border border-border px-1.5 py-px font-mono font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
      {label}
    </span>
  )
}

function StatusLine({ entry, projectName }: { entry: PluginEntry; projectName?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
      {entry.installed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/80" />}
      <span className="truncate">
        {entry.installed
          ? projectName
            ? `Installed in ${projectName}`
            : 'Installed'
          : 'Not installed'}{' '}
        · {entry.category}
      </span>
    </span>
  )
}

function AccessChips({ panel }: { panel: EditorHostPanel }) {
  const chips = new Map<string, LucideIcon>()
  for (const access of panel.access ?? []) {
    if (access.usesCredits) chips.set('Uses credits', Coins)
    else chips.set(access.chip ?? access.label, ACCESS_ICON[access.kind])
  }
  if (chips.size === 0) chips.set('No services or credits', Check)
  return (
    <>
      {[...chips].map(([label, Glyph]) => (
        <span
          className="inline-flex h-6 items-center gap-1.5 rounded-[7px] bg-accent/60 px-2 text-muted-foreground text-xs"
          key={label}
        >
          <Glyph className="h-3.5 w-3.5" />
          {label}
        </span>
      ))}
    </>
  )
}

function PluginCard({
  entry,
  selected,
  lock,
  readOnly,
  onOpen,
  onInstall,
}: {
  entry: PluginEntry
  selected: boolean
  lock?: PluginInstallLock
  readOnly: boolean
  onOpen: () => void
  onInstall: () => void
}) {
  const { panel } = entry
  return (
    <div
      aria-label={panel.label}
      className={cn(
        'grid min-h-44 cursor-pointer grid-rows-[auto_1fr_auto] gap-3 rounded-2xl border bg-background/40 p-4 text-left transition-colors',
        selected
          ? 'border-primary ring-[3px] ring-primary/20'
          : 'border-border/60 hover:border-border hover:bg-background/60',
      )}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex min-w-0 items-center gap-3">
        <PluginIcon panel={panel} size="md" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-[14.5px] text-foreground">
            <span className="truncate">{panel.label}</span>
            {panel.badge && <Badge label={panel.badge} />}
          </div>
          <StatusLine entry={entry} />
        </div>
      </div>
      <p className="line-clamp-2 text-foreground/80 text-sm">
        {panel.summary ?? panel.description ?? 'Adds a new tool panel to the editor.'}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <AccessChips panel={panel} />
        {entry.installed ? (
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground text-xs">
            Manage
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        ) : (
          <Button
            className="ml-auto h-7 rounded-full px-3"
            disabled={readOnly && !lock}
            onClick={(event) => {
              event.stopPropagation()
              if (lock) lock.onAction()
              else onInstall()
            }}
            size="sm"
            variant="outline"
          >
            {lock ? lock.actionLabel : 'Install'}
          </Button>
        )}
      </div>
    </div>
  )
}

function PluginDetail({
  entry,
  context,
  lock,
  readOnly,
  floating,
  onClose,
  onToggle,
}: {
  entry: PluginEntry
  context: PluginDirectoryContext
  lock?: PluginInstallLock
  readOnly: boolean
  floating: boolean
  onClose: () => void
  onToggle: () => void
}) {
  const { panel } = entry
  const credits = creditsLabel(context.credits)
  return (
    <aside
      aria-label={`${panel.label} details`}
      className={cn(
        'flex w-[360px] shrink-0 flex-col gap-5 overflow-y-auto border-border/60 border-l bg-sidebar p-5',
        floating && 'absolute inset-y-0 right-0 z-10 max-w-full shadow-2xl',
      )}
    >
      <div className="flex items-start gap-3.5">
        <PluginIcon panel={panel} size="lg" />
        <div className="min-w-0 pt-0.5">
          <h3 className="flex items-center gap-2 font-semibold text-foreground text-lg">
            {panel.label}
            {panel.badge && <Badge label={panel.badge} />}
          </h3>
          <StatusLine entry={entry} projectName={context.projectName} />
        </div>
        <button
          aria-label="Close details"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {lock && !entry.installed ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-start gap-2 text-muted-foreground text-sm">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {lock.reason}
          </p>
          <Button className="h-10 rounded-full" onClick={lock.onAction}>
            {lock.actionLabel}
          </Button>
        </div>
      ) : (
        <Button
          className="h-10 rounded-full"
          disabled={readOnly}
          onClick={onToggle}
          variant={entry.installed ? 'outline' : 'default'}
        >
          {entry.installed ? (
            'Uninstall'
          ) : (
            <>
              <Check />
              {context.projectName ? `Install in ${context.projectName}` : 'Install'}
            </>
          )}
        </Button>
      )}

      <section>
        <h4 className="mb-2 font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.08em]">
          About
        </h4>
        <p className="text-foreground/90 text-sm leading-relaxed">
          {panel.description ?? panel.summary ?? 'Adds a new tool panel to the editor.'}
        </p>
      </section>

      <section>
        <h4 className="mb-2 font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.08em]">
          Can access
        </h4>
        {panel.access?.length ? (
          <ul className="overflow-hidden rounded-xl border border-border/60">
            {panel.access.map((access) => {
              const Glyph = ACCESS_ICON[access.kind]
              return (
                <li
                  className="flex gap-3 border-border/60 border-t px-3.5 py-3 first:border-t-0"
                  key={access.label}
                >
                  <Glyph className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm">{access.label}</p>
                    <p className="text-muted-foreground text-xs leading-relaxed">{access.detail}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-border/60 border-dashed px-3.5 py-3 text-muted-foreground text-sm">
            Runs in the editor. No Pascal services, no outside accounts.
          </p>
        )}
      </section>

      <section>
        <h4 className="mb-2 font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.08em]">
          Credits
        </h4>
        <div className="flex items-center gap-2.5 rounded-xl bg-accent/60 px-3.5 py-3 text-sm">
          <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            {usesCredits(panel)
              ? context.projectName
                ? `Spends ${context.projectName} credits`
                : "Spends this project's credits"
              : "Doesn't spend credits"}
          </span>
          {credits && (
            <span className="ml-auto font-mono text-muted-foreground text-xs tabular-nums">
              {credits}
            </span>
          )}
        </div>
      </section>

      {(panel.creator || panel.pluginUrl) && (
        <section className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
          {panel.creator &&
            (panel.creator.url ? (
              <a
                className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
                href={panel.creator.url}
                rel="noreferrer"
                target="_blank"
              >
                By {panel.creator.name}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span>By {panel.creator.name}</span>
            ))}
          {panel.pluginUrl && (
            <a
              className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
              href={panel.pluginUrl}
              rel="noreferrer"
              target="_blank"
            >
              View plugin
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </section>
      )}
    </aside>
  )
}

/**
 * The plugin directory: categories, search and an installed/available filter
 * over the plugins the host registered, a card per plugin and a detail with
 * what it can reach before you install it. A view of its own, so it has the
 * room to read like one.
 */
export function PluginsView() {
  const panels = useRegistry(editorHostPanelRegistry)
  const installLocks = useRegistry(pluginInstallLocks)
  const context = useRegistry(pluginDirectoryContext)
  const installedPlugins = useScene((state) => state.installedPlugins)
  const setInstalledPlugins = useScene((state) => state.setInstalledPlugins)
  const readOnly = useScene((state) => state.readOnly)
  const [rootRef, width] = useWidth<HTMLDivElement>()
  const wide = width >= WIDE

  const [category, setCategory] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ id: string; installed: boolean } | null>(null)

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(timer)
  }, [undo])

  // One entry per plugin: a plugin can register several panels, the first carries its card.
  const entries: PluginEntry[] = Array.from(
    new Map(
      panels.filter((panel) => panel.pluginId).map((panel) => [panel.pluginId as string, panel]),
    ),
  )
    .map(([id, panel]) => ({
      id,
      panel,
      category: panel.category ?? OTHER_CATEGORY,
      installed: installedPlugins.includes(id),
    }))
    .sort((a, b) => a.panel.label.localeCompare(b.panel.label))

  const categories = Array.from(new Set(entries.map((entry) => entry.category))).sort((a, b) =>
    a === OTHER_CATEGORY ? 1 : b === OTHER_CATEGORY ? -1 : a.localeCompare(b),
  )
  const inCategory = entries.filter((entry) => !category || entry.category === category)
  const needle = query.trim().toLowerCase()
  const shown = inCategory.filter(
    (entry) =>
      !needle ||
      `${entry.panel.label} ${entry.panel.summary ?? ''} ${entry.panel.description ?? ''} ${entry.category}`
        .toLowerCase()
        .includes(needle),
  )
  const installed = shown.filter((entry) => entry.installed)
  const available = shown.filter((entry) => !entry.installed)
  const selected = entries.find((entry) => entry.id === selectedId)

  const setInstalled = (id: string, next: boolean, remember = true) => {
    const current = useScene.getState().installedPlugins
    setInstalledPlugins(
      next
        ? [...current.filter((pluginId) => pluginId !== id), id]
        : current.filter((pluginId) => pluginId !== id),
      { explicit: true },
    )
    setSelectedId(id)
    setUndo(remember ? { id, installed: next } : null)
  }

  const statusOptions: [Status, string, number][] = [
    ['all', 'All', inCategory.length],
    ['installed', 'Installed', inCategory.filter((entry) => entry.installed).length],
    ['available', 'Available', inCategory.filter((entry) => !entry.installed).length],
  ]

  const renderSection = (title: string, list: PluginEntry[], aside?: string) =>
    list.length > 0 && (
      <section className="mt-7 first:mt-0">
        <div className="mb-3 flex items-baseline gap-2.5">
          <h2 className="font-semibold text-[15px] text-foreground">{title}</h2>
          <span className="font-mono text-muted-foreground text-xs">{list.length}</span>
          {aside && <span className="ml-auto text-muted-foreground text-xs">{aside}</span>}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {list.map((entry) => (
            <PluginCard
              entry={entry}
              key={entry.id}
              lock={entry.installed ? undefined : installLocks[entry.id]}
              onInstall={() => setInstalled(entry.id, true)}
              onOpen={() => setSelectedId(entry.id)}
              readOnly={readOnly}
              selected={entry.id === selectedId}
            />
          ))}
        </div>
      </section>
    )

  const undoEntry = undo && entries.find((entry) => entry.id === undo.id)

  return (
    <div
      className="relative flex h-full min-h-0 bg-sidebar text-sidebar-foreground"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedId) setSelectedId(null)
      }}
      ref={rootRef}
    >
      {wide && (
        <nav
          aria-label="Plugin categories"
          className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-border/60 border-r px-3.5 py-6"
        >
          <h4 className="mx-2.5 mb-1.5 font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.08em]">
            Browse
          </h4>
          {[null, ...categories].map((name) => {
            const count = name
              ? entries.filter((entry) => entry.category === name).length
              : entries.length
            return (
              <button
                aria-pressed={category === name}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors',
                  category === name
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
                key={name ?? 'all'}
                onClick={() => setCategory(name)}
                type="button"
              >
                <span className="flex-1 truncate">{name ?? 'All plugins'}</span>
                <span className="font-mono text-muted-foreground text-xs">{count}</span>
              </button>
            )
          })}
          <div className="mt-auto flex flex-col gap-2 border-border/60 border-t px-2.5 pt-3.5 text-muted-foreground text-xs leading-relaxed">
            {context.notes?.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <a
              className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline"
              href={PLUGIN_AUTHORING_URL}
              rel="noreferrer"
              target="_blank"
            >
              Create a Pascal plugin
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </nav>
      )}

      <main className={cn('min-w-0 flex-1 overflow-y-auto pt-7 pb-12', wide ? 'px-8' : 'px-5')}>
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div className={cn('min-w-0', wide ? 'flex-1' : 'basis-full')}>
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">Plugins</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Add focused tools and content to {context.projectName ?? 'this project'}.
            </p>
          </div>
          {!wide && categories.length > 1 && (
            <select
              aria-label="Category"
              className="h-9 rounded-lg border border-border bg-accent/40 px-2.5 text-sm"
              onChange={(event) => setCategory(event.target.value || null)}
              value={category ?? ''}
            >
              <option value="">All plugins</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <label className="flex h-9 w-64 max-w-full items-center gap-2 rounded-lg border border-border bg-accent/40 px-3 text-muted-foreground focus-within:border-foreground/30">
            <Search className="h-4 w-4 shrink-0" />
            <input
              aria-label="Search plugins"
              className="min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search plugins"
              type="search"
              value={query}
            />
          </label>
          <div className="inline-flex gap-0.5 rounded-[10px] bg-accent/40 p-[3px]" role="group">
            {statusOptions.map(([id, label, count]) => (
              <button
                aria-pressed={status === id}
                className={cn(
                  'inline-flex h-[30px] items-center gap-1.5 rounded-lg px-3 font-medium text-sm transition-colors',
                  status === id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                key={id}
                onClick={() => setStatus(id)}
                type="button"
              >
                {label}
                <span className="font-mono text-muted-foreground text-xs">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {installed.length + available.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground text-sm">
            {needle
              ? `No plugins match “${query.trim()}”${category ? ` in ${category}` : ''}.`
              : 'No plugins here yet.'}
          </p>
        ) : (
          <>
            {status !== 'available' && renderSection('In this project', installed)}
            {status !== 'installed' && renderSection('Available', available, 'Installing is free')}
          </>
        )}
      </main>

      {selected && (
        <PluginDetail
          context={context}
          entry={selected}
          floating={!wide}
          lock={installLocks[selected.id]}
          onClose={() => setSelectedId(null)}
          onToggle={() => setInstalled(selected.id, !selected.installed)}
          readOnly={readOnly}
        />
      )}

      {undoEntry && (
        <div
          className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-border bg-popover py-1.5 pr-1.5 pl-4 text-sm shadow-2xl"
          role="status"
        >
          <span>
            {undoEntry.panel.label} {undo.installed ? 'installed' : 'uninstalled'}
          </span>
          <button
            className="h-8 rounded-lg px-2.5 font-semibold transition-colors hover:bg-accent"
            onClick={() => setInstalled(undo.id, !undo.installed, false)}
            type="button"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
