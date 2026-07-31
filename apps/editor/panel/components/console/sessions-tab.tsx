'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import { Toast } from '@panel/components/ui/feedback'
import type { SessionResponse, SessionsResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { formatDate, resolveApiMessage } from '@panel/lib/i18n'
import type { SessionInfo } from '@panel/lib/types'
import { Monitor } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

/**
 * The signed-in user's own devices, plus a read-only view of the policy the
 * server enforces. The policy is deliberately not editable here: session length,
 * device limit and the MFA requirement all live in the org settings row, which
 * the Settings tab owns in step 7.
 */
export function SessionsTab() {
  const { t, lang } = useApp()

  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionMinutes, setSessionMinutes] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    const [list, meta] = await Promise.all([
      call<SessionsResponse>('/api/auth/sessions'),
      call<SessionResponse>('/api/auth/session'),
    ])
    if (list.ok) setSessions(list.data.sessions)
    if (meta.ok) setSessionMinutes(meta.data.sessionMinutes)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const revoke = useCallback(
    async (session: SessionInfo) => {
      const res = await call<{ revoked: number; self: boolean }>(
        `/api/auth/sessions/${session.id}`,
        {
          method: 'DELETE',
        },
      )
      if (!res.ok) {
        setToast({ message: resolveApiMessage(t, res.messageKey), tone: 'error' })
        setTimeout(() => setToast(null), 2600)
        return
      }
      // Revoking your own session drops the cookie, so the next navigation is a
      // sign-in. Reloading here is what makes that immediate rather than eventual.
      if (res.data.self) {
        window.location.href = '/signin'
        return
      }
      void load()
    },
    [load, t],
  )

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-col gap-[2px]">
        <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.sessionsTitle}</h2>
        <p className="m-0 text-xs text-muted-fg">
          {sessions.length} {t.sessionPolicyLead.toLocaleLowerCase(lang)}
        </p>
      </header>

      <div className="flex flex-col gap-2 rounded-[12px] border border-border bg-surface p-3">
        <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
          {t.sessionPolicy}
        </Caps>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <PolicyValue
            label={t.polIdle}
            value={sessionMinutes ? `${sessionMinutes} ${t.polMin}` : '—'}
          />
          <PolicyValue label={t.polMfa} value={t.on} />
        </div>
        <p className="m-0 text-[11.5px] text-muted-fg text-pretty">{t.sessionPolicyLead}</p>
      </div>

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border">
        {loading ? (
          <div className="flex flex-col">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="flex h-[52px] items-center gap-4 border-b border-border-soft px-3"
              >
                <span
                  className="h-[9px] w-[180px] rounded bg-hover"
                  style={{ animation: 'dtShimmer 1.4s ease infinite' }}
                />
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10">
            <Monitor className="h-[22px] w-[22px] text-muted-fg" strokeWidth={1.6} />
            <span className="text-[11.5px] text-muted-fg">{t.noOtherSessions}</span>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border-soft px-3 py-[10px] last:border-b-0"
            >
              <div className="flex min-w-[180px] flex-1 flex-col gap-[2px]">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium">
                    {session.device ?? '—'}
                  </span>
                  {session.current ? (
                    <span className="shrink-0 rounded-[4px] border border-brand px-[5px] font-mono text-[8.5px] text-brand-fg">
                      {t.thisDevice}
                    </span>
                  ) : null}
                </div>
                <span className="truncate font-mono text-[10px] text-muted-fg">
                  {session.ip ?? '—'} · {formatDate(lang, session.lastActivityAt)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => void revoke(session)}
                className="h-[26px] shrink-0 rounded-[6px] border border-destructive bg-transparent px-[10px] text-[11px] text-destructive hover:bg-hover"
              >
                {session.current ? t.c.endSession : t.revokeSession}
              </button>
            </div>
          ))
        )}
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}

function PolicyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <Caps className="font-mono text-[8.5px] tracking-[0.1em] text-muted-fg">{label}</Caps>
      <span className="font-mono text-[13px] text-fg">{value}</span>
    </div>
  )
}
