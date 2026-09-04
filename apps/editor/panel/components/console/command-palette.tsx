'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import { useModalFocus } from '@panel/components/ui/modal-focus'
import type { UsersListResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { CONSOLE_TABS, type ConsoleTab, TAB_META, tabLabel } from '@panel/lib/console-tabs'
import { useEscapeLayer } from '@panel/lib/escape-layers'
import type { SessionUser } from '@panel/lib/types'
import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface Item {
  id: string
  label: string
  hint: string
  run: () => void
}

interface Group {
  label: string
  items: Item[]
}

/** Per group, as the prototype does — a palette that scrolls has stopped helping. */
const MAX_PER_GROUP = 8
/** Long enough that typing a name does not fire a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 180

/**
 * ⌘K / Ctrl+K command palette.
 *
 * Three groups, matching the prototype: every tab, the handful of actions worth
 * reaching by name, and a live user search. Two rules the prototype could not
 * enforce and this one does:
 *
 * - Nothing appears that the signed-in role cannot do. The palette is a
 *   shortcut, not a second way in: a tab hidden from the rail is hidden here,
 *   and "Invite a user" only shows with `edit_users`.
 * - Matching is locale-aware. `toLowerCase()` maps İ to "i̇" (i plus a combining
 *   dot) and I to "i", so a Turkish user searching "izmir" would miss "İzmir"
 *   and searching "ısparta" would miss "Isparta".
 */
export function CommandPalette({
  user,
  open,
  onClose,
}: {
  user: SessionUser
  open: boolean
  onClose: () => void
}) {
  const { t, lang, themeChoice, setThemeChoice } = useApp()
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [people, setPeople] = useState<UsersListResponse['users']>([])
  const panelRef = useRef<HTMLDivElement>(null)

  useEscapeLayer(open, onClose)
  useModalFocus(panelRef, open)

  // A palette that reopens showing the last search is a palette that acts on
  // stale intent the first time you press Enter.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    setPeople([])
  }, [open])

  const can = useCallback(
    (permission: string) => user.permissions.includes(permission as never),
    [user],
  )

  const go = useCallback(
    (tab: ConsoleTab, query?: Record<string, string>) => {
      onClose()
      const search = query ? `?${new URLSearchParams(query)}` : ''
      router.push(`/console/${tab}${search}`)
    },
    [onClose, router],
  )

  /**
   * Live user lookup, so the group is not capped at whatever the first page
   * held. No permission gate: the Users tab carries none either, and the
   * endpoint decides for itself what the caller may see. (An earlier draft
   * gated this on `view_users`, which is not one of the nine permissions the
   * contract defines — so the group silently never appeared.)
   */
  useEffect(() => {
    if (!open) return
    const term = query.trim()
    if (term.length < 2) {
      setPeople([])
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ search: term, pageSize: String(MAX_PER_GROUP), lang })
      const res = await call<UsersListResponse>(`/api/users?${params}`)
      if (!cancelled && res.ok) setPeople(res.data.users)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, lang])

  const groups = useMemo<Group[]>(() => {
    const fold = (value: string) => value.toLocaleLowerCase(lang === 'tr' ? 'tr-TR' : 'en-GB')
    const needle = fold(query.trim())
    const matches = (item: Item) => !needle || fold(`${item.label} ${item.hint}`).includes(needle)

    const tabs: Item[] = CONSOLE_TABS.filter((tab) => {
      const permission = TAB_META[tab].permission
      return !permission || user.permissions.includes(permission)
    }).map((tab) => ({
      id: `tab:${tab}`,
      label: tabLabel(t, tab),
      hint: t.c.goTo,
      run: () => go(tab),
    }))

    const actions: Item[] = []
    if (can('edit_users')) {
      actions.push({
        id: 'act:invite',
        label: t.cpInvite,
        hint: t.c.users,
        run: () => go('users', { new: '1' }),
      })
    }
    if (can('edit_roles')) {
      actions.push({ id: 'act:role', label: t.cpNewRole, hint: t.c.roles, run: () => go('roles') })
    }
    // Same three-state cycle as the header button and the Appearance row —
    // a palette action that only flipped light/dark could not get back to
    // "system", which is the default the rest of the app respects.
    const nextChoice =
      themeChoice === 'system' ? 'light' : themeChoice === 'light' ? 'dark' : 'system'
    actions.push({
      id: 'act:theme',
      label:
        nextChoice === 'system'
          ? t.seSystem
          : nextChoice === 'light'
            ? t.cpThemeLight
            : t.cpThemeDark,
      hint: t.seAppearance,
      run: () => {
        setThemeChoice(nextChoice)
        onClose()
      },
    })
    if (can('view_logs')) {
      actions.push({
        id: 'act:logs',
        label: t.cpClearLogs,
        hint: t.c.diagnostics,
        run: () => go('logs'),
      })
    }
    actions.push({
      id: 'act:signout',
      label: t.c.signOut,
      hint: t.c.sessions,
      run: () => {
        onClose()
        router.push('/signin')
      },
    })

    const persons: Item[] = people.map((person) => ({
      id: `user:${person.id}`,
      label: `${person.name} — ${person.role}`,
      hint: person.email.split('@')[0] ?? '',
      run: () => go('users', { q: person.name }),
    }))

    return [
      { label: t.c.goTo, items: tabs.filter(matches) },
      { label: t.cpActions, items: actions.filter(matches) },
      // Already filtered by the server; filtering again would drop matches on
      // fields the query hit but the label does not show.
      { label: t.c.users, items: persons },
    ]
      .map((group) => ({ ...group, items: group.items.slice(0, MAX_PER_GROUP) }))
      .filter((group) => group.items.length > 0)
  }, [
    query,
    lang,
    t,
    user.permissions,
    can,
    themeChoice,
    setThemeChoice,
    people,
    go,
    onClose,
    router,
  ])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const active = flat[Math.min(cursor, flat.length - 1)]

  // Typing narrows the list under the cursor; leaving it where it was would run
  // whatever happened to slide into that position.
  useEffect(() => {
    setCursor(0)
  }, [query, people])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => (flat.length === 0 ? 0 : (c + 1) % flat.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => (flat.length === 0 ? 0 : (c - 1 + flat.length) % flat.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      active?.run()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center px-6 pb-6 pt-[88px] backdrop-blur-[3px]"
      style={{ background: 'rgba(0,0,0,0.55)', animation: 'dtFade 0.14s ease' }}
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.a11yPalette}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-[12px] border border-border bg-popover shadow-e4 outline-none"
        style={{ animation: 'dtDrop 0.16s ease' }}
      >
        <div className="flex items-center gap-[10px] border-b border-border px-[14px]">
          <Search className="h-[15px] w-[15px] shrink-0 text-muted-fg" strokeWidth={2.2} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.cpPlaceholder}
            aria-label={t.cpPlaceholder}
            // The list is the listbox; the input keeps focus and drives it.
            role="combobox"
            aria-expanded
            aria-controls="dt-palette-list"
            aria-activedescendant={active ? `dt-cmd-${active.id}` : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none"
          />
          <Caps className="shrink-0 rounded-[4px] bg-hover px-[5px] py-px font-mono text-[9px] text-muted-fg">
            ESC
          </Caps>
        </div>

        <div id="dt-palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-1">
          {flat.length === 0 ? (
            <p className="m-0 px-3 py-8 text-center text-[12.5px] text-muted-fg">{t.cpEmpty}</p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="flex flex-col gap-px py-1">
                <Caps className="px-2 py-[5px] font-mono text-[8.5px] tracking-[0.14em] text-muted-fg">
                  {group.label}
                </Caps>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    id={`dt-cmd-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={item.id === active?.id}
                    // Pointer and keyboard share one cursor, so hovering never
                    // disagrees with what Enter is about to do.
                    onMouseEnter={() => setCursor(flat.findIndex((f) => f.id === item.id))}
                    onClick={item.run}
                    className={cn(
                      'flex w-full items-center gap-[10px] rounded-[8px] px-2 py-2 text-left text-[13px] text-fg',
                      item.id === active?.id ? 'bg-hover' : 'bg-transparent',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-fg">
                      {item.hint}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
