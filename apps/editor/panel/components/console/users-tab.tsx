'use client'

import { useApp } from '@panel/components/app-providers'
import { AssignDialog } from '@panel/components/console/assign-dialog'
import { InviteForm } from '@panel/components/console/invite-form'
import { UserDrawer } from '@panel/components/console/user-drawer'
import { Caps } from '@panel/components/ui/caps'
import { Button, SegBar, SegButton } from '@panel/components/ui/controls'
import { Dialog, Toast } from '@panel/components/ui/feedback'
import type {
  BulkUsersResponse,
  PendingRequestsResponse,
  UsersListResponse,
} from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { useBreakpoint } from '@panel/lib/hooks/use-breakpoint'
import { type Dictionary, format, resolveApiMessage } from '@panel/lib/i18n'
import type { AccessRequest, UserV3 } from '@panel/lib/types'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Search,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

type SortKey = 'name' | 'email' | 'username' | 'role' | 'status'
type ListState = 'loading' | 'ready' | 'error'

/** Desktop grid: name, email, username, role, 2FA, status, actions. */
const COLS = 'minmax(150px,1.4fr) minmax(190px,1.7fr) minmax(104px,0.9fr) 96px 44px 92px 150px'

/** The same grid with a leading checkbox column, used when selection is on. */
const COLS_SELECTABLE = `26px ${COLS}`

type BulkAction = 'roleViewer' | 'revokeSessions' | 'deactivate' | 'delete'

export function UsersTab() {
  const { t, lang } = useApp()
  const { isMobile } = useBreakpoint()

  const [state, setState] = useState<ListState>('loading')
  const [data, setData] = useState<UsersListResponse | null>(null)
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [errorText, setErrorText] = useState<string | null>(null)

  const [roleFilter, setRoleFilter] = useState('All')
  const [sort, setSort] = useState<SortKey>('name')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  /**
   * The command palette lands here with what it matched: `?q=` seeds the search
   * box, `?new=1` opens the invite form. Read once — after that the tab owns its
   * own state, or typing in the box would fight the URL on every render.
   */
  const params = useSearchParams()
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  const [inviting, setInviting] = useState(() => params.get('new') === '1')
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [approving, setApproving] = useState<AccessRequest | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  /**
   * Selection is scoped to the page you can see.
   *
   * Carrying it across pages would let one click act on accounts that scrolled
   * out of view several filter changes ago — the count in the confirmation would
   * be honest and still be a surprise. Any change to the query clears it.
   */
  const [selected, setSelected] = useState<string[]>([])
  const [bulk, setBulk] = useState<BulkAction | null>(null)
  const [confirmCount, setConfirmCount] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 2600)
  }, [])

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'))
    const params = new URLSearchParams({
      search,
      role: roleFilter,
      sort,
      direction,
      page: String(page),
      pageSize: String(pageSize),
      lang,
    })
    const res = await call<UsersListResponse>(`/api/users?${params}`)
    if (!res.ok) {
      setErrorText(resolveApiMessage(t, res.messageKey))
      setState('error')
      return
    }
    setData(res.data)
    setState('ready')
  }, [search, roleFilter, sort, direction, page, pageSize, lang, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void call<PendingRequestsResponse>('/api/requests').then((res) => {
      if (res.ok) setRequests(res.data.requests)
    })
  }, [])

  // Filter and sort changes reset to page 1 — otherwise a narrowed result set
  // leaves you stranded on a page that no longer exists.
  useEffect(() => {
    setPage(1)
  }, [search, roleFilter, sort, direction, pageSize])

  // Anything that changes which rows are on screen drops the selection.
  useEffect(() => {
    setSelected([])
  }, [search, roleFilter, sort, direction, page, pageSize])

  const users = data?.users ?? []
  const canEdit = data?.canEdit ?? false
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const selectable = canEdit && state === 'ready' && users.length > 0
  const selectedOnPage = useMemo(
    () => selected.filter((id) => users.some((u) => u.id === id)),
    [selected, users],
  )
  const allSelected = users.length > 0 && selectedOnPage.length === users.length
  const cols = selectable ? COLS_SELECTABLE : COLS

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.length === users.length ? [] : users.map((u) => u.id)))
  }, [users])

  const runBulk = useCallback(async () => {
    if (!bulk) return
    setBulkBusy(true)
    const res = await call<BulkUsersResponse>('/api/users/bulk', {
      body: { action: bulk, ids: selectedOnPage },
    })
    setBulkBusy(false)
    setBulk(null)
    setConfirmCount('')

    if (!res.ok) {
      notify(resolveApiMessage(t, res.messageKey), 'error')
      return
    }

    setSelected([])
    void load()

    // The server decides what it actually touched, and the toast reports that
    // rather than the number the user selected. Reporting the selection back
    // would claim work the primary-admin and self rules refused to do.
    const { applied, skipped } = res.data
    if (applied === 0 && skipped.length > 0) {
      notify(t.bulkNothing, 'error')
      return
    }
    const reasons = new Set(skipped.map((s) => reasonLabel(t, s.reason)))
    const detail = skipped.length
      ? ` · ${format(t.bulkSkipped, { count: skipped.length })} (${[...reasons].join(', ')})`
      : ''
    notify(`${format(t.bulkApplied, { count: applied })}${detail}`)
  }, [bulk, selectedOnPage, notify, t, load])

  const countLabel = useMemo(() => {
    if (state === 'loading') return `${t.c.search}…`
    if (state === 'error') return t.loadFailedTitle
    const parts = [`${total} ${t.c.of} ${data?.totalUnfiltered ?? 0} ${t.c.accounts}`]
    if (data?.without2fa) parts.push(`${data.without2fa} ${t.c.without2fa}`)
    return parts.join(' · ')
  }, [state, total, data, t])

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      setDirection('asc')
    }
  }

  const headers: Array<{ key: SortKey | null; label: string }> = [
    { key: 'name', label: t.c.colUser },
    { key: 'email', label: t.c.colEmail },
    { key: 'username', label: t.c.colUsername },
    { key: 'role', label: t.c.colRole },
    { key: null, label: t.c.col2fa },
    { key: 'status', label: t.c.colStatus },
    { key: null, label: t.colInvite },
  ]

  const decideRequest = useCallback(
    async (request: AccessRequest, decision: 'reject') => {
      const res = await call(`/api/requests/${request.id}/${decision}`, { body: {} })
      if (!res.ok) {
        notify(resolveApiMessage(t, res.messageKey), 'error')
        return
      }
      setRequests((prev) => prev.filter((r) => r.id !== request.id))
    },
    [notify, t],
  )

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.userAccounts}</h2>
          <p className="m-0 text-xs text-muted-fg">{countLabel}</p>
        </div>

        <div className="flex flex-wrap items-center gap-[7px]">
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-[9px] h-3 w-3 text-muted-fg"
              strokeWidth={2.2}
            />
            <input
              type="text"
              placeholder={t.c.userSearchPh}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-[30px] w-[196px] min-w-0 rounded-[8px] border border-input bg-field pl-[26px] pr-[10px] text-xs text-fg outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--dt-hover)]"
            />
          </div>

          <SegBar>
            {['All', ...(data?.roles ?? [])].map((role) => (
              <SegButton
                key={role}
                active={roleFilter === role}
                onClick={() => setRoleFilter(role)}
              >
                {role === 'All' ? t.c.filterAll : role}
              </SegButton>
            ))}
          </SegBar>

          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setInviting((v) => !v)}
            className="h-[30px] shrink-0 rounded-[8px] bg-primary px-[13px] text-xs font-semibold text-primary-fg shadow-e2 hover:opacity-92"
          >
            {inviting ? t.c.closeForm : t.c.addUser}
          </button>
        </div>
      </header>

      {state === 'ready' && !canEdit ? (
        <div className="flex min-w-0 items-center gap-[9px] rounded-[10px] border border-border bg-surface px-3 py-2">
          <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-destructive" />
          <span className="shrink-0 text-[11.5px] font-semibold">{t.c.readOnly}</span>
          <span className="min-w-0 text-[11.5px] text-muted-fg text-pretty">
            {t.c.readOnlyLead}
          </span>
        </div>
      ) : null}

      {requests.length > 0 ? (
        <div className="min-w-0 overflow-hidden rounded-[12px] border border-brand bg-surface">
          <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2">
            <span
              className="h-[5px] w-[5px] shrink-0 rounded-full bg-brand"
              style={{ animation: 'dtPulse 2s ease infinite' }}
            />
            <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
              {`${requests.length} ${t.c.requestsAwaiting}`}
            </Caps>
          </div>
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex min-w-0 flex-wrap items-center gap-[11px] border-b border-border-soft px-3 py-[10px] last:border-b-0"
            >
              <div className="flex min-w-[150px] flex-1 flex-col gap-[2px]">
                <span className="truncate text-[12.5px] font-medium">{request.fullName}</span>
                <span className="truncate font-mono text-[10px] text-muted-fg">
                  {request.email} · {request.department} · {request.requestedRole}
                </span>
              </div>
              <span className="min-w-[140px] flex-1 text-[11.5px] text-muted-fg text-pretty">
                {request.note ?? ''}
              </span>
              <div className="flex shrink-0 items-center gap-[6px]">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setApproving(request)}
                  className="h-[26px] rounded-[6px] bg-primary px-[10px] text-[11px] font-semibold text-primary-fg hover:opacity-92"
                >
                  {t.c.approveAs} {request.requestedRole}
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => void decideRequest(request, 'reject')}
                  className="h-[26px] rounded-[6px] border border-destructive bg-transparent px-[10px] text-[11px] text-destructive hover:bg-hover"
                >
                  {t.c.reject}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {inviting ? (
        <InviteForm
          roles={data?.roles ?? []}
          sites={data?.sites ?? []}
          onCancel={() => setInviting(false)}
          onCreated={(user) => {
            setInviting(false)
            notify(`${user.email} ${t.invitedToast}`)
            void load()
          }}
          onError={(message) => notify(message, 'error')}
        />
      ) : null}

      {selectedOnPage.length > 0 ? (
        <div
          role="toolbar"
          aria-label={t.bulkClear}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-[10px] border border-brand bg-surface px-3 py-[7px]"
          style={{ animation: 'dtDrop 0.14s ease' }}
        >
          <span className="shrink-0 text-[11.5px] font-semibold">
            {format(t.bulkSelected, { count: selectedOnPage.length, total: users.length })}
          </span>
          <span className="h-[14px] w-px shrink-0 bg-border" />

          {(
            [
              ['roleViewer', t.bulkRoleViewer, false],
              ['revokeSessions', t.bulkRevoke, false],
              ['deactivate', t.bulkDeactivate, false],
              ['delete', t.bulkDelete, true],
            ] as Array<[BulkAction, string, boolean]>
          ).map(([action, label, danger]) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                setBulk(action)
                setConfirmCount('')
              }}
              className={cn(
                'h-[26px] shrink-0 rounded-[6px] border bg-field px-[10px] text-[11.5px] font-medium hover:bg-hover',
                danger ? 'border-destructive text-destructive' : 'border-border text-fg',
              )}
            >
              {label}
            </button>
          ))}

          <span className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => setSelected([])}
            className="h-[26px] shrink-0 rounded-[6px] bg-transparent px-[9px] text-[11.5px] text-muted-fg hover:text-fg"
          >
            {t.bulkClear}
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          'min-w-0 rounded-[12px] border border-border',
          isMobile ? 'overflow-hidden' : 'overflow-x-auto',
        )}
      >
        {!isMobile ? (
          <div
            className="grid h-[31px] items-center gap-[10px] border-b border-border bg-surface px-3 font-mono text-[8.5px] tracking-[0.12em] text-muted-fg"
            style={{ gridTemplateColumns: cols, minWidth: selectable ? 926 : 900 }}
          >
            {selectable ? (
              <input
                type="checkbox"
                checked={allSelected}
                // Some-but-not-all reads as a dash rather than a tick, so the
                // header never claims a state the page is not in.
                ref={(el) => {
                  if (el) el.indeterminate = selectedOnPage.length > 0 && !allSelected
                }}
                onChange={toggleAll}
                aria-label={t.bulkSelectAll}
                className="h-[13px] w-[13px] cursor-pointer"
                style={{ accentColor: 'var(--dt-brand)' }}
              />
            ) : null}
            {headers.map((header, index) => (
              <button
                key={`${header.label}-${index}`}
                type="button"
                disabled={header.key === null}
                onClick={() => header.key && toggleSort(header.key)}
                className="flex items-center gap-1 bg-transparent text-left disabled:opacity-100"
              >
                <Caps>{header.label}</Caps>
                {header.key && sort === header.key ? (
                  direction === 'asc' ? (
                    <ChevronUp
                      className="h-[10px] w-[10px] shrink-0 text-brand-fg"
                      strokeWidth={3}
                    />
                  ) : (
                    <ChevronDown
                      className="h-[10px] w-[10px] shrink-0 text-brand-fg"
                      strokeWidth={3}
                    />
                  )
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {state === 'loading' ? <SkeletonRows isMobile={isMobile} /> : null}

        {state === 'error' ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10">
            <AlertTriangle className="h-[22px] w-[22px] text-destructive" strokeWidth={1.7} />
            <span className="text-[12.5px] font-semibold">{t.loadFailedTitle}</span>
            <span className="max-w-[340px] text-center text-[11.5px] text-muted-fg text-pretty">
              {errorText ?? t.loadFailedLead}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-1 h-7 rounded-[8px] border border-input bg-field px-3 text-[11.5px] font-medium text-fg hover:bg-hover"
            >
              {t.retry}
            </button>
          </div>
        ) : null}

        {state === 'ready' && users.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10">
            <Search className="h-[22px] w-[22px] text-muted-fg" strokeWidth={1.6} />
            <span className="text-[12.5px] font-semibold">{t.noUsersMatch}</span>
            <span className="text-center text-[11.5px] text-muted-fg">{t.emptyHint}</span>
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setRoleFilter('All')
              }}
              className="mt-1 h-7 rounded-[8px] border border-input bg-field px-3 text-[11.5px] font-medium text-fg hover:bg-hover"
            >
              {t.clearFilters}
            </button>
          </div>
        ) : null}

        {state === 'ready' &&
          users.map((user) =>
            isMobile ? (
              <UserCard
                key={user.id}
                user={user}
                onOpen={() => setDrawerId(user.id)}
                selectable={selectable}
                checked={selected.includes(user.id)}
                onToggle={() => toggleOne(user.id)}
              />
            ) : (
              <UserRow
                key={user.id}
                user={user}
                onOpen={() => setDrawerId(user.id)}
                selectable={selectable}
                checked={selected.includes(user.id)}
                onToggle={() => toggleOne(user.id)}
              />
            ),
          )}

        {state === 'ready' && users.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2">
            <Caps className="whitespace-nowrap font-mono text-[9.5px] tracking-[0.08em] text-muted-fg">
              {`${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} ${t.c.of} ${total} ${t.c.accounts}`}
            </Caps>
            <span className="min-w-0 flex-1" />

            <div className="flex shrink-0 items-center gap-[6px]">
              <Caps className="font-mono text-[9px] tracking-[0.1em] text-muted-fg">
                {t.c.rows}
              </Caps>
              <SegBar>
                {[10, 20, 50].map((size) => (
                  <SegButton
                    key={size}
                    active={pageSize === size}
                    onClick={() => setPageSize(size)}
                  >
                    {String(size)}
                  </SegButton>
                ))}
              </SegBar>
            </div>

            <div className="flex shrink-0 items-center gap-[6px]">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-border bg-field text-fg hover:bg-hover"
                aria-label={t.a11yPrevPage}
              >
                <ChevronLeft className="h-3 w-3" strokeWidth={2.5} />
              </button>
              <span className="whitespace-nowrap font-mono text-[10.5px] text-fg">
                {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-border bg-field text-fg hover:bg-hover"
                aria-label={t.a11yNextPage}
              >
                <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {drawerId ? (
        <UserDrawer
          userId={drawerId}
          onClose={() => setDrawerId(null)}
          onChanged={() => void load()}
          notify={notify}
        />
      ) : null}

      {approving ? (
        <AssignDialog
          request={approving}
          roles={data?.roles ?? []}
          sites={data?.sites ?? []}
          onCancel={() => setApproving(null)}
          onDone={(email) => {
            setRequests((prev) => prev.filter((r) => r.id !== approving.id))
            setApproving(null)
            notify(`${email} ${t.invitedToast}`)
            void load()
          }}
          onError={(message) => notify(message, 'error')}
        />
      ) : null}

      {bulk ? (
        <Dialog
          role="alertdialog"
          labelledBy="dt-bulk-title"
          width={396}
          onClose={bulkBusy ? undefined : () => setBulk(null)}
        >
          <h2 id="dt-bulk-title" className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
            {format(t.bulkConfirmTitle, { count: selectedOnPage.length })}
          </h2>
          <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">
            {bulk === 'roleViewer'
              ? t.bulkRoleViewerLead
              : bulk === 'revokeSessions'
                ? t.bulkRevokeLead
                : bulk === 'deactivate'
                  ? t.bulkDeactivateLead
                  : t.bulkDeleteLead}
          </p>
          <p className="m-0 text-[11.5px] leading-[1.5] text-muted-fg text-pretty">
            {t.bulkSkipNote}
          </p>

          {/* Delete is the only irreversible one, so it asks for the count to be
              typed. A number rather than a word: it is the same in both
              languages, and it forces the user to read how many rows they
              picked before confirming. */}
          {bulk === 'delete' ? (
            <label className="flex flex-col gap-[6px]">
              <span className="text-[11.5px] text-muted-fg">
                {format(t.bulkTypeCount, { count: selectedOnPage.length })}
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={confirmCount}
                onChange={(e) => setConfirmCount(e.target.value)}
                className="h-[34px] rounded-[8px] border border-input bg-field px-[10px] font-mono text-[13px] text-fg outline-none focus:border-ring"
              />
            </label>
          ) : null}

          <div className="flex flex-col gap-[9px]">
            <Button
              variant={bulk === 'delete' || bulk === 'deactivate' ? 'destructive' : 'primary'}
              disabled={
                bulkBusy ||
                (bulk === 'delete' && confirmCount.trim() !== String(selectedOnPage.length))
              }
              onClick={() => void runBulk()}
            >
              {bulk === 'roleViewer'
                ? t.bulkRoleViewer
                : bulk === 'revokeSessions'
                  ? t.bulkRevoke
                  : bulk === 'deactivate'
                    ? t.bulkDeactivate
                    : t.bulkDelete}
            </Button>
            <Button variant="secondary" disabled={bulkBusy} onClick={() => setBulk(null)}>
              {t.cancel}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toLocaleUpperCase('tr')
}

function UserRow({
  user,
  onOpen,
  selectable,
  checked,
  onToggle,
}: {
  user: UserV3
  onOpen: () => void
  selectable: boolean
  checked: boolean
  onToggle: () => void
}) {
  const { t } = useApp()

  return (
    <div
      className={cn(
        'grid items-center gap-[10px] border-b border-border-soft px-3 py-[9px] last:border-b-0',
        checked && 'bg-hover',
      )}
      style={{
        gridTemplateColumns: selectable ? COLS_SELECTABLE : COLS,
        minWidth: selectable ? 926 : 900,
      }}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={format(t.bulkSelectOne, { name: user.name })}
          className="h-[13px] w-[13px] cursor-pointer"
          style={{ accentColor: 'var(--dt-brand)' }}
        />
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        title={t.a11yUserDetail}
        className="flex min-w-0 items-center gap-2 bg-transparent text-left hover:opacity-75"
      >
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-hover text-[9px] font-semibold text-fg">
          {initialsOf(user.name)}
        </span>
        <span className="truncate text-[12.5px] font-medium underline decoration-transparent underline-offset-[3px]">
          {user.name}
        </span>
        {user.org === 'external' ? (
          <Caps className="shrink-0 rounded-[4px] border border-border bg-field px-[5px] py-px font-mono text-[8px] tracking-[0.1em] text-muted-fg">
            {t.orgExternal.split(' ')[0] ?? t.orgExternal}
          </Caps>
        ) : null}
      </button>

      <span className="truncate font-mono text-[11px] text-muted-fg">{user.email}</span>
      <span className="truncate font-mono text-[11px] text-muted-fg">{user.username}</span>
      <span className="truncate text-[11.5px]">{user.role}</span>
      <span
        className={cn('font-mono text-[10px]', user.mfa === 'On' ? 'text-fg' : 'text-muted-fg')}
      >
        {user.mfa === 'On' ? t.c.mfaOn : t.c.mfaOff}
      </span>
      <StatusBadge user={user} />
      <InviteBadge user={user} />
    </div>
  )
}

/** Below 700 px the row becomes a labelled card — values never read unlabelled. */
function UserCard({
  user,
  onOpen,
  selectable,
  checked,
  onToggle,
}: {
  user: UserV3
  onOpen: () => void
  selectable: boolean
  checked: boolean
  onToggle: () => void
}) {
  const { t } = useApp()

  return (
    // The card used to be one big <button>. A checkbox cannot live inside a
    // button — clicking it would open the drawer — so the row is a flex
    // container now and only the text half is the button. Selection works the
    // same on a phone as it does on a desktop.
    <div
      className={cn(
        'flex items-start gap-2 border-b border-border-soft px-3 py-3 last:border-b-0',
        checked && 'bg-hover',
      )}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={format(t.bulkSelectOne, { name: user.name })}
          // 20 px on touch: the 13 px desktop box is under the minimum target.
          className="mt-[3px] h-5 w-5 shrink-0 cursor-pointer"
          style={{ accentColor: 'var(--dt-brand)' }}
        />
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-2 bg-transparent text-left"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-hover text-[10px] font-semibold text-fg">
            {initialsOf(user.name)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{user.name}</span>
          <StatusBadge user={user} />
        </div>
        <span className="w-full truncate font-mono text-[11px] text-muted-fg">{user.email}</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-fg">
          <span>
            {t.c.colUsername} <span className="font-mono text-fg">{user.username}</span>
          </span>
          <span>
            {t.c.colRole} <span className="text-fg">{user.role}</span>
          </span>
          <span>
            {t.c.col2fa}{' '}
            <span className="text-fg">{user.mfa === 'On' ? t.c.mfaOn : t.c.mfaOff}</span>
          </span>
        </div>
      </button>
    </div>
  )
}

/** Why the server left an account alone, in the reader's language. */
function reasonLabel(
  t: Dictionary,
  reason: BulkUsersResponse['skipped'][number]['reason'],
): string {
  switch (reason) {
    case 'primaryAdmin':
      return t.bulkReasonPrimaryAdmin
    case 'self':
      return t.bulkReasonSelf
    case 'notFound':
      return t.bulkReasonNotFound
    case 'noop':
      return t.bulkReasonNoop
  }
}

function StatusBadge({ user }: { user: UserV3 }) {
  const { t } = useApp()
  const label =
    user.status === 'Invited'
      ? t.invitedLbl
      : user.status === 'Active'
        ? t.c.statusActive
        : t.c.statusInactive

  return (
    <span
      className={cn(
        'flex w-fit shrink-0 items-center gap-[6px] rounded-[5px] border px-[6px] py-px text-[10.5px]',
        user.status === 'Invited'
          ? 'border-brand text-brand-fg'
          : user.status === 'Active'
            ? 'border-border text-fg'
            : 'border-border text-muted-fg',
      )}
    >
      <span
        className={cn(
          'h-[5px] w-[5px] rounded-full',
          user.status === 'Invited'
            ? 'bg-brand'
            : user.status === 'Active'
              ? 'bg-ok'
              : 'bg-muted-fg',
        )}
        style={user.status === 'Active' ? { animation: 'dtPulse 2s ease infinite' } : undefined}
      />
      {label}
    </span>
  )
}

/** Days-left badge on an invited row, so an expired invite is visible in the list. */
function InviteBadge({ user }: { user: UserV3 }) {
  const { t } = useApp()
  if (user.status !== 'Invited' || !user.invitation) return <span />

  const days = Math.max(
    0,
    Math.ceil((new Date(user.invitation.expiresAt).getTime() - Date.now()) / 86_400_000),
  )
  const expired = user.invitation.state === 'expired'

  return (
    <span className={cn('font-mono text-[10px]', expired ? 'text-destructive' : 'text-muted-fg')}>
      {expired ? t.invExpired : `${days} ${t.invLeftFmt}`}
    </span>
  )
}

function SkeletonRows({ isMobile }: { isMobile: boolean }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border-soft px-3"
          style={{ height: isMobile ? 64 : 44 }}
        >
          {[140, 200, 90].map((width) => (
            <span
              key={width}
              className="h-[9px] rounded bg-hover"
              style={{ width, animation: 'dtShimmer 1.4s ease infinite' }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
