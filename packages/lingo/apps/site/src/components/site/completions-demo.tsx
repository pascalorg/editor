'use client'

import { createLingo } from '@pascal-app/lingo'
import { type Completion, completions } from '@pascal-app/lingo/complete'
import { parseDate, parseDateRange } from '@pascal-app/lingo/date'
import { enGb } from '@pascal-app/lingo/locales/en-gb'
import { es } from '@pascal-app/lingo/locales/es'
import { fr } from '@pascal-app/lingo/locales/fr'
import { ja } from '@pascal-app/lingo/locales/ja'
import { pt } from '@pascal-app/lingo/locales/pt'
import { zh } from '@pascal-app/lingo/locales/zh'
import { useLingoInput } from '@pascal-app/lingo/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { DocsPane, DocsSplitPaneSection } from '@/components/site/docs-split-pane'
import { LocaleBadge } from '@/components/site/locale-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { localeMeta } from '@/lib/locale-meta'
import { cn } from '@/lib/utils'

const EXAMPLES = ['2 f', '10 kg to 16', '$10', 'noon tomorrow'] as const
const DEBOUNCE_MS = 140
const DEMO_NOW = new Date('2026-07-10T12:00:00Z')

const LANGUAGE_EXAMPLES = ['dos kg', 'deux kg', 'dois kg', '5公斤', '5キロ', '12 stone'] as const

const UNIT_PRESETS = [
  { id: 'shipping', label: 'Shipping', units: ['kg', 'lb'] },
  { id: 'height', label: 'Height', units: ['cm', 'ft', 'in'] },
  { id: 'storage', label: 'Storage', units: ['GB', 'MB'] },
] as const

type UnitPreset = (typeof UNIT_PRESETS)[number]

const localeLingo = createLingo({ locales: [es, fr, pt, zh, ja, enGb] })

function completionOptions() {
  return {
    date: (text: string) => {
      const single = parseDate(text, { now: DEMO_NOW })
      return single.ok ? single : parseDateRange(text, { now: DEMO_NOW })
    },
    limit: 4,
  }
}

function canonicalResult(result: ReturnType<typeof localeLingo.parse>) {
  if (!result.ok) {
    return 'Not parsed'
  }
  if (result.type === 'quantity') {
    return result.quantity.format()
  }
  if (result.type === 'range') {
    return result.range.format()
  }
  if (result.type === 'conversion') {
    return result.converted.format()
  }
  return 'Parsed'
}

function DemoHeading({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-[525] text-[13px] text-foreground leading-none">{title}</h3>
      <p className="max-w-[58ch] text-muted-foreground text-sm">{caption}</p>
    </div>
  )
}

function RankedList({
  activeIndex,
  items,
  listId,
  onActiveIndexChange,
  onPick,
  pending = false,
}: {
  activeIndex: number
  items: readonly Completion[]
  listId: string
  onActiveIndexChange: (index: number) => void
  onPick: (item: Completion) => void
  pending?: boolean
}) {
  if (items.length === 0) {
    return <p className="py-3 text-muted-foreground text-sm">No suggestions yet.</p>
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 transition-opacity duration-150',
        pending && 'opacity-60',
      )}
      id={listId}
      role="listbox"
    >
      {items.map((item, index) => (
        <Button
          aria-selected={activeIndex === index}
          className={cn(
            'h-10 w-full justify-between gap-4 rounded-[6px] px-3 text-left font-normal shadow-none',
            activeIndex === index ? 'bg-muted/70' : 'hover:bg-muted/45',
          )}
          id={`${listId}-item-${index}`}
          key={`${item.source}-${item.text}`}
          onClick={() => onPick(item)}
          onMouseEnter={() => onActiveIndexChange(index)}
          role="option"
          tabIndex={-1}
          type="button"
          variant="ghost"
        >
          <span className="min-w-0 truncate font-medium text-foreground text-sm">{item.text}</span>
          <span className="numeric-mono shrink-0 text-muted-foreground text-xs">
            {Math.round(item.confidence * 100)}%
          </span>
        </Button>
      ))}
    </div>
  )
}

function RankedAutocompleteDemo() {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const field = useLingoInput({
    debounce: DEBOUNCE_MS,
    listboxId: listId,
    complete: (text: string) => completions(text, completionOptions()),
  })
  const items = field.completions as readonly Completion[]
  const { highlightedIndex: activeIndex } = field
  const activeId =
    activeIndex >= 0 && items.length > 0 ? `${listId}-item-${activeIndex}` : undefined

  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node
      field.ref(node)
    },
    [field.ref],
  )

  const updateValue = useCallback((next: string) => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.value = next
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, [])

  useEffect(() => updateValue('2 f'), [updateValue])

  return (
    <DocsSplitPaneSection aria-label="Ranked autocomplete example">
      <DocsPane>
        <DemoHeading
          caption="One field in, a short list of complete, canonical readings out."
          title="Partial input"
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${listId}-input`}>Type a partial value</Label>
          <Input
            aria-activedescendant={activeId}
            autoComplete="off"
            className="rounded-[6px]"
            id={`${listId}-input`}
            onKeyDownCapture={(event) => {
              if (items.length === 0) {
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                field.setHighlightedIndex(activeIndex + 1)
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                field.setHighlightedIndex(activeIndex - 1)
              }
              if (event.key === 'Enter' && activeIndex >= 0) {
                event.preventDefault()
                event.stopPropagation()
                field.selectCompletion(activeIndex)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            ref={setInputRef}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Try</span>
          {EXAMPLES.map((example) => (
            <button
              className="font-mono text-muted-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-foreground"
              key={example}
              onClick={() => updateValue(example)}
              type="button"
            >
              {example}
            </button>
          ))}
        </div>
      </DocsPane>

      <DocsPane aria-label="Ranked suggestions">
        <DemoHeading
          caption="Every row is a successful parse, ordered by confidence."
          title="Ranked suggestions"
        />
        <RankedList
          activeIndex={activeIndex}
          items={items}
          listId={listId}
          onActiveIndexChange={field.setHighlightedIndex}
          onPick={(item) => field.selectCompletion(items.indexOf(item))}
        />
      </DocsPane>
    </DocsSplitPaneSection>
  )
}

function LanguageDemo() {
  const inputId = useId()
  const resultId = `${inputId}-result`
  const [value, setValue] = useState('dos kg')
  const result = useMemo(() => localeLingo.parse(value), [value])
  const meta = result.ok ? localeMeta(result.locale ?? 'en') : undefined

  return (
    <DocsSplitPaneSection aria-label="Multi-language input example">
      <DocsPane>
        <DemoHeading
          caption="Load the packs you need, then let one field understand how people actually type."
          title="Many languages, one field"
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId}>Try any language</Label>
          <Input
            aria-describedby={resultId}
            aria-invalid={!result.ok}
            autoComplete="off"
            className="rounded-[6px]"
            id={inputId}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Try dos, deux, 公斤…"
            value={value}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Try</span>
          {LANGUAGE_EXAMPLES.map((example) => (
            <button
              className="font-mono text-muted-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-foreground"
              key={example}
              onClick={() => setValue(example)}
              type="button"
            >
              {example}
            </button>
          ))}
        </div>
      </DocsPane>

      <DocsPane aria-label="Detected locale and canonical value">
        <DemoHeading
          caption="Locale and canonical value stay visible without a language picker."
          title="Understood as you type"
        />
        {result.ok ? (
          <div
            aria-live="polite"
            className="flex min-h-24 flex-col justify-center gap-3"
            id={resultId}
          >
            <p className="break-words font-mono font-semibold text-2xl text-foreground">
              {canonicalResult(result)}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <LocaleBadge locale={result.locale ?? 'en'} />
              <span className="text-muted-foreground">{meta?.label ?? 'English'}</span>
              <span aria-hidden="true" className="text-muted-foreground/50">
                ·
              </span>
              <span className="font-mono text-muted-foreground">{result.type}</span>
            </div>
          </div>
        ) : (
          <p aria-live="polite" className="py-3 text-destructive text-sm" id={resultId}>
            {result.issues[0]?.message ?? 'This input could not be parsed.'}
          </p>
        )}
      </DocsPane>
    </DocsSplitPaneSection>
  )
}

function UnitControlDemo() {
  const listId = useId()
  const [preset, setPreset] = useState<UnitPreset>(UNIT_PRESETS[0])
  const [value, setValue] = useState('5')
  const [activeIndex, setActiveIndex] = useState(0)
  const items = useMemo(
    () => completions(value, { units: preset.units, limit: preset.units.length }),
    [preset, value],
  )
  const activeId =
    items.length > 0 ? `${listId}-item-${Math.min(activeIndex, items.length - 1)}` : undefined

  function updateValue(next: string) {
    setValue(next)
    setActiveIndex(0)
  }

  return (
    <DocsSplitPaneSection aria-label="Controlled unit suggestions example">
      <DocsPane>
        <DemoHeading
          caption="The product chooses the useful units for each field. The user only types a value."
          title="Your field, your units"
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium text-sm">Field context</legend>
          <div className="flex flex-wrap gap-1.5">
            {UNIT_PRESETS.map((option) => (
              <Button
                aria-pressed={preset.id === option.id}
                className="shadow-none"
                key={option.id}
                onClick={() => {
                  setPreset(option)
                  setActiveIndex(0)
                }}
                size="sm"
                type="button"
                variant={preset.id === option.id ? 'secondary' : 'outline'}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${listId}-input`}>Value</Label>
          <Input
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={items.length > 0}
            autoComplete="off"
            className="rounded-[6px]"
            id={`${listId}-input`}
            inputMode="decimal"
            onChange={(event) => updateValue(event.target.value)}
            onKeyDown={(event) => {
              if (items.length === 0) {
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, items.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              }
              if (event.key === 'Enter' && items[activeIndex]) {
                event.preventDefault()
                updateValue(items[activeIndex]!.text)
              }
            }}
            role="combobox"
            value={value}
          />
        </div>
        <p className="font-mono text-muted-foreground text-xs">
          units: [{preset.units.map((unit) => `"${unit}"`).join(', ')}]
        </p>
      </DocsPane>

      <DocsPane aria-label="Controlled unit suggestions">
        <DemoHeading
          caption={`Only ${preset.label.toLocaleLowerCase()} units are offered for this field.`}
          title="Useful suggestions only"
        />
        <RankedList
          activeIndex={activeIndex}
          items={items}
          listId={listId}
          onActiveIndexChange={setActiveIndex}
          onPick={(item) => updateValue(item.text)}
        />
      </DocsPane>
    </DocsSplitPaneSection>
  )
}

export function CompletionsDemo() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <RankedAutocompleteDemo />
      <LanguageDemo />
      <UnitControlDemo />
    </div>
  )
}
