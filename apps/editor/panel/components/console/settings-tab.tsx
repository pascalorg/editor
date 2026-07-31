'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import { SegBar, SegButton } from '@panel/components/ui/controls'
import { Toast } from '@panel/components/ui/feedback'
import type { SettingsResponse, UpdateSettingsRequest } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { resolveApiMessage } from '@panel/lib/i18n'
import type { Lang, OrgSettings, Theme } from '@panel/lib/types'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

/**
 * The org settings row, grouped as the design has it: Security, Identity and
 * invites, Appearance.
 *
 * Appearance is the odd one out and stays local on purpose — theme and language
 * are per-viewer preferences held in a cookie, not tenant policy, so they are
 * rendered in the same list but never written to the settings row.
 */
export function SettingsTab() {
  const { t, theme, lang, setTheme, setLang } = useApp()

  const [settings, setSettings] = useState<OrgSettings | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    const res = await call<SettingsResponse>('/api/settings')
    if (!res.ok) return
    setSettings(res.data.settings)
    setCanEdit(res.data.canEdit)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (patch: UpdateSettingsRequest) => {
      if (!canEdit || busy) return
      setBusy(true)
      const res = await call<SettingsResponse>('/api/settings', { method: 'PUT', body: patch })
      setBusy(false)

      if (!res.ok) {
        setToast({ message: resolveApiMessage(t, res.messageKey), tone: 'error' })
        setTimeout(() => setToast(null), 2600)
        return
      }
      setSettings(res.data.settings)
      setToast({ message: t.seSaved, tone: 'success' })
      setTimeout(() => setToast(null), 1800)
    },
    [canEdit, busy, t],
  )

  if (!settings) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="h-[160px] rounded-[12px] border border-border bg-surface"
            style={{ animation: 'dtShimmer 1.4s ease infinite' }}
          />
        ))}
      </div>
    )
  }

  const sections: Array<{ title: string; rows: ReactNode[] }> = [
    {
      title: t.seSecurity,
      rows: [
        <SegRow
          key="sess"
          label={t.seSessLen}
          desc={t.seSessLenD}
          options={[
            [10, '10'],
            [20, '20'],
            [30, '30'],
            [60, `60 ${t.polMin}`],
          ]}
          value={settings.sessionMinutes}
          disabled={!canEdit}
          onChange={(v) => void save({ sessionMinutes: v })}
        />,
        <ToggleRow
          key="keep"
          label={t.seKeep}
          desc={t.seKeepD}
          on={settings.keepSignedInAllowed}
          disabled={!canEdit}
          onToggle={() => void save({ keepSignedInAllowed: !settings.keepSignedInAllowed })}
        />,
        <SegRow
          key="keepdays"
          label={t.seKeepDays}
          desc={t.seKeepDaysD}
          options={[
            [7, '7'],
            [14, '14'],
            [30, `30 ${t.seDays}`],
          ]}
          value={settings.keepSignedInDays}
          disabled={!canEdit || !settings.keepSignedInAllowed}
          onChange={(v) => void save({ keepSignedInDays: v })}
        />,
        <SegRow
          key="trust"
          label={t.seTrust}
          desc={t.seTrustD}
          options={[
            [14, '14'],
            [30, '30'],
            [90, `90 ${t.seDays}`],
          ]}
          value={settings.trustedDeviceDays}
          disabled={!canEdit}
          onChange={(v) => void save({ trustedDeviceDays: v })}
        />,
        <SegRow
          key="conc"
          label={t.seConc}
          desc={t.seConcD}
          options={[
            [1, '1'],
            [3, '3'],
            [5, '5'],
          ]}
          value={settings.concurrentSessionLimit}
          disabled={!canEdit}
          onChange={(v) => void save({ concurrentSessionLimit: v })}
        />,
        <ToggleRow
          key="mfa"
          label={t.seMfa}
          desc={t.seMfaD}
          on={settings.mfaRequired}
          disabled={!canEdit}
          onToggle={() => void save({ mfaRequired: !settings.mfaRequired })}
        />,
      ],
    },
    {
      title: t.seIdentity,
      rows: [
        <ChipRow
          key="sso"
          label={t.seSso}
          desc={t.seSsoD}
          chips={settings.ssoEnforcedDomains}
          empty={t.seSsoNone}
        />,
        <SegRow
          key="invite"
          label={t.seInvite}
          desc={t.seInviteD}
          options={[
            [5, '5'],
            [7, '7'],
            [14, `14 ${t.seDays}`],
          ]}
          value={settings.inviteExpiryDays}
          disabled={!canEdit}
          onChange={(v) => void save({ inviteExpiryDays: v })}
        />,
        <ToggleRow
          key="ext"
          label={t.seExternal}
          desc={t.seExternalD}
          on={settings.externalUsersAllowed}
          disabled={!canEdit}
          onToggle={() => void save({ externalUsersAllowed: !settings.externalUsersAllowed })}
        />,
      ],
    },
    {
      title: t.seAppearance,
      rows: [
        <SegRow
          key="theme"
          label={t.seTheme}
          desc={t.seThemeD}
          options={[
            ['dark', t.seDark],
            ['light', t.seLight],
          ]}
          value={theme}
          disabled={false}
          onChange={(v) => setTheme(v as Theme)}
        />,
        <SegRow
          key="lang"
          label={t.seLang}
          desc={t.seLangD}
          options={[
            ['en', 'EN'],
            ['tr', 'TR'],
          ]}
          value={lang}
          disabled={false}
          onChange={(v) => setLang(v as Lang)}
        />,
      ],
    },
  ]

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-col gap-[2px]">
        <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.settings}</h2>
        <p className="m-0 text-xs text-muted-fg text-pretty">{t.seLead}</p>
      </header>

      {!canEdit ? (
        <div className="flex min-w-0 items-center gap-[9px] rounded-[10px] border border-border bg-surface px-3 py-2">
          <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-destructive" />
          <span className="shrink-0 text-[11.5px] font-semibold">{t.c.readOnly}</span>
          <span className="min-w-0 text-[11.5px] text-muted-fg text-pretty">
            {t.c.readOnlyLead}
          </span>
        </div>
      ) : null}

      {sections.map((section) => (
        <div
          key={section.title}
          className="min-w-0 overflow-hidden rounded-[12px] border border-border"
        >
          <div className="border-b border-border bg-surface px-3 py-2">
            <Caps className="font-mono text-[8.5px] tracking-[0.12em] text-muted-fg">
              {section.title}
            </Caps>
          </div>
          {section.rows}
        </div>
      ))}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}

function RowShell({ label, desc, children }: { label: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border-soft px-3 py-[11px] last:border-b-0">
      <div className="flex min-w-[200px] flex-1 flex-col gap-[2px]">
        <span className="text-[12.5px] font-medium text-fg">{label}</span>
        <span className="text-[11px] leading-[1.45] text-muted-fg text-pretty">{desc}</span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SegRow<T extends string | number>({
  label,
  desc,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string
  desc: string
  options: Array<[T, string]>
  value: T
  disabled: boolean
  onChange: (value: T) => void
}) {
  return (
    <RowShell label={label} desc={desc}>
      <div className={cn(disabled && 'pointer-events-none opacity-50')}>
        <SegBar>
          {options.map(([optionValue, optionLabel]) => (
            <SegButton
              key={String(optionValue)}
              active={value === optionValue}
              onClick={() => onChange(optionValue)}
            >
              {optionLabel}
            </SegButton>
          ))}
        </SegBar>
      </div>
    </RowShell>
  )
}

function ToggleRow({
  label,
  desc,
  on,
  disabled,
  onToggle,
}: {
  label: string
  desc: string
  on: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <RowShell label={label} desc={desc}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'relative flex h-[22px] w-[38px] items-center rounded-full border transition-colors',
          on ? 'border-brand bg-brand' : 'border-input bg-field',
        )}
      >
        <span
          className={cn(
            'absolute h-[16px] w-[16px] rounded-full transition-[left]',
            on ? 'left-[19px] bg-[#0A0A0A]' : 'left-[2px] bg-muted-fg',
          )}
        />
      </button>
    </RowShell>
  )
}

function ChipRow({
  label,
  desc,
  chips,
  empty,
}: {
  label: string
  desc: string
  chips: string[]
  empty: string
}) {
  return (
    <RowShell label={label} desc={desc}>
      <div className="flex flex-wrap justify-end gap-[6px]">
        {chips.length === 0 ? (
          <span className="text-[11px] text-muted-fg">{empty}</span>
        ) : (
          chips.map((chip) => (
            <span
              key={chip}
              className="rounded-[6px] border border-brand bg-field px-[9px] py-[3px] font-mono text-[10px] tracking-[0.04em] text-brand-fg"
            >
              {chip}
            </span>
          ))
        )}
      </div>
    </RowShell>
  )
}
