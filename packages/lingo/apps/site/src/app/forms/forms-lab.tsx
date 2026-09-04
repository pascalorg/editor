'use client'

import { parseRange } from '@pascal-app/lingo'
import type { LingoField, LingoInputOptions } from '@pascal-app/lingo/dom'
import { lingoInput } from '@pascal-app/lingo/dom'
import { useLingoInput } from '@pascal-app/lingo/react'
import { WandSparklesIcon } from 'lucide-react'
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PlainCodeBlock } from '@/components/site/code-block-frame'
import { DemoFrame } from '@/components/site/demo-frame'
import { JsonView } from '@/components/site/json-view'
import { RangeSliderField } from '@/components/site/range-slider-field'
import { Readout } from '@/components/site/readout'
import { ReadoutGrid, ReadoutGridItem } from '@/components/site/readout-grid'
import { StateChips } from '@/components/site/state-chips'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

function useDomField(opts: LingoInputOptions, initialValue: string) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [el, setEl] = useState<HTMLInputElement | null>(null)
  const [field, setField] = useState<LingoField | null>(null)
  const [tick, setTick] = useState(0)

  // Callers pass inline option literals. Depend on their VALUE, not their
  // per-render identity, or the effect re-attaches forever (React #185).
  // Latest-ref written post-render (compiler-safe).
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })
  const optsSig = JSON.stringify(opts)

  useEffect(() => {
    const node = el
    if (!node) {
      return
    }

    const bound = lingoInput(node, optsRef.current)
    setField(bound)
    if (initialValue) {
      bound.set(initialValue)
      bound.commit()
    }
    // No synchronous seed tick: setField(bound) above already re-renders with
    // the bound controller, and its committed state is readable at render.
    const update = () => setTick((value) => value + 1)
    node.addEventListener('lingo:change', update)
    node.addEventListener('input', update)
    node.addEventListener('blur', update)

    return () => {
      node.removeEventListener('lingo:change', update)
      node.removeEventListener('input', update)
      node.removeEventListener('blur', update)
      bound.destroy()
      setField(null)
    }
  }, [initialValue, optsSig, el])

  const ref = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node
    setEl(node)
  }, [])

  return { ref, el, field, tick }
}

function FieldShell({
  id,
  title,
  description,
  code,
  children,
}: {
  id?: string
  title: string
  description: string
  code: string
  children: ReactNode
}) {
  return (
    <div className="scroll-mt-20" data-surface="forms-field-shell" id={id}>
      <DemoFrame
        caption={description}
        details={
          <PlainCodeBlock
            clampLongCode={false}
            className="rounded-none shadow-none"
            code={code}
            lang="tsx"
          />
        }
        stageClassName="min-h-[18rem] sm:min-h-[20rem]"
        title={title}
      >
        <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-4">{children}</div>
      </DemoFrame>
    </div>
  )
}

function FieldStatus({ el }: { el: Element | null }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-md bg-muted/25 p-3"
      data-surface="forms-field-status"
    >
      <div className="font-medium text-muted-foreground text-xs">data attributes</div>
      <StateChips el={el} />
    </div>
  )
}

function ReactHookCard() {
  const id = useId()
  const hook = useLingoInput({
    kind: 'length',
    unit: 'm',
    name: 'react_height_m',
  })
  const [el, setEl] = useState<HTMLInputElement | null>(null)
  // hook.ref is stable; destructure it so the memo depends on the stable
  // callback, not the fresh-per-render hook object.
  const { ref: hookRef } = hook
  const ref = useCallback(
    (node: HTMLInputElement | null) => {
      setEl(node)
      hookRef(node)
    },
    [hookRef],
  )

  return (
    <FieldShell
      code={`const field = useLingoInput({\n  kind: "length",\n  unit: "m",\n  name: "react_height_m",\n})`}
      description="One ref carries state, value, and programmatic control."
      title="React hook"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={id}>Height</FieldLabel>
          <Input defaultValue={'5\'11"'} id={id} placeholder={'try 5\'11" or 180cm'} ref={ref} />
        </Field>
      </FieldGroup>
      <ReadoutGrid className="sm:grid-cols-2">
        <ReadoutGridItem label="state">{hook.state}</ReadoutGridItem>
        <ReadoutGridItem label="value">{hook.value ?? 'null'}</ReadoutGridItem>
      </ReadoutGrid>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => hook.set('6ft')} size="sm" type="button">
          {'set("6ft")'}
        </Button>
        <Button onClick={() => hook.commit()} size="sm" type="button" variant="outline">
          commit()
        </Button>
      </div>
      <FieldStatus el={el} />
    </FieldShell>
  )
}

function VanillaCard() {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const opts = useMemo<LingoInputOptions>(
    () => ({
      kind: 'mass',
      unit: 'kg',
      name: 'vanilla_mass_kg',
      errorElement: `#${errorId}`,
      hintElement: `#${hintId}`,
    }),
    [errorId, hintId],
  )
  const { ref, el } = useDomField(opts, '2 lb 3 oz')

  return (
    <FieldShell
      code={`useEffect(() => {\n  const field = lingoInput(input, {\n    kind: "mass",\n    unit: "kg",\n    name: "vanilla_mass_kg",\n  })\n  return () => field.destroy()\n}, [])`}
      description="The DOM contract stays headless outside React."
      title="Vanilla controller"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={id}>Package weight</FieldLabel>
          <Input
            aria-describedby={`${hintId} ${errorId}`}
            id={id}
            placeholder="2 lb 3 oz"
            ref={ref}
          />
          <FieldDescription className="min-h-5" id={hintId} />
          <p className="min-h-5 text-destructive text-sm" id={errorId} />
        </Field>
      </FieldGroup>
      <FieldStatus el={el} />
    </FieldShell>
  )
}

function NativeValidationCard() {
  const id = useId()
  const errorId = `${id}-error`
  const opts = useMemo<LingoInputOptions>(
    () => ({
      kind: 'length',
      unit: 'm',
      required: true,
      validationBehavior: 'native',
      name: 'native_length_m',
      errorElement: `#${errorId}`,
    }),
    [errorId],
  )
  const { ref, el } = useDomField(opts, '')
  const [submitted, setSubmitted] = useState('not submitted')

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted('browser accepted submit')
  }

  return (
    <FieldShell
      code={`lingoInput(input, {\n  kind: "length",\n  unit: "m",\n  required: true,\n  validationBehavior: "native",\n})`}
      description="Native validation blocks submit after parser commit."
      title="Native validation"
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={id}>Required length</FieldLabel>
            <Input
              aria-describedby={errorId}
              id={id}
              placeholder="try leaving empty, then submit"
              ref={ref}
            />
            <p className="min-h-5 text-destructive text-sm" id={errorId} />
          </Field>
        </FieldGroup>
        <Button size="sm" type="submit">
          Submit native form
        </Button>
        <p className="numeric-mono text-muted-foreground text-sm">{submitted}</p>
      </form>
      <FieldStatus el={el} />
    </FieldShell>
  )
}

function DisplayField({ mode }: { mode: 'canonical' | 'echo' | 'preserve' }) {
  const id = useId()
  const opts = useMemo<LingoInputOptions>(
    () => ({
      kind: 'length',
      unit: 'm',
      display: mode,
      name: `${mode}_height_m`,
    }),
    [mode],
  )
  const { ref, el } = useDomField(opts, '5ft 11in')

  return (
    <Field
      className="flex flex-col gap-2 rounded-md bg-muted/25 p-3"
      data-surface="forms-display-field"
    >
      <FieldLabel className="numeric-mono" htmlFor={id}>
        display={mode}
      </FieldLabel>
      <Input id={id} ref={ref} />
      <StateChips el={el} />
    </Field>
  )
}

function DisplayModesCard() {
  return (
    <FieldShell
      code={`lingoInput(input, {\n  kind: "length",\n  unit: "m",\n  display: "canonical" | "echo" | "preserve",\n})`}
      description="Canonical rewrites; echo formats; preserve keeps user text."
      title="Display modes"
    >
      <FieldGroup className="gap-3">
        {(['canonical', 'echo', 'preserve'] as const).map((mode) => (
          <DisplayField key={mode} mode={mode} />
        ))}
      </FieldGroup>
    </FieldShell>
  )
}

function ConstraintsCard() {
  const id = useId()
  const errorId = `${id}-error`
  const opts = useMemo<LingoInputOptions>(
    () => ({
      kind: 'length',
      unit: 'm',
      min: '50cm',
      max: '8ft',
      required: true,
      name: 'constrained_height_m',
      errorElement: `#${errorId}`,
    }),
    [errorId],
  )
  const { ref, el } = useDomField(opts, '30cm')

  return (
    <FieldShell
      code={`lingoInput(input, {\n  kind: "length",\n  unit: "m",\n  min: "50cm",\n  max: "8ft",\n  required: true,\n})`}
      description="Bounds fail at commit with spans on original text."
      title="Constraints"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={id}>Height with bounds</FieldLabel>
          <Input aria-describedby={errorId} id={id} placeholder="50cm to 8ft" ref={ref} />
          <p className="min-h-5 text-destructive text-sm" id={errorId} />
        </Field>
      </FieldGroup>
      <FieldStatus el={el} />
    </FieldShell>
  )
}

function RangeCard() {
  const id = useId()
  const singleId = `${id}-single`
  const [rangeText, setRangeText] = useState('between 5 and 10 kg')
  const rangeResult = useMemo(() => parseRange(rangeText, { kind: 'mass' }), [rangeText])
  const opts = useMemo<LingoInputOptions>(
    () => ({
      kind: 'mass',
      unit: 'kg',
      accept: { ranges: false },
      strictness: 'confirm',
      name: 'single_mass_kg',
      formatCandidate: (candidate) =>
        candidate.type === 'range' ? `Use range ${candidate.range.format()}` : 'Use value',
    }),
    [],
  )
  const { ref, el } = useDomField(opts, 'between 5 and 10 kg')

  return (
    <FieldShell
      code={`parseRange(text, { kind: "mass" })\n\nlingoInput(input, {\n  kind: "mass",\n  unit: "kg",\n  accept: { ranges: false },\n  strictness: "confirm",\n})`}
      description="A rejected range remains available as a candidate."
      title="Range vs single"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={id}>Range parser</FieldLabel>
          <Input id={id} onChange={(event) => setRangeText(event.target.value)} value={rangeText} />
        </Field>
      </FieldGroup>
      <Readout compact result={rangeResult} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={singleId}>Single-value field</FieldLabel>
          <Input id={singleId} ref={ref} />
        </Field>
      </FieldGroup>
      <FieldStatus el={el} />
    </FieldShell>
  )
}

function ProgrammaticCard() {
  const id = useId()
  const formRef = useRef<HTMLFormElement | null>(null)
  const opts = useMemo<LingoInputOptions>(
    () => ({
      kind: 'length',
      unit: 'm',
      name: 'agent_height_m',
      display: 'canonical',
    }),
    [],
  )
  const { ref, el, field } = useDomField(opts, '180cm')
  const [preview, setPreview] = useState('{}')

  const refreshPreview = useCallback(() => {
    const form = formRef.current
    if (!form) {
      setPreview('{}')
      return
    }
    const entries = Array.from(new FormData(form).entries()).map(([key, value]) => [
      key,
      String(value),
    ])
    setPreview(JSON.stringify(Object.fromEntries(entries), null, 2))
  }, [])

  // Subscribe to the form itself instead of chaining off the render tick.
  // lingo:change bubbles from the field on every committed change, including
  // programmatic set()/commit().
  useEffect(() => {
    const form = formRef.current
    if (!form) {
      return
    }
    const refresh = () => refreshPreview()
    form.addEventListener('input', refresh)
    form.addEventListener('lingo:change', refresh)
    refresh()
    return () => {
      form.removeEventListener('input', refresh)
      form.removeEventListener('lingo:change', refresh)
    }
  }, [refreshPreview])

  function setField(value: string | number) {
    field?.set(value)
    field?.commit()
  }

  return (
    <FieldShell
      code={`const field = lingoInput(input, {\n  kind: "length",\n  unit: "m",\n  name: "agent_height_m",\n})\n\nfield.set("6ft")\nfield.set(1.8)`}
      description="Automation sets visible text; FormData submits canonical value."
      title="Agent and hidden value"
    >
      <form className="flex flex-col gap-3" ref={formRef}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={id}>Programmatic height</FieldLabel>
            <Input id={id} ref={ref} />
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setField('6ft')} size="sm" type="button">
            {'set("6ft")'}
          </Button>
          <Button onClick={() => setField(1.8)} size="sm" type="button" variant="outline">
            set(1.8)
          </Button>
        </div>
      </form>
      <FieldStatus el={el} />
      <div
        className="flex flex-col gap-2 rounded-md bg-muted/25 p-3"
        data-surface="forms-formdata-preview"
      >
        <div className="flex items-center gap-2 font-medium text-sm">
          <WandSparklesIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          FormData preview
        </div>
        <JsonView heightClassName="h-64" label="FormData preview" value={preview} />
      </div>
    </FieldShell>
  )
}

export function FormsLab() {
  return (
    <DemoFrame
      caption="Fields never rewrite while typing; commits canonicalize once."
      stageSurface="plain"
      title="DOM and React forms"
    >
      <section className="flex min-w-0 flex-col gap-4">
        <FieldShell
          code={`const [text, setText] = useState("8 to 12 kg")\nconst [range, setRange] = useState<[number, number]>([8, 12])\n\nparseRange(text, { kind: "mass", unit: "kg" })\n\n<Slider\n  min={0}\n  max={30}\n  step={0.1}\n  value={range}\n  onValueChange={(next) => {\n    setRange(next)\n    setText(\`\${next[0]} to \${next[1]} kg\`)\n  }}\n/>`}
          description="Text parses to thumbs; pointer and keyboard movement humanizes back to text."
          id="forms-range-slider"
          title="Bidirectional range slider"
        >
          <RangeSliderField />
        </FieldShell>
        <ReactHookCard />
        <VanillaCard />
        <NativeValidationCard />
        <DisplayModesCard />
        <ConstraintsCard />
        <RangeCard />
        <ProgrammaticCard />
      </section>
    </DemoFrame>
  )
}
