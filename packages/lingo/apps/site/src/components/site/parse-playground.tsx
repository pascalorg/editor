'use client'

import { createLingo } from '@pascal-app/lingo'
import { enGb } from '@pascal-app/lingo/locales/en-gb'
import { es } from '@pascal-app/lingo/locales/es'
import { fr } from '@pascal-app/lingo/locales/fr'
import { ja } from '@pascal-app/lingo/locales/ja'
import { pt } from '@pascal-app/lingo/locales/pt'
import { zh } from '@pascal-app/lingo/locales/zh'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DocsPane, DocsSplitPaneSection } from '@/components/site/docs-split-pane'
import { JsonView } from '@/components/site/json-view'
import { LocaleBadge, LocaleSelect } from '@/components/site/locale-select'
import { Readout } from '@/components/site/readout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resultToPlain } from '@/lib/lingo-display'
import type { LocaleChoice } from '@/lib/locale-meta'
import { cn } from '@/lib/utils'

const localeLingo = createLingo({ locales: [es, fr, pt, zh, ja, enGb] })

const EXAMPLES: Record<LocaleChoice, readonly string[]> = {
  auto: ['72 in to cm', 'dos kg', 'entre 5 et 10 kg', '5公斤', '暑い'],
  en: [
    '2 ft',
    '72 in to cm',
    'between 5 and 10 kg',
    'between one thousand and two thousand meters',
    "it's hot",
  ],
  es: [
    'dos kg',
    'entre 5 y 10 kg',
    '72 pulgadas a cm',
    'ciento veinte kg',
    'mil millones de kg',
    'al menos 2 m',
  ],
  fr: [
    'deux kg',
    'entre 5 et 10 kg',
    '72 pouces en cm',
    'mille cinq cents metres',
    'deux metres et demi',
  ],
  pt: ['dois kg', 'entre 5 e 10 kg', 'cento e vinte metros', 'mil e quinhentos metros'],
  zh: ['5公斤', '5公斤以上', '5公斤以下', '五公斤左右', '100元', '很热'],
  ja: ['5キロ', '5キロ未満', '5キロ以上', '5キロぐらい', '1000円', '暑い'],
  'en-gb': ['12 stone', '3 quid', 'roundabout 2 m'],
}

export function ParsePlayground() {
  const [value, setValue] = useState('72 in to cm')
  const [locale, setLocale] = useState<LocaleChoice>('auto')
  const [commitAttempt, setCommitAttempt] = useState(0)
  const [shake, setShake] = useState(false)
  const options = useMemo(
    () => ({
      kind: /hot|热|暑い/i.test(value) ? ('temperature' as const) : undefined,
      ...(locale !== 'auto' && { locale }),
    }),
    [locale, value],
  )
  const result = useMemo(() => localeLingo.parse(value, options), [options, value])
  const state = useMemo(() => localeLingo.partialState(value, options), [options, value])
  const resultJson = useMemo(() => JSON.stringify(resultToPlain(result), null, 2), [result])
  const committedError = commitAttempt > 0 && !result.ok
  const examples = EXAMPLES[locale]

  const shakeFrameRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (shakeFrameRef.current !== null) {
        window.cancelAnimationFrame(shakeFrameRef.current)
      }
    },
    [],
  )

  // Shake is a commit-time pulse, not derived state: reset then re-set on the
  // next frame so the CSS animation restarts on every failed attempt.
  function pulseShake() {
    setShake(false)
    if (shakeFrameRef.current !== null) {
      window.cancelAnimationFrame(shakeFrameRef.current)
    }
    shakeFrameRef.current = window.requestAnimationFrame(() => {
      shakeFrameRef.current = null
      setShake(true)
    })
  }

  function commit() {
    if (result.ok) {
      setShake(false)
    } else {
      setCommitAttempt((count) => count + 1)
      pulseShake()
    }
  }

  return (
    <DocsSplitPaneSection aria-labelledby="parse-playground-title">
      <DocsPane>
        <div className="flex flex-col gap-1">
          <h3
            className="font-[525] text-[13px] text-foreground leading-none"
            id="parse-playground-title"
          >
            Parse readout
          </h3>
          <p className="text-muted-foreground text-sm">
            Warnings can succeed; only errors block the value.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <Label htmlFor="parse-input">Try a parse</Label>
            </div>
            <div className="flex min-w-36 flex-col gap-1.5">
              <Label htmlFor="parse-locale">Locale</Label>
              <LocaleSelect
                id="parse-locale"
                onValueChange={(choice) => {
                  setLocale(choice)
                  setValue(EXAMPLES[choice][0] ?? '')
                  setCommitAttempt(0)
                  setShake(false)
                }}
                value={locale}
              />
            </div>
          </div>
          <Input
            aria-describedby="parse-state parse-error"
            aria-invalid={committedError}
            autoComplete="off"
            className={cn('parse-input h-11 rounded-[6px] text-base')}
            data-parse-shake={shake}
            data-parse-state={committedError ? 'error' : result.ok ? 'success' : 'idle'}
            id="parse-input"
            name="parse-input"
            onBlur={commit}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commit()
              }
            }}
            value={value}
          />
          <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground" id="parse-state">
              state: <span className="numeric-mono text-foreground">{state}</span>
            </span>
            <span className="text-muted-foreground">
              locale:{' '}
              {result.ok ? (
                <LocaleBadge locale={result.locale ?? 'en'} />
              ) : (
                <span className="numeric-mono text-foreground">—</span>
              )}
            </span>
            <span className="text-destructive" id="parse-error">
              {committedError ? result.issues[0]?.message : ''}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {examples.map((example) => (
            <Button
              key={example}
              onClick={() => setValue(example)}
              size="sm"
              type="button"
              variant={value === example ? 'secondary' : 'outline'}
            >
              {example}
            </Button>
          ))}
        </div>

        <Readout className="min-w-0" result={result} showJson={false} surface="plain" />
      </DocsPane>

      <JsonView
        className="h-full"
        heightClassName="h-[32rem]"
        label="Raw JSON"
        value={resultJson}
      />
    </DocsSplitPaneSection>
  )
}
