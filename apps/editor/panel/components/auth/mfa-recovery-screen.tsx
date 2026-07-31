'use client'

import { useApp } from '@panel/components/app-providers'
import { AuthFooter, AuthShell } from '@panel/components/auth/auth-shell'
import { AuthCard, Button, Field, FieldLabel } from '@panel/components/ui/controls'
import { ErrorBox, Kicker, ScreenTitle, SuccessMark } from '@panel/components/ui/feedback'
import type { MfaRecoveryResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { resolveApiMessage } from '@panel/lib/i18n'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

export function MfaRecoveryScreen() {
  const { t } = useApp()
  const router = useRouter()

  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [nextRoute, setNextRoute] = useState('/console/overview')

  const submit = useCallback(async () => {
    // Client-side shape check first, so an obviously malformed code never costs
    // a failed attempt against the account's lockout counter.
    if (!/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(value.trim())) {
      setError(t.recErr)
      return
    }

    setBusy(true)
    setError(null)
    const res = await call<MfaRecoveryResponse>('/api/mfa/recovery', {
      body: { code: value.trim().toUpperCase() },
    })
    setBusy(false)

    if (!res.ok) {
      setError(
        resolveApiMessage(t, res.messageKey, {
          seconds: Number(res.details.retryAfterSeconds ?? 30),
        }),
      )
      return
    }

    setRemaining(res.data.codesRemaining)
    setNextRoute(res.data.state === 'firstSignIn' ? '/welcome' : '/console/overview')
    setDone(true)
  }, [value, t])

  return (
    <AuthShell label="Recovery sign-in">
      <AuthCard gap={18}>
        {done ? (
          <div className="flex flex-col gap-5">
            <SuccessMark />
            <div className="flex flex-col gap-[5px]">
              <h1 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">{t.recDoneTitle}</h1>
              <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">
                {t.recDoneLead}
              </p>
              <span className="font-mono text-[11px] text-muted-fg">
                {remaining} {t.muTitleCodes.toLocaleLowerCase()}
              </span>
            </div>
            <Button onClick={() => router.push(nextRoute)}>{t.recGoConsole}</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-[18px]">
            <div className="flex flex-col gap-[3px]">
              <Kicker>{t.recKick}</Kicker>
              <ScreenTitle title={t.recTitle} lead={t.recLead} />
            </div>

            {error ? <ErrorBox shield={false}>{error}</ErrorBox> : null}

            <div className="flex flex-col gap-[6px]">
              <FieldLabel htmlFor="dt-recovery">{t.recLabel}</FieldLabel>
              <Field
                id="dt-recovery"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX"
                value={value}
                invalid={Boolean(error)}
                onChange={(e) => {
                  setValue(e.target.value.toUpperCase())
                  setError(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
                className="font-mono uppercase tracking-[0.08em]"
              />
            </div>

            <div className="flex flex-col gap-[10px]">
              <Button onClick={() => void submit()} disabled={busy}>
                {t.recCta}
              </Button>
              <button
                type="button"
                onClick={() => router.push('/mfa')}
                className="bg-transparent text-[11.5px] text-muted-fg hover:text-fg"
              >
                {t.recBack}
              </button>
            </div>
          </div>
        )}
      </AuthCard>

      <AuthFooter protectedUpper={t.protectedUpper} signature={t.signature} />
    </AuthShell>
  )
}
