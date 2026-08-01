'use client'

import { useApp } from '@panel/components/app-providers'
import { GlowBlobs, GridBackdrop, HeroGrid } from '@panel/components/ui/backdrop'
import { Caps } from '@panel/components/ui/caps'
import {
  Button,
  Checkbox,
  Field,
  FieldLabel,
  LangToggle,
  Spinner,
  ThemeToggle,
} from '@panel/components/ui/controls'
import { Dialog, ErrorBox, NoticeBox } from '@panel/components/ui/feedback'
import { BrandLockup, NetlogLogo } from '@panel/components/ui/netlog-logo'
import type { SignInResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { useBreakpoint } from '@panel/lib/hooks/use-breakpoint'
import { format, formatNumber, resolveApiMessage } from '@panel/lib/i18n'
import { ArrowRight, Eye, EyeOff, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Site figures shown in the hero summary card, rotating every eight seconds. */
const SITES = [
  { name: 'Sakarya LM1', storage: 12480, picking: 1840, footprint: 42000 },
  { name: 'Esenyurt DC2', storage: 8120, picking: 2260, footprint: 28400 },
  { name: 'Gebze LM3', storage: 19650, picking: 1120, footprint: 61800 },
  { name: 'Torbalı CX', storage: 5340, picking: 3480, footprint: 17200 },
  { name: 'Kocaeli LM2', storage: 15900, picking: 2015, footprint: 48600 },
] as const

export function SignInScreen() {
  const { t, lang } = useApp()
  const router = useRouter()
  const params = useSearchParams()
  const { isDesktop, isNarrow, isMobile, touch } = useBreakpoint()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [keepSignedIn, setKeepSignedIn] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [capsOn, setCapsOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lockSeconds, setLockSeconds] = useState(0)
  const [ssoBlocked, setSsoBlocked] = useState(false)
  const [siteIndex, setSiteIndex] = useState(0)
  const [expiredOpen, setExpiredOpen] = useState(params.get('expired') === '1')
  const [sessionMinutes, setSessionMinutes] = useState(20)

  const site = SITES[siteIndex] ?? SITES[0]

  useEffect(() => {
    const id = setInterval(() => setSiteIndex((i) => (i + 1) % SITES.length), 8000)
    return () => clearInterval(id)
  }, [])

  // Countdown on the lock, ticked client-side. The server re-checks on submit,
  // so a user who edits this out only gets a 423 a moment sooner.
  useEffect(() => {
    if (lockSeconds <= 0) return
    const id = setInterval(() => setLockSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [lockSeconds])

  // The idle-timeout copy quotes the configured limit, so read the real value.
  useEffect(() => {
    if (!expiredOpen) return
    void call<{ sessionMinutes: number }>('/api/auth/session').then((res) => {
      if (res.ok) setSessionMinutes(res.data.sessionMinutes)
    })
  }, [expiredOpen])

  const closeExpired = useCallback(() => {
    setExpiredOpen(false)
    // Strip the flag so a refresh does not re-open the dialog.
    router.replace('/signin')
  }, [router])

  const submit = useCallback(async () => {
    if (submitting || lockSeconds > 0) return
    if (!identifier.trim() || !password) {
      setError(t.errFields)
      return
    }

    setSubmitting(true)
    setError(null)
    setSsoBlocked(false)

    const res = await call<SignInResponse>('/api/auth/signin', {
      body: { identifier: identifier.trim(), password, keepSignedIn },
    })

    setSubmitting(false)

    if (!res.ok) {
      if (res.code === 'account_locked') {
        const seconds = Number(res.details.retryAfterSeconds ?? 30)
        setLockSeconds(seconds)
        setError(resolveApiMessage(t, res.messageKey, { seconds }))
        return
      }
      if (res.code === 'sso_required') {
        setSsoBlocked(true)
        setError(null)
        return
      }

      const left = res.details.attemptsLeft
      const suffix =
        typeof left === 'number' && left > 0
          ? ` ${left} ${left === 1 ? t.errAttemptLeft : t.errAttemptsLeft}`
          : ''
      setError(resolveApiMessage(t, res.messageKey) + suffix)
      setPassword('')
      return
    }

    if (res.data.state === 'mfaRequired') {
      router.push(res.data.enrolmentRequired ? '/mfa/setup' : '/mfa')
      return
    }
    router.push(res.data.state === 'firstSignIn' ? '/welcome' : '/console/overview')
  }, [identifier, password, keepSignedIn, submitting, lockSeconds, router, t])

  /**
   * Hero resource links.
   *
   * Three of the four point at the 3D editor, which is a separate application —
   * in the prototype they popped a note saying so, which is not something to
   * ship. They are real links when NEXT_PUBLIC_EDITOR_URL names the editor, and
   * absent when it does not: a button that cannot go anywhere is worse than no
   * button. The changelog lives in this app, so it is always offered; the
   * sign-in gate in front of it is the correct answer to clicking it here.
   */
  // The guide and the changelog are readable without an account, which is
  // exactly what a visitor stuck on this screen needs; the editor links only
  // appear when a deployment declares where its editor lives.
  const editorUrl = process.env.NEXT_PUBLIC_EDITOR_URL
  const quickLinks = [
    { label: t.qlGuides, href: '/guides' },
    { label: t.qlChangelog, href: '/changelog' },
    ...(editorUrl
      ? [
          { label: t.qlProjects, href: `${editorUrl.replace(/\/$/, '')}/projects` },
          { label: t.qlViewer, href: `${editorUrl.replace(/\/$/, '')}/viewer` },
        ]
      : []),
  ]

  const locked = lockSeconds > 0
  const heroVisible = isDesktop || (isNarrow && !isMobile)

  return (
    <div
      data-screen-label="Sign in"
      className="relative flex min-h-screen overflow-hidden bg-bg text-fg"
      style={isMobile ? undefined : undefined}
    >
      {!isMobile ? <GridBackdrop paused={submitting} /> : null}
      <GlowBlobs />

      {heroVisible ? (
        <div
          className="relative z-[1] flex min-w-0 flex-1 flex-col overflow-hidden bg-hero px-10 py-9"
          style={{ gap: isDesktop ? 0 : 18 }}
        >
          <HeroGrid paused={submitting} />

          <div className="relative z-[1] flex items-center gap-[10px]">
            {/* The hero has vertical room, so it carries the full lockup. */}
            <NetlogLogo className="h-[36px] w-auto shrink-0" />
            <span className="h-5 w-px bg-border" />
            <span className="text-sm font-semibold tracking-[-0.01em] text-fg">
              DigitalTwin Platform
            </span>
          </div>

          <div
            className="relative z-[1] flex max-w-[470px] flex-col"
            style={{
              flex: isDesktop ? 1 : undefined,
              justifyContent: isDesktop ? 'center' : undefined,
              gap: isDesktop ? 24 : 12,
            }}
          >
            <h1
              className="m-0 font-semibold tracking-[-0.02em] text-pretty"
              style={{ fontSize: isDesktop ? 33 : 21, lineHeight: 1.15 }}
            >
              {t.heroTitle}
            </h1>
            <p
              className="m-0 leading-[1.6] text-muted-fg text-pretty"
              style={{ fontSize: isDesktop ? 13.5 : 12 }}
            >
              {t.heroLead}
            </p>

            {isDesktop ? (
              <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border bg-surface">
                <div className="flex items-center justify-between gap-[10px] border-b border-border-soft px-[13px] py-[9px]">
                  <span className="truncate text-xs font-semibold text-fg">{site.name}</span>
                  <span className="flex shrink-0 items-center gap-[6px] font-mono text-[8.5px] tracking-[0.12em] text-muted-fg">
                    <span
                      className="h-[5px] w-[5px] rounded-full bg-brand"
                      style={{ animation: 'dtPulse 2s ease infinite' }}
                    />
                    <Caps>{t.liveTwin}</Caps>
                  </span>
                </div>
                <div className="flex min-w-0">
                  {[
                    { label: t.storage, value: site.storage, unit: t.pallets },
                    { label: t.picking, value: site.picking, unit: t.positions },
                    { label: t.footprint, value: site.footprint, unit: 'm²' },
                  ].map((cell, i) => (
                    <div
                      key={cell.label}
                      className="flex min-w-0 flex-1 flex-col gap-[3px] px-[13px] py-[11px]"
                      style={{
                        borderLeft: i === 0 ? undefined : '1px solid var(--dt-border-soft)',
                      }}
                    >
                      <Caps className="font-mono text-[8.5px] tracking-[0.14em] text-muted-fg">
                        {cell.label}
                      </Caps>
                      <div className="flex min-w-0 items-baseline gap-1">
                        <span className="font-mono text-[19px] font-medium tracking-[-0.02em] text-fg">
                          {formatNumber(lang, cell.value)}
                        </span>
                        <span className="text-[10.5px] text-muted-fg">{cell.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The form pane is the landmark, not the hero — the hero is decoration
          and a marketing panel, and skipping to it helps nobody. */}
      <main
        className="relative z-[1] flex w-full min-w-0 items-center justify-center bg-sidebar px-6 py-9"
        style={
          isDesktop
            ? { maxWidth: 462, flexShrink: 0 }
            : heroVisible
              ? { maxWidth: 420, flexShrink: 0 }
              : undefined
        }
      >
        <div
          className="flex w-full max-w-[344px] flex-col gap-5"
          style={{ animation: 'dtFade 0.25s ease' }}
        >
          {isNarrow && !heroVisible ? (
            <BrandLockup
              label="DigitalTwin"
              logoClassName="h-[26px] w-auto"
              labelClassName="text-[13px] font-semibold"
            />
          ) : null}

          <div className="flex items-center justify-between gap-[10px]">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">{t.signIn}</h1>
              <p className="m-0 text-[12.5px] text-muted-fg">{t.signInLead}</p>
            </div>
            <div className="flex shrink-0 items-center gap-[6px]">
              <ThemeToggle />
              <LangToggle />
            </div>
          </div>

          {ssoBlocked ? <NoticeBox title={t.ssoTitle}>{t.ssoNotice}</NoticeBox> : null}
          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <div className="flex flex-col gap-[13px]">
            <div className="flex flex-col gap-[6px]">
              <FieldLabel htmlFor="dt-identifier">{t.identifier}</FieldLabel>
              <Field
                id="dt-identifier"
                type="text"
                autoComplete="username"
                icon={<Mail className="h-[15px] w-[15px]" strokeWidth={2} />}
                placeholder="Admin  •  r.ovur  •  resul.ovur@netlog.com.tr"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
              <span className="font-mono text-[9px] tracking-[0.06em] text-muted-fg">
                {t.identifierHint}
              </span>
            </div>

            <div className="flex flex-col gap-[6px]">
              <div className="flex items-baseline justify-between gap-2">
                <FieldLabel htmlFor="dt-password">{t.password}</FieldLabel>
                <button
                  type="button"
                  onClick={() => router.push('/reset')}
                  className="bg-transparent text-[11.5px] text-muted-fg hover:text-fg"
                >
                  {t.forgot}
                </button>
              </div>
              <Field
                id="dt-password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                icon={<KeyRound className="h-[15px] w-[15px]" strokeWidth={2} />}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                onKeyDown={(e) => {
                  setCapsOn(e.getModifierState('CapsLock'))
                  if (e.key === 'Enter') void submit()
                }}
                trailing={
                  <HoldToReveal
                    revealed={showPass}
                    onChange={setShowPass}
                    title={t.holdToShow}
                    compact={!touch}
                  />
                }
              />
              {capsOn ? (
                <span className="flex items-center gap-[7px] text-[11.5px] text-warn">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="block h-[13px] w-[13px] shrink-0"
                  >
                    <path d="m6 8 6-6 6 6" />
                    <path d="M6 14h12" />
                    <path d="M6 20h12" />
                  </svg>
                  {t.capsLock}
                </span>
              ) : null}
            </div>

            <Checkbox checked={keepSignedIn} onChange={setKeepSignedIn}>
              {t.remember}
            </Checkbox>

            <Button
              onClick={() => void submit()}
              disabled={locked || submitting}
              className="mt-[2px]"
            >
              {submitting ? <Spinner /> : null}
              {locked ? (
                <span>
                  {t.lockedPrefix} · {lockSeconds}s
                </span>
              ) : (
                <>
                  <span>{t.signIn}</span>
                  <ArrowRight className="block h-[14px] w-[14px] shrink-0" strokeWidth={2.4} />
                </>
              )}
            </Button>
          </div>

          <div className="flex flex-col gap-[13px]">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <Caps className="font-mono text-[9px] tracking-[0.14em] text-muted-fg">{t.or}</Caps>
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button variant="secondary" onClick={() => setSsoBlocked(true)}>
              {/* Entra ID tile mark. Kept as the only non-brand colour on the screen. */}
              <svg viewBox="0 0 24 24" className="block h-[15px] w-[15px] shrink-0" aria-hidden>
                <rect x="3" y="3" width="8" height="8" fill="#F25022" />
                <rect x="13" y="3" width="8" height="8" fill="#7FBA00" />
                <rect x="3" y="13" width="8" height="8" fill="#00A4EF" />
                <rect x="13" y="13" width="8" height="8" fill="#FFB900" />
              </svg>
              <span>{t.ssoNetlog}</span>
            </Button>
          </div>

          <div className="flex items-start gap-[9px] rounded-[9px] border border-border bg-surface px-[11px] py-[9px]">
            <ShieldCheck
              className="mt-px block h-[14px] w-[14px] shrink-0 text-brand-fg"
              strokeWidth={2.2}
            />
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="text-[11.5px] font-medium text-fg">{t.internalOnly}</span>
              <span className="font-mono text-[9.5px] text-muted-fg text-pretty">
                {t.lastSignIn}
              </span>
            </div>
          </div>

          {quickLinks.length > 0 ? (
            <div className="flex flex-col gap-[9px] border-t border-border pt-4">
              <Caps className="font-mono text-[9px] tracking-[0.14em] text-muted-fg">
                {t.resources}
              </Caps>
              <div className="grid grid-cols-2 gap-[7px]">
                {quickLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className={`flex items-center gap-2 rounded-[8px] border border-border-soft bg-field px-[10px] text-left font-medium text-muted-fg no-underline hover:bg-hover hover:text-fg ${
                      touch ? 'h-12 text-[12.5px]' : 'h-[34px] text-[11.5px]'
                    }`}
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-brand" />
                    <span className="truncate">{link.label}</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="text-[12.5px] text-muted-fg">
            {t.noAccount}{' '}
            <button
              type="button"
              onClick={() => router.push('/request')}
              className="bg-transparent font-medium text-fg underline underline-offset-[3px]"
            >
              {t.requestAccount}
            </button>
          </div>

          <p className="m-0 font-mono text-[9px] leading-[1.6] tracking-[0.1em] text-muted-fg">
            {t.protectedUpper} · {t.signature}
          </p>
        </div>
      </main>

      {expiredOpen ? (
        <Dialog labelledBy="dt-expired-title" onClose={() => setExpiredOpen(false)}>
          <h2
            id="dt-expired-title"
            className="m-0 flex items-center gap-2 text-xs font-bold tracking-[0.06em] text-fg"
          >
            <span className="h-[5px] w-[5px] rounded-full bg-brand" />
            <Caps>{t.sessionExpiredTitle}</Caps>
          </h2>
          <p className="m-0 text-xs leading-[1.55] text-muted-fg">
            {format(t.sessionExpiredLead, { minutes: sessionMinutes })}
          </p>
          <div className="flex justify-end">
            <Button full={false} onClick={closeExpired} className="h-8">
              {t.okLabel}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}

/**
 * Hold-to-reveal, matching the editor's own control: the password shows while
 * the pointer or key is held and hides on release. There is deliberately no
 * onClick — an onClick alongside the hold handlers re-revealed the password on
 * the click that followed mouseup, which read as a broken toggle.
 */
function HoldToReveal({
  revealed,
  onChange,
  title,
  compact,
}: {
  revealed: boolean
  onChange: (next: boolean) => void
  title: string
  compact: boolean
}) {
  const held = useRef(false)

  const show = () => {
    held.current = true
    onChange(true)
  }
  const hide = () => {
    held.current = false
    onChange(false)
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={revealed}
      onMouseDown={show}
      onMouseUp={hide}
      onMouseLeave={hide}
      onTouchStart={show}
      onTouchEnd={hide}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          show()
        }
      }}
      onKeyUp={hide}
      onBlur={hide}
      className={`absolute right-1 flex items-center justify-center rounded-[6px] bg-transparent text-muted-fg hover:bg-hover hover:text-fg ${
        compact ? 'h-[30px] px-[7px]' : 'h-11 px-[11px]'
      }`}
    >
      {revealed ? (
        <Eye className="block h-[15px] w-[15px]" strokeWidth={2} />
      ) : (
        <EyeOff className="block h-[15px] w-[15px]" strokeWidth={2} />
      )}
    </button>
  )
}
