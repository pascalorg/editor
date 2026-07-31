'use client'

import { useApp } from '@panel/components/app-providers'
import { AuthFooter, AuthShell } from '@panel/components/auth/auth-shell'
import { Caps } from '@panel/components/ui/caps'
import { AuthCard, Button, Checkbox, Field, FieldLabel } from '@panel/components/ui/controls'
import { ErrorBox, Kicker, ScreenTitle, SuccessMark } from '@panel/components/ui/feedback'
import type { ResetConfirmResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { resolveApiMessage } from '@panel/lib/i18n'
import { checkPasswordPolicy } from '@panel/lib/password-policy'
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Mode = 'reset' | 'welcome'

/**
 * One screen, two modes — the design's `SetPasswordPage` with a `welcome` flag.
 * Which mode applies is decided by the token, not the route: the preview call
 * says whether it resolved a reset link or an invite, so a user who opens an
 * invite at /reset/:token still gets the account-setup copy and the consent gate.
 *
 * `token = null` is the third way in: an authenticated account carrying
 * must_change_password, which has no emailed link at all. Same form, same rules,
 * different endpoint.
 */
export function SetPasswordScreen({
  token,
  requestedMode,
  identity: knownIdentity,
}: {
  token: string | null
  requestedMode: Mode
  identity?: string
}) {
  const { t } = useApp()
  const router = useRouter()

  const [mode, setMode] = useState<Mode>(requestedMode)
  const [identity, setIdentity] = useState(knownIdentity ?? '')
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [checking, setChecking] = useState(token !== null)

  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [revokeOthers, setRevokeOthers] = useState(true)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [next, setNext] = useState<ResetConfirmResponse['next']>('signin')

  useEffect(() => {
    if (token === null) return // session-driven mode — nothing to resolve
    void (async () => {
      const res = await call<
        | { kind: 'reset'; email: string; username: string }
        | { kind: 'invite'; email: string; fullName: string }
      >(`/api/auth/reset/${encodeURIComponent(token)}`)
      setChecking(false)

      if (!res.ok) {
        setTokenError(resolveApiMessage(t, res.messageKey))
        return
      }
      setMode(res.data.kind === 'invite' ? 'welcome' : 'reset')
      setIdentity(res.data.kind === 'reset' ? res.data.username : res.data.email)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const policy = useMemo(() => checkPasswordPolicy(password, identity), [password, identity])
  const matches = again.length > 0 && password === again
  const mismatch = again.length > 0 && password !== again
  const isWelcome = mode === 'welcome'
  const canSubmit = policy.ok && matches && (!isWelcome || consent)

  const rules = [
    { ok: policy.minLength, label: t.c1 },
    { ok: policy.mixedCase, label: t.c2 },
    { ok: policy.digit, label: t.c3 },
    { ok: policy.symbol, label: t.c4 },
    { ok: policy.noIdentity, label: t.c5 },
  ]

  const meterColor =
    policy.strength <= 0
      ? 'var(--dt-destructive)'
      : policy.strength <= 2
        ? 'var(--dt-warn)'
        : 'var(--dt-ok)'

  const submit = useCallback(async () => {
    if (!canSubmit || busy) return

    setBusy(true)
    setError(null)
    const res =
      token === null
        ? await call<ResetConfirmResponse>('/api/auth/password', {
            body: {
              password,
              passwordAgain: again,
              revokeOtherSessions: revokeOthers,
              acceptPolicy: consent,
            },
          })
        : await call<ResetConfirmResponse>('/api/auth/reset/confirm', {
            body: {
              token,
              password,
              passwordAgain: again,
              revokeOtherSessions: revokeOthers,
              acceptPolicy: consent,
            },
          })
    setBusy(false)

    if (!res.ok) {
      setError(resolveApiMessage(t, res.messageKey))
      return
    }
    setNext(res.data.next)
    setSaved(true)
  }, [canSubmit, busy, token, password, again, revokeOthers, consent, t])

  const continueOn = useCallback(() => {
    router.push(
      next === 'console' ? '/console/overview' : next === 'mfa-setup' ? '/mfa/setup' : '/signin',
    )
  }, [next, router])

  if (checking) {
    return (
      <AuthShell label="Set new password">
        <AuthCard gap={18}>
          <div className="flex flex-col gap-2">
            <span
              className="h-3 w-24 rounded bg-hover"
              style={{ animation: 'dtShimmer 1.4s ease infinite' }}
            />
            <span
              className="h-6 w-48 rounded bg-hover"
              style={{ animation: 'dtShimmer 1.4s ease infinite' }}
            />
            <span
              className="h-3 w-full rounded bg-hover"
              style={{ animation: 'dtShimmer 1.4s ease infinite' }}
            />
          </div>
        </AuthCard>
      </AuthShell>
    )
  }

  if (tokenError) {
    return (
      <AuthShell label="Set new password">
        <AuthCard gap={18}>
          <ErrorBox>{tokenError}</ErrorBox>
          <Button variant="secondary" onClick={() => router.push('/reset')}>
            {t.resetCta}
          </Button>
          <button
            type="button"
            onClick={() => router.push('/signin')}
            className="bg-transparent text-[11.5px] text-muted-fg hover:text-fg"
          >
            {t.backToSignIn}
          </button>
        </AuthCard>
        <AuthFooter protectedUpper={t.protectedUpper} signature={t.signature} />
      </AuthShell>
    )
  }

  return (
    <AuthShell label="Set new password">
      <AuthCard gap={18}>
        {saved ? (
          <div className="flex flex-col gap-5">
            <SuccessMark />
            <div className="flex flex-col gap-[5px]">
              <h1 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">{t.spDoneTitle}</h1>
              <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">
                {t.spDoneLead}
              </p>
            </div>
            <Button onClick={continueOn}>{isWelcome ? t.spDoneCtaFirst : t.spDoneCta}</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-[18px]">
            <div className="flex flex-col gap-[3px]">
              <Kicker>{isWelcome ? t.spKickFirst : t.spKickReset}</Kicker>
              <ScreenTitle
                title={isWelcome ? t.spTitleFirst : t.spTitle}
                lead={isWelcome ? t.spLeadFirst : t.spLead}
              />
            </div>

            {error ? <ErrorBox shield={false}>{error}</ErrorBox> : null}

            <div className="flex flex-col gap-[6px]">
              <FieldLabel htmlFor="dt-np1">{t.spNew}</FieldLabel>
              <Field
                id="dt-np1"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="flex items-center gap-[6px]">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="h-1 flex-1 rounded-[3px]"
                    style={{
                      background: password && i <= policy.strength ? meterColor : 'var(--dt-hover)',
                    }}
                  />
                ))}
                <Caps className="whitespace-nowrap font-mono text-[9px] tracking-[0.1em] text-muted-fg">
                  {password ? t.strength[policy.strength] : ''}
                </Caps>
              </div>
            </div>

            <div className="flex flex-col gap-[5px]">
              {rules.map((rule) => (
                <div key={rule.label} className="flex items-center gap-2">
                  <span
                    className="flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border"
                    style={{
                      borderColor: rule.ok ? 'var(--dt-ok)' : 'var(--dt-input)',
                      background: rule.ok ? 'rgba(74,222,128,0.14)' : 'transparent',
                      color: 'var(--dt-ok)',
                    }}
                  >
                    {rule.ok ? <Check className="h-[9px] w-[9px]" strokeWidth={3} /> : null}
                  </span>
                  <span className={`text-[11.5px] ${rule.ok ? 'text-fg' : 'text-muted-fg'}`}>
                    {rule.label}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-[6px]">
              <FieldLabel htmlFor="dt-np2">{t.spAgain}</FieldLabel>
              <Field
                id="dt-np2"
                type="password"
                autoComplete="new-password"
                value={again}
                invalid={mismatch}
                valid={matches}
                onChange={(e) => setAgain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
              {mismatch ? (
                <span className="text-[11px] text-destructive">{t.spMismatch}</span>
              ) : null}
            </div>

            <Checkbox checked={revokeOthers} onChange={setRevokeOthers}>
              {t.spRevoke}
            </Checkbox>

            {isWelcome ? (
              <Checkbox checked={consent} onChange={setConsent} align="start">
                {t.spConsent}
              </Checkbox>
            ) : null}

            {/* Inert rather than hidden while the rules are unmet — the user can
                see the button they are working towards. */}
            <div
              className="flex flex-col"
              style={{ opacity: canSubmit ? 1 : 0.45, pointerEvents: canSubmit ? 'auto' : 'none' }}
            >
              <Button onClick={() => void submit()} disabled={busy}>
                {isWelcome ? t.spCtaFirst : t.spCta}
              </Button>
            </div>

            <button
              type="button"
              onClick={() => router.push('/signin')}
              className="self-start bg-transparent text-[11.5px] text-muted-fg hover:text-fg"
            >
              {t.backToSignIn}
            </button>
          </div>
        )}
      </AuthCard>

      <AuthFooter protectedUpper={t.protectedUpper} signature={t.signature} />
    </AuthShell>
  )
}
