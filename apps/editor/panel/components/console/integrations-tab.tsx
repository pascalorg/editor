'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import { Button, SegBar, SegButton } from '@panel/components/ui/controls'
import { Dialog, Toast } from '@panel/components/ui/feedback'
import type {
  CreateKeyResponse,
  KeysResponse,
  WebhooksResponse,
  WebhookTestResponse,
} from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { formatDate, resolveApiMessage } from '@panel/lib/i18n'
import type { ApiKey, Webhook } from '@panel/lib/types'
import { useCallback, useEffect, useState } from 'react'

export function IntegrationsTab() {
  const { t, lang } = useApp()

  const [keys, setKeys] = useState<ApiKey[]>([])
  const [sites, setSites] = useState<string[]>([])
  const [hooks, setHooks] = useState<Webhook[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const [creatingKey, setCreatingKey] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyScope, setKeyScope] = useState<'read' | 'read_write'>('read')
  const [keySite, setKeySite] = useState<string>('')
  const [freshSecret, setFreshSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [addingHook, setAddingHook] = useState(false)
  const [hookUrl, setHookUrl] = useState('')
  const [hookEvents, setHookEvents] = useState<string[]>([])

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const load = useCallback(async () => {
    const [k, h] = await Promise.all([
      call<KeysResponse>('/api/keys'),
      call<WebhooksResponse>('/api/webhooks'),
    ])
    if (k.ok) {
      setKeys(k.data.keys)
      setSites(k.data.sites)
    }
    if (h.ok) {
      setHooks(h.data.webhooks)
      setEvents(h.data.events)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createKey = useCallback(async () => {
    if (!keyName.trim()) {
      notify(t.errFields, 'error')
      return
    }
    const res = await call<CreateKeyResponse>('/api/keys', {
      body: { name: keyName.trim(), scope: keyScope, siteName: keySite || null },
    })
    if (!res.ok) {
      notify(resolveApiMessage(t, res.messageKey), 'error')
      return
    }
    setKeyName('')
    setCreatingKey(false)
    setFreshSecret(res.data.key.secret)
    void load()
  }, [keyName, keyScope, keySite, notify, t, load])

  const createHook = useCallback(async () => {
    const res = await call('/api/webhooks', { body: { url: hookUrl.trim(), events: hookEvents } })
    if (!res.ok) {
      notify(resolveApiMessage(t, res.messageKey), 'error')
      return
    }
    setHookUrl('')
    setHookEvents([])
    setAddingHook(false)
    void load()
  }, [hookUrl, hookEvents, notify, t, load])

  const testHook = useCallback(
    async (hook: Webhook) => {
      const res = await call<WebhookTestResponse>(`/api/webhooks/${hook.id}/test`, { body: {} })
      if (!res.ok) {
        notify(resolveApiMessage(t, res.messageKey), 'error')
        return
      }
      notify(
        res.data.delivered
          ? `${hook.url} — ${t.igTestOk}`
          : `${hook.url} — ${t.igTestFail}${res.data.responseStatus ? ` (HTTP ${res.data.responseStatus})` : ''}`,
        res.data.delivered ? 'success' : 'error',
      )
      void load()
    },
    [notify, t, load],
  )

  return (
    <section className="flex min-w-0 flex-col gap-6" style={{ animation: 'dtFade 0.2s ease' }}>
      {/* ——— API keys ——— */}
      <div className="flex min-w-0 flex-col gap-[14px]">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-[2px]">
            <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.igKeysTitle}</h2>
            <p className="m-0 text-xs text-muted-fg text-pretty">{t.igKeysLead}</p>
          </div>
          <button
            type="button"
            onClick={() => setCreatingKey((v) => !v)}
            className="h-[30px] shrink-0 rounded-[8px] bg-primary px-[13px] text-xs font-semibold text-primary-fg shadow-e2 hover:opacity-92"
          >
            {creatingKey ? t.c.closeForm : t.igNewKey}
          </button>
        </header>

        {creatingKey ? (
          <div
            className="flex flex-wrap items-end gap-[10px] rounded-[12px] border border-input bg-surface p-[13px]"
            style={{ animation: 'dtDrop 0.16s ease' }}
          >
            <div className="flex min-w-[160px] flex-1 flex-col gap-[5px]">
              <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                {t.igKeyNameLbl}
              </Caps>
              <input
                type="text"
                placeholder="WMS sync"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                className="h-8 w-full min-w-0 rounded-[8px] border border-input bg-field px-[10px] text-xs text-fg outline-none focus:border-ring"
              />
            </div>

            <div className="flex flex-col gap-[5px]">
              <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                {t.igScopeLbl}
              </Caps>
              <SegBar>
                <SegButton active={keyScope === 'read'} onClick={() => setKeyScope('read')}>
                  {t.igScopeRead}
                </SegButton>
                <SegButton
                  active={keyScope === 'read_write'}
                  onClick={() => setKeyScope('read_write')}
                >
                  {t.igScopeWrite}
                </SegButton>
              </SegBar>
            </div>

            <div className="flex min-w-[150px] flex-col gap-[5px]">
              <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                {t.igSiteLbl}
              </Caps>
              <select
                value={keySite}
                onChange={(e) => setKeySite(e.target.value)}
                className="h-8 w-full min-w-0 rounded-[8px] border border-input bg-field px-[8px] text-xs text-fg outline-none focus:border-ring"
              >
                <option value="">{t.igAllSites}</option>
                {sites.map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-[7px]">
              <button
                type="button"
                onClick={() => void createKey()}
                className="h-8 rounded-[8px] bg-primary px-[14px] text-xs font-semibold text-primary-fg hover:opacity-92"
              >
                {t.igCreateKey}
              </button>
              <button
                type="button"
                onClick={() => setCreatingKey(false)}
                className="h-8 rounded-[8px] border border-border bg-transparent px-3 text-xs text-muted-fg hover:bg-hover hover:text-fg"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border">
          {keys.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11.5px] text-muted-fg">{t.igNoKeys}</div>
          ) : (
            keys.map((key) => (
              <div
                key={key.id}
                className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border-soft px-3 py-[10px] last:border-b-0"
              >
                {/* A revoked row used to be dimmed with opacity-55. That drops
                    every column on it — scope, site, last use — to 2.98:1,
                    which is the one thing a row nobody can read is not allowed
                    to be. The state is carried by the struck-through key and
                    the "Revoked" label instead, both of which survive at full
                    contrast. */}
                <div className="flex min-w-[180px] flex-1 flex-col gap-[2px]">
                  <span
                    className={cn(
                      'truncate text-[12.5px] font-medium',
                      key.revokedAt && 'line-through',
                    )}
                  >
                    {key.name}
                  </span>
                  <span
                    className={cn(
                      'truncate font-mono text-[10px] text-muted-fg',
                      key.revokedAt && 'line-through',
                    )}
                  >
                    {key.prefix}••••••••••••
                  </span>
                </div>
                <span className="w-[110px] shrink-0 rounded-[5px] border border-border px-[7px] py-px text-center font-mono text-[10px] text-muted-fg">
                  {key.scope === 'read' ? t.igScopeRead : t.igScopeWrite}
                </span>
                <span className="w-[120px] shrink-0 truncate text-[11.5px] text-muted-fg">
                  {key.siteId ?? t.igAllSites}
                </span>
                <span className="w-[150px] shrink-0 truncate font-mono text-[10px] text-muted-fg">
                  {key.lastUsedAt ? formatDate(lang, key.lastUsedAt) : t.igNever}
                </span>
                {key.revokedAt ? (
                  <span className="shrink-0 text-[11px] text-muted-fg">{t.igRevoked}</span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await call(`/api/keys/${key.id}`, { method: 'DELETE' })
                      if (!res.ok) {
                        notify(resolveApiMessage(t, res.messageKey), 'error')
                        return
                      }
                      void load()
                    }}
                    className="h-[26px] shrink-0 rounded-[6px] border border-destructive bg-transparent px-[10px] text-[11px] text-destructive hover:bg-hover"
                  >
                    {t.igRevoke}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ——— Webhooks ——— */}
      <div className="flex min-w-0 flex-col gap-[14px]">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-[2px]">
            <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.igHooksTitle}</h2>
            <p className="m-0 text-xs text-muted-fg text-pretty">{t.igHooksLead}</p>
          </div>
          <button
            type="button"
            onClick={() => setAddingHook((v) => !v)}
            className="h-[30px] shrink-0 rounded-[8px] bg-primary px-[13px] text-xs font-semibold text-primary-fg shadow-e2 hover:opacity-92"
          >
            {addingHook ? t.c.closeForm : t.igAddHook}
          </button>
        </header>

        {addingHook ? (
          <div
            className="flex flex-col gap-[10px] rounded-[12px] border border-input bg-surface p-[13px]"
            style={{ animation: 'dtDrop 0.16s ease' }}
          >
            <div className="flex flex-col gap-[5px]">
              <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">URL</Caps>
              <input
                type="text"
                placeholder="https://wms.netlog.com.tr/hooks/dt"
                value={hookUrl}
                onChange={(e) => setHookUrl(e.target.value)}
                className="h-8 w-full min-w-0 rounded-[8px] border border-input bg-field px-[10px] font-mono text-xs text-fg outline-none focus:border-ring"
              />
            </div>

            <div className="flex flex-col gap-[5px]">
              <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                {t.igEventsLbl}
              </Caps>
              <div className="flex flex-wrap gap-[6px]">
                {events.map((event) => {
                  const on = hookEvents.includes(event)
                  return (
                    <button
                      key={event}
                      type="button"
                      onClick={() =>
                        setHookEvents((prev) =>
                          on ? prev.filter((e) => e !== event) : [...prev, event],
                        )
                      }
                      className={cn(
                        'flex h-[26px] items-center gap-2 rounded-[6px] border px-[9px] font-mono text-[10.5px]',
                        on
                          ? 'border-brand bg-field text-fg'
                          : 'border-border bg-transparent text-muted-fg',
                      )}
                    >
                      <span
                        className={cn(
                          'h-[8px] w-[8px] shrink-0 rounded-[2px] border',
                          on ? 'border-brand bg-brand' : 'border-input',
                        )}
                      />
                      {event}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-[7px]">
              <button
                type="button"
                onClick={() => void createHook()}
                className="h-8 rounded-[8px] bg-primary px-[14px] text-xs font-semibold text-primary-fg hover:opacity-92"
              >
                {t.igCreateHook}
              </button>
              <button
                type="button"
                onClick={() => setAddingHook(false)}
                className="h-8 rounded-[8px] border border-border bg-transparent px-3 text-xs text-muted-fg hover:bg-hover hover:text-fg"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border">
          {hooks.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11.5px] text-muted-fg">{t.igNoHooks}</div>
          ) : (
            hooks.map((hook) => (
              <div
                key={hook.id}
                className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border-soft px-3 py-[10px] last:border-b-0"
              >
                <div className="flex min-w-[220px] flex-1 flex-col gap-[4px]">
                  <span className="truncate font-mono text-[11.5px] text-fg">{hook.url}</span>
                  <div className="flex flex-wrap gap-[4px]">
                    {hook.events.map((event) => (
                      <span
                        key={event}
                        className="rounded-[4px] border border-border-soft px-[5px] font-mono text-[9px] text-muted-fg"
                      >
                        {event}
                      </span>
                    ))}
                  </div>
                </div>

                <span
                  className={cn(
                    'flex w-[110px] shrink-0 items-center gap-[6px] rounded-[5px] border px-[7px] py-px text-[10.5px]',
                    hook.status === 'active'
                      ? 'border-border text-fg'
                      : hook.status === 'failing'
                        ? 'border-destructive text-destructive'
                        : 'border-border text-muted-fg',
                  )}
                >
                  <span
                    className={cn(
                      'h-[5px] w-[5px] rounded-full',
                      hook.status === 'active'
                        ? 'bg-ok'
                        : hook.status === 'failing'
                          ? 'bg-destructive'
                          : 'bg-muted-fg',
                    )}
                  />
                  {hook.status === 'active'
                    ? t.igStActive
                    : hook.status === 'paused'
                      ? t.igStPaused
                      : t.igStFailing}
                </span>

                <span className="w-[150px] shrink-0 truncate font-mono text-[10px] text-muted-fg">
                  {hook.lastDeliveryAt ? formatDate(lang, hook.lastDeliveryAt) : t.igNever}
                </span>

                <div className="flex shrink-0 items-center gap-[6px]">
                  <button
                    type="button"
                    onClick={() => void testHook(hook)}
                    className="h-[26px] rounded-[6px] border border-border bg-field px-[10px] text-[11px] text-fg hover:bg-hover"
                  >
                    {t.igTest}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await call(`/api/webhooks/${hook.id}`, {
                        method: 'PATCH',
                        body: { status: hook.status === 'paused' ? 'active' : 'paused' },
                      })
                      if (!res.ok) {
                        notify(resolveApiMessage(t, res.messageKey), 'error')
                        return
                      }
                      void load()
                    }}
                    className="h-[26px] rounded-[6px] border border-border bg-transparent px-[10px] text-[11px] text-muted-fg hover:bg-hover hover:text-fg"
                  >
                    {hook.status === 'paused' ? t.igResume : t.igPause}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await call(`/api/webhooks/${hook.id}`, { method: 'DELETE' })
                      if (!res.ok) {
                        notify(resolveApiMessage(t, res.messageKey), 'error')
                        return
                      }
                      void load()
                    }}
                    className="h-[26px] rounded-[6px] border border-destructive bg-transparent px-[10px] text-[11px] text-destructive hover:bg-hover"
                  >
                    {t.confirmDelete}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {freshSecret ? (
        <Dialog labelledBy="dt-secret-title" width={420} onClose={() => setFreshSecret(null)}>
          <h2 id="dt-secret-title" className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
            {t.igSecretTitle}
          </h2>
          <code className="select-all break-all rounded-[8px] border border-border bg-field px-3 py-2 font-mono text-[12px] text-fg">
            {freshSecret}
          </code>
          <p className="m-0 text-[11.5px] leading-[1.5] text-muted-fg text-pretty">
            {t.igSecretNote}
          </p>
          <div className="flex gap-[9px]">
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(freshSecret)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                } catch {
                  /* clipboard blocked — the value is selectable on screen */
                }
              }}
            >
              {copied ? t.copied : t.copy}
            </Button>
            <Button variant="secondary" onClick={() => setFreshSecret(null)}>
              {t.close}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}
