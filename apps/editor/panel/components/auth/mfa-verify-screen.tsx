'use client'

import { useApp } from '@panel/components/app-providers'
import { AuthFooter, AuthShell } from '@panel/components/auth/auth-shell'
import { OtpInput } from '@panel/components/auth/otp-input'
import { Caps } from '@panel/components/ui/caps'
import { AuthCard, Button, Checkbox } from '@panel/components/ui/controls'
import { ErrorBox, Kicker, ScreenTitle } from '@panel/components/ui/feedback'
import type { MfaVerifyResponse, SessionResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { resolveApiMessage } from '@panel/lib/i18n'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

export function MfaVerifyScreen() {
  const { t } = useApp()
  const router = useRouter()

  const [code, setCode] = useState<string[]>(Array(6).fill(''))
  const [trustDevice, setTrustDevice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)
  const [account, setAccount] = useState('')

  // The half-open session already knows who is signing in — showing the address
  // here is what makes "Use another account" a meaningful offer.
  useEffect(() => {
    void call<SessionResponse>('/api/auth/session').then((res) => {
      if (!res.ok) return
      if (res.data.state === 'anonymous') {
        router.replace('/signin')
        return
      }
      if (res.data.user) setAccount(res.data.user.email)
    })
  }, [router])

  const verify = useCallback(
    async (joined?: string) => {
      const value = joined ?? code.join('')
      if (value.length !== 6) {
        setError(t.errCode)
        return
      }

      setBusy(true)
      setError(null)
      const res = await call<MfaVerifyResponse>('/api/mfa/verify', {
        body: { code: value, trustDevice },
      })
      setBusy(false)

      if (!res.ok) {
        setError(
          resolveApiMessage(t, res.messageKey, {
            seconds: Number(res.details.retryAfterSeconds ?? 30),
          }),
        )
        setCode(Array(6).fill(''))
        return
      }

      router.push(res.data.state === 'firstSignIn' ? '/welcome' : '/console/overview')
    },
    [code, trustDevice, router, t],
  )

  const signOutAndRestart = useCallback(async () => {
    await call('/api/auth/signout', { body: { allDevices: false } })
    router.push('/signin')
  }, [router])

  return (
    <AuthShell label="Two-factor verification">
      <AuthCard>
        <div className="flex flex-col gap-[3px]">
          <Kicker>{t.step2}</Kicker>
          <ScreenTitle title={t.verifyTitle} lead={t.verifyLead} />
          {account ? <span className="font-mono text-[11px] text-fg">{account}</span> : null}
        </div>

        {error ? <ErrorBox shield={false}>{error}</ErrorBox> : null}

        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={(joined) => void verify(joined)}
          invalid={Boolean(error)}
        />

        <Checkbox checked={trustDevice} onChange={setTrustDevice}>
          {t.trustDevice}
        </Checkbox>

        <div className="flex flex-col gap-[10px]">
          <Button onClick={() => void verify()} disabled={busy}>
            {t.verifyCta}
          </Button>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setResent(true)}
              className="bg-transparent text-xs text-muted-fg hover:text-fg"
            >
              {resent ? t.resent : t.resend}
            </button>
            <button
              type="button"
              onClick={() => void signOutAndRestart()}
              className="bg-transparent text-[11.5px] text-muted-fg hover:text-fg"
            >
              {t.otherAccount}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-[6px] border-t border-border pt-4">
          <button
            type="button"
            onClick={() => router.push('/mfa/recovery')}
            className="text-left font-mono text-[9px] tracking-[0.1em] text-muted-fg hover:text-fg"
          >
            <Caps>{t.vLost}</Caps>
          </button>
          <button
            type="button"
            onClick={() => router.push('/mfa/setup')}
            className="text-left font-mono text-[9px] tracking-[0.1em] text-muted-fg hover:text-fg"
          >
            <Caps>{t.vSetup}</Caps>
          </button>
        </div>
      </AuthCard>

      <AuthFooter protectedUpper={t.protectedUpper} signature={t.signature} />
    </AuthShell>
  )
}
