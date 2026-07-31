'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import { Button } from '@panel/components/ui/controls'
import { Dialog } from '@panel/components/ui/feedback'
import { useModalFocus } from '@panel/components/ui/modal-focus'
import type { UserDetailResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { useEscapeLayer } from '@panel/lib/escape-layers'
import { formatDate, resolveApiMessage } from '@panel/lib/i18n'
import { PERMISSIONS, type Permission } from '@panel/lib/types'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

type Detail = UserDetailResponse['user']

/**
 * Right-hand detail drawer: identity, site-by-site roles, effective permissions
 * and account actions. Contents reveal in sequence (60 ms apart) as the panel
 * slides — the same cascade the prototype uses so the panel reads as one motion
 * rather than five things appearing at once.
 */
export function UserDrawer({
  userId,
  onClose,
  onChanged,
  notify,
}: {
  userId: string
  onClose: () => void
  onChanged: () => void
  notify: (message: string, tone?: 'success' | 'error') => void
}) {
  const { t, lang } = useApp()

  const [detail, setDetail] = useState<Detail | null>(null)
  const [sites, setSites] = useState<string[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const apply = useCallback((data: UserDetailResponse) => {
    setDetail(data.user)
    setSites(data.sites)
    setRoles(data.roles)
    setCanEdit(data.canEdit)
  }, [])

  const load = useCallback(async () => {
    const res = await call<UserDetailResponse>(`/api/users/${userId}`)
    if (!res.ok) {
      notify(resolveApiMessage(t, res.messageKey), 'error')
      onClose()
      return
    }
    apply(res.data)
  }, [userId, apply, notify, onClose, t])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Escape chain: this drawer sits below any dialog it opens. The dialogs push
   * themselves onto the stack above it, so a press closes whichever is on top
   * and the drawer stays put until it is the topmost layer itself.
   *
   * This used to be a `window` listener that re-implemented that ordering by
   * inspecting the two dialog states. It broke the moment a third dialog was
   * added to the drawer, because the new one was not in the if-chain.
   */
  useEscapeLayer(true, onClose)

  // The drawer declares aria-modal, so it owes the same three things a dialog
  // does: focus in, focus trapped, focus back on the row that opened it.
  useModalFocus(panelRef, Boolean(detail))

  const mutate = useCallback(
    async (path: string, init: { method?: string; body?: unknown }, successMessage?: string) => {
      setBusy(true)
      const res = await call<UserDetailResponse>(path, init)
      setBusy(false)

      if (!res.ok) {
        notify(resolveApiMessage(t, res.messageKey), 'error')
        return false
      }
      if ('user' in res.data) apply(res.data)
      if (successMessage) notify(successMessage)
      onChanged()
      return true
    },
    [apply, notify, onChanged, t],
  )

  /** Click a site's role badge to walk role → role → no access, as in the design. */
  const cycleSiteRole = useCallback(
    async (site: string) => {
      if (!detail || !canEdit) return
      const ladder = [...roles, null]
      const current = detail.siteRoles?.[site] ?? null
      const next = ladder[(ladder.indexOf(current as string | null) + 1) % ladder.length] ?? null

      await mutate(`/api/users/${userId}/assignments`, {
        method: 'PUT',
        body: { siteRoles: { [site]: next } },
      })
    },
    [detail, canEdit, roles, userId, mutate],
  )

  if (!detail) return null

  const initials = detail.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toLocaleUpperCase('tr')

  const meta: Array<{ k: string; v: string }> = [
    { k: t.dwUsername, v: detail.username },
    { k: t.dwMfaLbl, v: detail.mfa === 'On' ? t.c.mfaOn : t.c.mfaOff },
    { k: t.dwLastSeen, v: detail.lastSeen ? formatDate(lang, detail.lastSeen) : '—' },
    { k: t.dwSessions, v: String(detail.activeSessions) },
    { k: t.dwOrgLbl, v: detail.org === 'external' ? t.orgExternal : t.orgInternal },
    { k: t.c.colRole, v: String(detail.role) },
  ]

  return (
    <>
      <div
        className="fixed inset-0 z-[105] flex justify-end backdrop-blur-[2px]"
        style={{ background: 'rgba(0,0,0,0.45)', animation: 'dtFade 0.15s ease' }}
      >
        <button
          type="button"
          aria-label={t.close}
          onClick={onClose}
          className="absolute inset-0 cursor-default bg-transparent"
        />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dt-drawer-title"
          tabIndex={-1}
          className="relative flex h-full w-[min(400px,100%)] flex-col border-l border-border bg-sidebar shadow-e4 outline-none"
          style={{ animation: 'dtSlideR 0.24s cubic-bezier(0.16,1,0.3,1)' }}
        >
          <header className="flex shrink-0 items-center gap-[11px] border-b border-border px-[18px] py-4">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-hover text-xs font-semibold text-fg">
              {initials}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-px">
              <span id="dt-drawer-title" className="truncate text-sm font-semibold">
                {detail.name}
              </span>
              <span className="truncate font-mono text-[10px] text-muted-fg">{detail.email}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.close}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-border bg-transparent text-muted-fg hover:bg-hover hover:text-fg"
            >
              <X className="h-[13px] w-[13px]" strokeWidth={2.2} />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[18px] pb-7 pt-4">
            <Cascade delay={60}>
              <div className="flex flex-wrap items-center gap-[6px]">
                <span className="rounded-[5px] border border-border bg-field px-[7px] py-px text-[10.5px] text-fg">
                  {detail.role}
                </span>
                <span
                  className={cn(
                    'flex items-center gap-[6px] rounded-[5px] border px-[7px] py-px text-[10.5px]',
                    detail.status === 'Invited'
                      ? 'border-brand text-brand-fg'
                      : detail.status === 'Active'
                        ? 'border-border text-fg'
                        : 'border-border text-muted-fg',
                  )}
                >
                  <span
                    className={cn(
                      'h-[5px] w-[5px] rounded-full',
                      detail.status === 'Invited'
                        ? 'bg-brand'
                        : detail.status === 'Active'
                          ? 'bg-ok'
                          : 'bg-muted-fg',
                    )}
                  />
                  {detail.status === 'Invited'
                    ? t.invitedLbl
                    : detail.status === 'Active'
                      ? t.c.statusActive
                      : t.c.statusInactive}
                </span>
                {detail.isPrimaryAdmin ? (
                  <span className="rounded-[5px] border border-border bg-field px-[7px] py-px font-mono text-[9px] text-muted-fg">
                    {(t.dwPrimaryAdmin.split('—')[0] ?? t.dwPrimaryAdmin).trim()}
                  </span>
                ) : null}
              </div>
            </Cascade>

            <Cascade delay={110}>
              <div className="grid grid-cols-2 gap-2">
                {meta.map((row) => (
                  <div
                    key={row.k}
                    className="flex min-w-0 flex-col gap-[2px] rounded-[9px] border border-border-soft bg-surface px-[11px] py-[9px]"
                  >
                    <Caps className="font-mono text-[8.5px] tracking-[0.1em] text-muted-fg">
                      {row.k}
                    </Caps>
                    <span className="truncate text-xs text-fg">{row.v}</span>
                  </div>
                ))}
              </div>
            </Cascade>

            <Cascade delay={160}>
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-[10px]">
                  <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                    {t.dwSiteAccess}
                  </Caps>
                  {canEdit ? (
                    <span className="text-[10.5px] text-muted-fg">{t.dwSiteHint}</span>
                  ) : null}
                </div>
                <div className="flex flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
                  {/* A fresh install, or one where every site is archived, left
                      an empty bordered box under the heading with no hint that
                      anything was missing. */}
                  {sites.length === 0 ? (
                    <p className="m-0 px-[11px] py-4 text-center text-[11px] leading-[1.5] text-muted-fg text-pretty">
                      {t.dwNoSites}
                    </p>
                  ) : null}
                  {sites.map((site) => {
                    const role = detail.siteRoles?.[site] ?? null
                    return (
                      <div
                        key={site}
                        className="flex min-w-0 items-center justify-between gap-[10px] border-b border-border-soft px-[11px] py-2 last:border-b-0"
                      >
                        <span className="min-w-0 truncate text-xs text-fg">{site}</span>
                        <button
                          type="button"
                          disabled={!canEdit || busy}
                          onClick={() => void cycleSiteRole(site)}
                          className={cn(
                            'h-[22px] shrink-0 rounded-[5px] border px-[8px] text-[10.5px]',
                            role
                              ? 'border-brand bg-field text-fg'
                              : 'border-border bg-transparent text-muted-fg',
                          )}
                        >
                          {role ?? t.dwNoAccess}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </Cascade>

            <Cascade delay={210}>
              <div className="flex flex-col gap-2">
                <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                  {t.dwPermsLbl}
                </Caps>
                <div className="flex flex-wrap gap-[6px]">
                  {PERMISSIONS.map((perm: Permission) => {
                    const on = detail.effectivePermissions.includes(perm)
                    return (
                      <span
                        key={perm}
                        className={cn(
                          'flex items-center gap-[6px] rounded-[5px] border px-[7px] py-px font-mono text-[10px]',
                          on
                            ? 'border-border bg-field text-fg'
                            : 'border-border-soft text-muted-fg',
                        )}
                      >
                        <span
                          className={cn(
                            'h-[5px] w-[5px] rounded-full',
                            on ? 'bg-brand' : 'bg-input',
                          )}
                        />
                        {perm}
                      </span>
                    )
                  })}
                </div>
              </div>
            </Cascade>

            <Cascade delay={260}>
              <div className="flex flex-col gap-2">
                <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                  {t.dwActions}
                </Caps>

                {detail.status === 'Invited' && detail.invitation ? (
                  <>
                    <Button
                      variant="secondary"
                      disabled={!canEdit || busy}
                      onClick={() =>
                        void mutate(
                          `/api/invitations/${detail.invitation!.id}/resend`,
                          { body: {} },
                          `${detail.email} ${t.invRenewToast}`,
                        ).then(load)
                      }
                    >
                      {t.dwResend}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!canEdit || busy}
                      onClick={() =>
                        void mutate(
                          `/api/invitations/${detail.invitation!.id}`,
                          { method: 'DELETE' },
                          `${detail.email} ${t.invRevokeToast}`,
                        ).then(load)
                      }
                    >
                      {t.dwRevokeInvite}
                    </Button>
                  </>
                ) : null}

                <Button
                  variant="secondary"
                  disabled={!canEdit || busy}
                  onClick={async () => {
                    setBusy(true)
                    const res = await call<{ temporaryPassword: string }>(
                      `/api/users/${userId}/temp-password`,
                      { body: {} },
                    )
                    setBusy(false)
                    if (!res.ok) {
                      notify(resolveApiMessage(t, res.messageKey), 'error')
                      return
                    }
                    setTempPassword(res.data.temporaryPassword)
                    notify(`${detail.email} ${t.dwPassToast}`)
                    onChanged()
                    void load()
                  }}
                >
                  {t.dwResetPass}
                </Button>

                <Button
                  variant="secondary"
                  disabled={!canEdit || busy || detail.activeSessions === 0}
                  onClick={() =>
                    void mutate(
                      `/api/users/${userId}/revoke-sessions`,
                      { body: {} },
                      `${detail.email} ${t.dwSignoutToast}`,
                    ).then(load)
                  }
                >
                  {t.dwSignout}
                </Button>

                <Button
                  variant={detail.status === 'Inactive' ? 'secondary' : 'destructive'}
                  disabled={!canEdit || busy || detail.isPrimaryAdmin}
                  onClick={() =>
                    void mutate(`/api/users/${userId}`, {
                      method: 'PATCH',
                      body: { status: detail.status === 'Inactive' ? 'Active' : 'Inactive' },
                    })
                  }
                >
                  {detail.status === 'Inactive' ? t.dwActivate : t.dwDeactivate}
                </Button>

                <Button
                  variant="destructive"
                  disabled={!canEdit || busy || detail.isPrimaryAdmin}
                  onClick={() => setConfirmDelete(true)}
                >
                  {t.dwDelete}
                </Button>

                {detail.isPrimaryAdmin ? (
                  <p className="m-0 text-[11px] leading-[1.5] text-muted-fg text-pretty">
                    {t.dwPrimaryAdmin}
                  </p>
                ) : null}
              </div>
            </Cascade>
          </div>
        </div>
      </div>

      {tempPassword ? (
        <Dialog labelledBy="dt-temp-title" onClose={() => setTempPassword(null)}>
          <h2 id="dt-temp-title" className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
            {t.tempPassTitle}
          </h2>
          <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">
            {t.tempPassLead}
          </p>
          <span className="select-all break-all rounded-[8px] border border-border bg-field px-3 py-2 font-mono text-[13px] tracking-[0.04em] text-fg">
            {tempPassword}
          </span>
          <div className="flex gap-[9px]">
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(tempPassword)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                } catch {
                  /* clipboard blocked — the value is selectable on screen */
                }
              }}
            >
              {copied ? t.copied : t.copy}
            </Button>
            <Button variant="secondary" onClick={() => setTempPassword(null)}>
              {t.close}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {confirmDelete ? (
        <Dialog
          role="alertdialog"
          labelledBy="dt-del-title"
          onClose={() => setConfirmDelete(false)}
        >
          <h2 id="dt-del-title" className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
            {t.confirmDeleteTitle}
          </h2>
          <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">
            {t.confirmDeleteLead}
          </p>
          <span className="font-mono text-[11px] text-fg">{detail.email}</span>
          <div className="flex flex-col gap-[9px]">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const res = await call(`/api/users/${userId}`, { method: 'DELETE' })
                setBusy(false)
                if (!res.ok) {
                  notify(resolveApiMessage(t, res.messageKey), 'error')
                  return
                }
                setConfirmDelete(false)
                onChanged()
                onClose()
              }}
            >
              {t.confirmDelete}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t.cancel}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  )
}

/** One staged reveal step of the drawer cascade. */
function Cascade({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <div style={{ animation: `dtFade 0.3s ease backwards`, animationDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}
