'use client'

import type { IssueCode, LingoOptions, LingoResult } from '@pascal-app/lingo'
import { englishMessages, lingo } from '@pascal-app/lingo'
import { LightbulbIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DemoFrame } from '@/components/site/demo-frame'
import { DocsPane, DocsSplitPaneSection } from '@/components/site/docs-split-pane'
import { JsonView } from '@/components/site/json-view'
import { Readout } from '@/components/site/readout'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { candidateLabel, resultToPlain } from '@/lib/lingo-display'
import { cn } from '@/lib/utils'

type Strictness = NonNullable<LingoOptions['strictness']>
type Typos = NonNullable<NonNullable<LingoOptions['tolerance']>['typos']>
type AcceptKey = keyof NonNullable<LingoOptions['accept']>

const MODES: Strictness[] = ['forgiving', 'confirm', 'strict']
const ACCEPT_KEYS: AcceptKey[] = [
  'ranges',
  'conversions',
  'compounds',
  'fuzzy',
  'numberWords',
  'approximations',
  'bareNumbers',
]
const MESSAGE_CODES: IssueCode[] = [
  'TYPO_CORRECTED',
  'UNIT_ASSUMED',
  'UNKNOWN_UNIT',
  'SINGLE_VALUE_EXPECTED',
]

function buildMessages(drafts: Partial<Record<IssueCode, string>>): LingoOptions['messages'] {
  return Object.fromEntries(
    Object.entries(drafts).filter((entry): entry is [IssueCode, string] =>
      Boolean(entry[1]?.trim()),
    ),
  )
}

function candidateInputValue(result: LingoResult): string | null {
  const label = candidateLabel(result)
  if (!label) {
    return null
  }
  return label.replace(/^Rejected:\s*/, '')
}

export function EscalationLab() {
  const [text, setText] = useState('5 meterz')
  const [commitAttempt, setCommitAttempt] = useState(0)
  const [shake, setShake] = useState(false)
  const [typos, setTypos] = useState<Typos>('fix')
  const [accept, setAccept] = useState<Record<AcceptKey, boolean>>({
    ranges: true,
    conversions: true,
    compounds: true,
    fuzzy: true,
    numberWords: true,
    approximations: true,
    bareNumbers: true,
  })
  const [messages, setMessages] = useState<Partial<Record<IssueCode, string>>>({
    TYPO_CORRECTED: 'That looks like a unit typo. Confirm before saving.',
    UNIT_ASSUMED: 'Choose an explicit unit before this value is stored.',
    UNKNOWN_UNIT: 'Try cm, m, ft, in, or kg.',
    SINGLE_VALUE_EXPECTED: 'Use one value here; ranges belong in the range field.',
  })

  const sharedOptions = useMemo(
    () =>
      ({
        kind: 'length',
        unit: 'cm',
        accept,
        // Only send non-default knobs: explicit tolerance keys deliberately
        // override the strictness presets, so hardcoding defaults here would
        // neuter confirm/strict escalation (the demo's whole point).
        ...(typos === 'fix' ? {} : { tolerance: { typos } }),
        messages: buildMessages(messages),
      }) satisfies LingoOptions,
    [accept, messages, typos],
  )

  const results = useMemo(
    () =>
      Object.fromEntries(
        MODES.map((mode) => [mode, lingo(text, { ...sharedOptions, strictness: mode })]),
      ) as Record<Strictness, LingoResult>,
    [sharedOptions, text],
  )

  const confirmCandidate = candidateInputValue(results.confirm)
  const committedError = commitAttempt > 0 && !results.confirm.ok
  const resultsJson = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(MODES.map((mode) => [mode, resultToPlain(results[mode])])),
        null,
        2,
      ),
    [results],
  )
  const controlsJson = useMemo(
    () =>
      JSON.stringify(
        {
          accept,
          tolerance: { typos },
          messages: buildMessages(messages),
        },
        null,
        2,
      ),
    [accept, messages, typos],
  )

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
    if (results.confirm.ok) {
      setShake(false)
    } else {
      setCommitAttempt((count) => count + 1)
      pulseShake()
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <DemoFrame
        caption="Escalated issues keep their code; only severity moves."
        details={<JsonView heightClassName="h-72" label="Strictness output" value={resultsJson} />}
        detailsLabel="Output"
        stageClassName="min-h-[30rem]"
        title="Strictness comparison"
      >
        <section className="strictness-comparison grid gap-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="min-w-0">
              <p className="text-muted-foreground">
                One text runs through forgiving, confirm, and strict modes.
              </p>
            </div>

            <Field className="min-w-0" data-invalid={committedError ? true : undefined}>
              <FieldLabel htmlFor="escalation-input">Shared input</FieldLabel>
              <Input
                aria-describedby={
                  committedError ? 'escalation-help escalation-error' : 'escalation-help'
                }
                aria-invalid={committedError}
                className="parse-input h-11 rounded-[6px] text-base"
                data-parse-shake={shake}
                data-parse-state={
                  committedError ? 'error' : results.confirm.ok ? 'success' : 'idle'
                }
                id="escalation-input"
                onBlur={commit}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commit()
                  }
                }}
                value={text}
              />
              <FieldDescription id="escalation-help">
                The field is length-biased and assumes centimeters for bare numbers.
              </FieldDescription>
              {committedError ? (
                <FieldError id="escalation-error">{results.confirm.issues[0]?.message}</FieldError>
              ) : null}
            </Field>
          </div>

          {confirmCandidate ? (
            <Alert>
              <LightbulbIcon aria-hidden="true" />
              <AlertTitle>Did you mean {confirmCandidate}?</AlertTitle>
              <AlertDescription>
                Confirm blocks the value and keeps the accepted parse as{' '}
                <span className="numeric-mono">candidate</span>.
              </AlertDescription>
              <AlertAction>
                <Button
                  onClick={() => setText(confirmCandidate)}
                  // Prevent focus steal: the input's onBlur commit re-renders
                  // mid-click and the click lands on a swapped node.
                  onPointerDown={(event) => event.preventDefault()}
                  size="sm"
                  type="button"
                >
                  Accept {confirmCandidate}
                </Button>
              </AlertAction>
            </Alert>
          ) : null}

          <div className="strictness-modes grid gap-6">
            {MODES.map((mode) => (
              <div className="flex min-w-0 flex-col gap-2" key={mode}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 font-mono font-semibold text-sm">{mode}</div>
                  <span
                    className={cn(
                      'numeric-mono text-xs',
                      results[mode].ok ? 'text-muted-foreground' : 'text-destructive',
                    )}
                  >
                    ok={String(results[mode].ok)}
                  </span>
                </div>
                <Readout className="min-w-0" compact result={results[mode]} showJson={false} />
              </div>
            ))}
          </div>
        </section>
      </DemoFrame>

      <DemoFrame
        caption="Switches reject shapes while preserving the candidate parse."
        details={<JsonView heightClassName="h-72" label="Controls JSON" value={controlsJson} />}
        detailsLabel="Config"
        title="Acceptance controls"
      >
        <DocsSplitPaneSection>
          <DocsPane className="bg-muted/15" data-surface="escalation-acceptance-panel">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">Acceptance and tolerance</div>
                <p className="text-muted-foreground text-sm">
                  Reject parse shapes without discarding candidates.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <FieldLabel className="text-sm" htmlFor="typo-mode">
                  typos
                </FieldLabel>
                <Select
                  className="w-32"
                  id="typo-mode"
                  onValueChange={(value) => setTypos(value as Typos)}
                  options={(['fix', 'suggest', 'off'] satisfies Typos[]).map((option) => ({
                    value: option,
                    label: option,
                  }))}
                  value={typos}
                />
              </div>
            </div>
            <FieldGroup className="gap-3">
              {ACCEPT_KEYS.map((key) => (
                <Field
                  className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-[4px] bg-muted/50 px-3 py-2"
                  key={key}
                  orientation="horizontal"
                >
                  <FieldLabel
                    className="numeric-mono min-w-0 break-words text-xs"
                    htmlFor={`accept-${key}`}
                  >
                    accept.{key}
                  </FieldLabel>
                  <Switch
                    aria-label={`Toggle accept.${key}`}
                    checked={accept[key]}
                    id={`accept-${key}`}
                    onCheckedChange={(checked) =>
                      setAccept((current) => ({ ...current, [key]: checked }))
                    }
                  />
                </Field>
              ))}
            </FieldGroup>
          </DocsPane>

          <DocsPane className="bg-muted/15" data-surface="escalation-messages-panel">
            <div className="mb-4">
              <div className="font-medium">Message overrides</div>
              <p className="text-muted-foreground text-sm">Messages pass into every parser call.</p>
            </div>
            <FieldGroup className="gap-3">
              {MESSAGE_CODES.map((code) => (
                <Field key={code}>
                  <FieldLabel
                    className="numeric-mono min-w-0 break-words text-xs"
                    htmlFor={`message-${code}`}
                  >
                    {code}
                  </FieldLabel>
                  <Textarea
                    className="min-h-20 resize-y rounded-[6px] text-sm"
                    id={`message-${code}`}
                    onChange={(event) =>
                      setMessages((current) => ({
                        ...current,
                        [code]: event.target.value,
                      }))
                    }
                    placeholder={String(englishMessages[code] ?? code)}
                    value={messages[code] ?? ''}
                  />
                </Field>
              ))}
            </FieldGroup>
          </DocsPane>
        </DocsSplitPaneSection>
      </DemoFrame>
    </div>
  )
}
