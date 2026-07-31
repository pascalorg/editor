'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import { Button, SegBar, SegButton } from '@panel/components/ui/controls'
import { Dialog, Toast } from '@panel/components/ui/feedback'
import type { RolesFullResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { useBreakpoint } from '@panel/lib/hooks/use-breakpoint'
import { collator, resolveApiMessage } from '@panel/lib/i18n'
import { PERMISSIONS, type Permission } from '@panel/lib/types'
import { Check, ChevronDown, ChevronUp, Minus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type RoleRow = RolesFullResponse['roles'][number]

export function RolesTab() {
  const { t, lang } = useApp()
  const { touch } = useBreakpoint()

  const [roles, setRoles] = useState<RoleRow[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [view, setView] = useState<'matrix' | 'list'>('matrix')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<RoleRow | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 2600)
  }, [])

  const load = useCallback(async () => {
    const res = await call<RolesFullResponse>('/api/roles')
    if (!res.ok) {
      notify(resolveApiMessage(t, res.messageKey), 'error')
      return
    }
    setRoles(res.data.roles)
    setCanEdit(res.data.canEdit)
  }, [notify, t])

  useEffect(() => {
    void load()
  }, [load])

  const compare = collator(lang)
  const visible = roles.filter(
    (role) =>
      !search.trim() ||
      compare.compare(role.name, search) === 0 ||
      role.name.toLocaleLowerCase(lang).includes(search.trim().toLocaleLowerCase(lang)),
  )

  /**
   * A matrix toggle writes straight to the API and the row re-reads from the
   * response. No optimistic flip: a silently rolled-back permission is worse
   * than a 200 ms wait, and permissions are exactly where a lie is expensive.
   */
  const togglePermission = useCallback(
    async (role: RoleRow, permission: Permission) => {
      if (!canEdit || role.isSystem) return
      const next = role.permissions.includes(permission)
        ? role.permissions.filter((p) => p !== permission)
        : [...role.permissions, permission]

      const res = await call(`/api/roles/${encodeURIComponent(role.name)}`, {
        method: 'PUT',
        body: { permissions: next },
      })
      if (!res.ok) {
        notify(resolveApiMessage(t, res.messageKey), 'error')
        return
      }
      void load()
    },
    [canEdit, load, notify, t],
  )

  const createRole = useCallback(async () => {
    if (!newName.trim()) return
    const res = await call('/api/roles', { body: { name: newName.trim() } })
    if (!res.ok) {
      notify(resolveApiMessage(t, res.messageKey), 'error')
      return
    }
    setNewName('')
    setAdding(false)
    void load()
  }, [newName, load, notify, t])

  const cols = `minmax(0,1.5fr) repeat(${visible.length}, ${touch ? '56px' : 'minmax(0,1fr)'})`

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.rolePerms}</h2>
          <p className="m-0 text-xs text-muted-fg">
            {roles.length} {t.c.rolesCount} · {PERMISSIONS.length} {t.c.permsCount}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[7px]">
          <input
            type="text"
            placeholder={t.c.roleSearchPh}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[30px] w-[150px] min-w-0 rounded-[8px] border border-input bg-field px-[10px] text-xs text-fg outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--dt-hover)]"
          />
          <SegBar>
            <SegButton active={view === 'matrix'} onClick={() => setView('matrix')}>
              {t.c.viewMatrix}
            </SegButton>
            <SegButton active={view === 'list'} onClick={() => setView('list')}>
              {t.c.viewList}
            </SegButton>
          </SegBar>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setAdding((v) => !v)}
            className="h-[30px] shrink-0 rounded-[8px] bg-primary px-[13px] text-xs font-semibold text-primary-fg shadow-e2 hover:opacity-92"
          >
            {adding ? t.c.closeForm : t.c.addRole}
          </button>
        </div>
      </header>

      {adding ? (
        <div
          className="flex flex-wrap items-end gap-[10px] rounded-[12px] border border-input bg-surface p-[13px]"
          style={{ animation: 'dtDrop 0.16s ease' }}
        >
          <div className="flex min-w-[170px] flex-1 flex-col gap-[5px]">
            <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
              {t.newRoleName}
            </Caps>
            <input
              type="text"
              placeholder={t.egRole}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createRole()}
              className="h-8 w-full min-w-0 rounded-[8px] border border-input bg-field px-[10px] text-xs text-fg outline-none focus:border-ring"
            />
          </div>
          <div className="flex gap-[7px]">
            <button
              type="button"
              onClick={() => void createRole()}
              className="h-8 rounded-[8px] bg-primary px-[14px] text-xs font-semibold text-primary-fg hover:opacity-92"
            >
              {t.save}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-8 rounded-[8px] border border-border bg-transparent px-3 text-xs text-muted-fg hover:bg-hover hover:text-fg"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {/* The search can exclude everything. Without this the matrix still drew
          its header and every permission row, just with no role columns — a
          table that looks broken rather than empty. */}
      {visible.length === 0 ? (
        <section className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-input px-4 py-14">
          <span className="text-[12.5px] font-semibold">{t.roleNoMatch}</span>
          <span className="text-[11.5px] text-muted-fg">{t.roleNoMatchHint}</span>
        </section>
      ) : view === 'matrix' ? (
        <div className="min-w-0 overflow-x-auto rounded-[12px] border border-border">
          <div
            className="grid h-[31px] items-center gap-2 border-b border-border bg-surface px-3 font-mono text-[8.5px] tracking-[0.12em] text-muted-fg"
            style={{ gridTemplateColumns: cols }}
          >
            <Caps>{t.c.colPermission}</Caps>
            {visible.map((role) => (
              <Caps key={role.name} invariant className="truncate text-center">
                {role.name}
              </Caps>
            ))}
          </div>

          {PERMISSIONS.map((permission) => (
            <div
              key={permission}
              className="grid items-center gap-2 border-b border-border-soft px-3 py-[7px] last:border-b-0"
              style={{ gridTemplateColumns: cols }}
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[12.5px]">{labelFor(permission)}</span>
                <span className="font-mono text-[9px] text-muted-fg">{permission}</span>
              </div>
              {visible.map((role) => {
                const on = role.permissions.includes(permission)
                const locked = !canEdit || role.isSystem
                return (
                  <button
                    key={`${role.name}-${permission}`}
                    type="button"
                    disabled={locked}
                    title={locked ? t.systemRoleLocked : `${role.name} · ${permission}`}
                    onClick={() => void togglePermission(role, permission)}
                    className={cn(
                      'mx-auto flex items-center justify-center rounded-[6px] border',
                      touch ? 'h-11 w-11' : 'h-[26px] w-[26px]',
                      on
                        ? 'border-brand bg-field text-brand-fg'
                        : 'border-border bg-transparent text-muted-fg',
                      locked && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {on ? (
                      <Check className="h-[13px] w-[13px]" strokeWidth={3} />
                    ) : (
                      <Minus className="h-[11px] w-[11px] opacity-50" strokeWidth={2.5} />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-[9px]">
          {visible.map((role) => {
            const open = expanded === role.name
            return (
              <div
                key={role.name}
                className="overflow-hidden rounded-[12px] border border-border bg-surface"
              >
                <div className="flex h-10 items-center justify-between gap-[10px] px-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : role.name)}
                    className="flex min-w-0 flex-1 items-center gap-[9px] bg-transparent text-left"
                  >
                    <span
                      className={cn(
                        'h-[5px] w-[5px] shrink-0 rounded-full',
                        role.isSystem ? 'bg-brand' : 'bg-input',
                      )}
                    />
                    <Caps
                      invariant
                      className="truncate text-[12.5px] font-semibold tracking-[0.04em]"
                    >
                      {role.name}
                    </Caps>
                    {role.isSystem ? (
                      <span className="shrink-0 rounded-[4px] border border-border px-[5px] font-mono text-[8.5px] text-muted-fg">
                        {t.systemRole}
                      </span>
                    ) : null}
                  </button>

                  <div className="flex shrink-0 items-center gap-2 font-mono text-[9.5px] text-muted-fg">
                    <span>
                      {role.permissions.length} {t.permEnabled} · {role.userCount} {t.c.accounts}
                    </span>
                    {!role.isSystem && canEdit ? (
                      <button
                        type="button"
                        onClick={() => setDeleting(role)}
                        className="h-5 rounded-[5px] border border-destructive bg-transparent px-[6px] text-[8.5px] tracking-[0.08em] text-destructive hover:bg-hover"
                      >
                        <Caps>{t.confirmDelete}</Caps>
                      </button>
                    ) : null}
                    {open ? (
                      <ChevronUp className="h-[13px] w-[13px]" strokeWidth={2.5} />
                    ) : (
                      <ChevronDown className="h-[13px] w-[13px]" strokeWidth={2.5} />
                    )}
                  </div>
                </div>

                {open ? (
                  <div className="grid gap-2 border-t border-border-soft p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {PERMISSIONS.map((permission) => (
                      <label
                        key={permission}
                        className={cn(
                          'flex min-w-0 items-center gap-2 text-[11.5px]',
                          role.isSystem || !canEdit
                            ? 'cursor-not-allowed text-muted-fg'
                            : 'cursor-pointer',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={role.permissions.includes(permission)}
                          disabled={role.isSystem || !canEdit}
                          onChange={() => void togglePermission(role, permission)}
                          className="h-[14px] w-[14px] shrink-0 cursor-pointer"
                          style={{ accentColor: 'var(--dt-brand)' }}
                        />
                        <span className="truncate">{labelFor(permission)}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <p className="m-0 text-[11.5px] text-muted-fg">{t.c.rolesFootnote}</p>

      {deleting ? (
        <Dialog role="alertdialog" labelledBy="dt-role-del" onClose={() => setDeleting(null)}>
          <h2 id="dt-role-del" className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
            {t.roleDeleteConfirm}
          </h2>
          <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">
            {t.roleDeleteLead}
          </p>
          <span className="font-mono text-[11px] text-fg">{deleting.name}</span>
          <div className="flex flex-col gap-[9px]">
            <Button
              variant="destructive"
              onClick={async () => {
                const res = await call<{ reassigned: number }>(
                  `/api/roles/${encodeURIComponent(deleting.name)}`,
                  { method: 'DELETE' },
                )
                if (!res.ok) {
                  notify(resolveApiMessage(t, res.messageKey), 'error')
                  return
                }
                setDeleting(null)
                void load()
              }}
            >
              {t.confirmDelete}
            </Button>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t.cancel}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}

/** Human label for a permission key; the mono key stays visible beside it. */
function labelFor(permission: Permission): string {
  return permission.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
