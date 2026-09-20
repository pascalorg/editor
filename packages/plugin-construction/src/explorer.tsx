'use client'

import { Button } from '@pascal-app/editor/ui'
import {
  ArrowRight,
  Box,
  ChevronRight,
  Download,
  FileImage,
  FileText,
  ListChecks,
  ScanLine,
  Table2,
} from 'lucide-react'
import { useId, useState } from 'react'
import {
  CONSTRUCTION_OUTPUTS,
  CONSTRUCTION_WORKFLOW,
  type ConstructionOutput,
  ELEMENT_CATEGORIES,
  OUTPUT_FAMILIES,
  type OutputFamilyId,
} from './catalog'
import { type InventoryRecord, inventoryCsv } from './inventory'

type Destination = 'flow' | 'elements' | 'outputs'
const destinations = [
  { id: 'flow', label: 'Workflow' },
  { id: 'elements', label: 'Elements' },
  { id: 'outputs', label: 'Outputs' },
] as const
const outputIcons = {
  documents: FileText,
  images: FileImage,
  renders: ScanLine,
  objects: Box,
  data: Table2,
}

function OutputPlaceholder({ output }: { output: ConstructionOutput }) {
  const Icon = outputIcons[output.family]
  const format = OUTPUT_FAMILIES.find((family) => family.id === output.family)?.format
  return (
    <div
      className="flex min-h-36 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6"
      aria-hidden="true"
    >
      <div className="flex items-center gap-4 text-muted-foreground">
        <div
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border bg-background ${output.family === 'documents' ? 'h-24 w-18' : output.family === 'objects' ? 'size-22' : 'h-20 w-28'}`}
        >
          <Icon className="size-6" strokeWidth={1.25} />
          <span className="font-mono text-[0.625rem]">{format}</span>
        </div>
        <div className="space-y-2">
          <div className="h-1.5 w-20 rounded-full bg-border" />
          <div className="h-1.5 w-14 rounded-full bg-border" />
          <div className="h-1.5 w-17 rounded-full bg-border" />
        </div>
      </div>
    </div>
  )
}

function OutputDetails({
  output,
  records,
  scopeMessage,
}: {
  output: ConstructionOutput
  records?: readonly InventoryRecord[]
  scopeMessage?: string
}) {
  const [lastDownload, setLastDownload] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const csv = output.id === 'model-inventory' && records?.length ? inventoryCsv(records) : null
  const downloaded = csv !== null && lastDownload === csv
  const available = output.availability === 'available'
  const outputFamily = OUTPUT_FAMILIES.find((family) => family.id === output.family)
  const download = () => {
    if (!csv) return
    setDownloadError(null)
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'construction-model-inventory.csv'
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setLastDownload(csv)
    } catch {
      setDownloadError('The inventory could not be downloaded. Try again.')
    }
  }
  return (
    <article className="min-w-0 space-y-4 border-t bg-background p-4">
      <div>
        <p className="mb-2 text-muted-foreground text-xs">
          {outputFamily?.label} · {outputFamily?.format} ·{' '}
          {available ? 'Available in this preview' : 'Planned output · not generated'}
        </p>
        <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{output.description}</p>
      </div>
      <OutputPlaceholder output={output} />
      <dl className="space-y-4 text-sm">
        <div>
          <dt className="font-medium">Who it is for</dt>
          <dd className="mt-1 text-muted-foreground">{output.recipient}</dd>
        </div>
        <div>
          <dt className="font-medium">What you will receive</dt>
          <dd>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {output.includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-medium">Inputs to prepare</dt>
          <dd>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {output.requires.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      <p className="border-t pt-3 text-muted-foreground text-xs leading-relaxed">
        {output.limitation}
      </p>
      {available && (
        <div className="space-y-2">
          {csv ? (
            <Button className="w-full rounded-full" onClick={download} type="button">
              <Download className="size-4" />
              {downloaded ? 'Download inventory again' : 'Download model inventory'}
            </Button>
          ) : (
            <p className="rounded-lg bg-muted/40 p-3 text-sm">
              {scopeMessage ??
                (records
                  ? 'Add recognized model elements to create an inventory.'
                  : 'Open a project and install Construction to export its inventory.')}
            </p>
          )}
          <p className="text-muted-foreground text-xs" role="status">
            {downloadError ??
              (downloaded
                ? 'Download requested for the current inventory. No model changes were made.'
                : csv
                  ? `${records?.length} ${records?.length === 1 ? 'record' : 'records'} · CSV · generated from the current scope`
                  : '')}
          </p>
        </div>
      )}
    </article>
  )
}

export function ConstructionExplorer({
  records,
  scopeMessage,
}: {
  records?: readonly InventoryRecord[]
  scopeMessage?: string
}) {
  const id = useId()
  const [destination, setDestination] = useState<Destination>('flow')
  const [family, setFamily] = useState<OutputFamilyId | 'all'>('all')
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null)
  const outputs = CONSTRUCTION_OUTPUTS.filter(
    (output) => family === 'all' || output.family === family,
  )
  const counts = new Map(ELEMENT_CATEGORIES.map((category) => [category.id, 0]))
  for (const record of records ?? [])
    counts.set(record.category, (counts.get(record.category) ?? 0) + 1)
  const changeDestination = (next: Destination) => {
    setDestination(next)
    document.getElementById(`${id}-${next}`)?.focus()
  }

  return (
    <div className="@container min-w-0 text-foreground">
      <div
        aria-label="Construction guide"
        className="mb-5 flex gap-1 rounded-full border bg-muted/30 p-1"
        role="group"
      >
        {destinations.map((item) => (
          <Button
            aria-controls={`${id}-content`}
            aria-pressed={destination === item.id}
            className="min-w-0 flex-1 rounded-full px-2"
            id={`${id}-${item.id}`}
            key={item.id}
            onClick={() => setDestination(item.id)}
            type="button"
            variant={destination === item.id ? 'secondary' : 'ghost'}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div id={`${id}-content`}>
        {destination === 'flow' && (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg tracking-tight">From model to handoff</h3>
              <p className="mt-2 max-w-prose text-muted-foreground text-sm leading-relaxed">
                For homebuilders and the contractors and engineers reviewing their models. Start
                with an existing house, understand its construction, then choose what the next
                person needs.
              </p>
            </div>
            <ol className="divide-y rounded-xl border">
              {CONSTRUCTION_WORKFLOW.map((step, index) => (
                <li className="p-4" key={step.title}>
                  <div className="flex gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h4 className="font-medium text-sm">{step.title}</h4>
                      <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                        {step.description}
                      </p>
                      <p className="mt-2 text-xs">
                        <span className="text-muted-foreground">You leave with: </span>
                        {step.result}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="space-y-3">
              <h4 className="font-medium text-sm">What is available today</h4>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Explore the workflow, browse element categories and download a model inventory.
                Discipline review and generation outputs are being brought into this workspace.
              </p>
              <Button
                className="rounded-full"
                onClick={() => changeDestination('elements')}
                type="button"
              >
                Explore building elements
                <ArrowRight className="size-4" />
              </Button>
            </div>
            <details className="border-t pt-4 text-sm">
              <summary className="cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Starting without a model?
              </summary>
              <p className="mt-2 text-muted-foreground leading-relaxed">
                You can explore all categories and expected outputs here first. Use Pascal’s
                existing creation or import tools when you are ready. Optional site and house
                generation will join the same workflow.
              </p>
            </details>
          </div>
        )}
        {destination === 'elements' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-lg">Building elements</h3>
              <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                A map of the information Construction organizes. Expand a category to see its scope.
              </p>
            </div>
            {records && (
              <p className="rounded-lg bg-muted/40 p-3 text-sm">
                {scopeMessage ??
                  `${records.length} recognized ${records.length === 1 ? 'record' : 'records'} in this scope. Counts describe stored records, not physical quantities or completeness.`}
              </p>
            )}
            <div className="divide-y rounded-xl border">
              {ELEMENT_CATEGORIES.map((category) => (
                <details className="group p-4" key={category.id}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                    <span className="min-w-0 flex-1 font-medium text-sm">{category.label}</span>
                    {records && !scopeMessage && (
                      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                        {counts.get(category.id) || 'Not detected'}
                      </span>
                    )}
                  </summary>
                  <div className="mt-3 space-y-3 pl-6 text-sm">
                    <p className="text-muted-foreground">{category.description}</p>
                    <ul className="space-y-1">
                      {category.elements.map((element) => (
                        <li key={element}>{element}</li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground text-xs leading-relaxed">{category.note}</p>
                  </div>
                </details>
              ))}
            </div>
            <Button
              className="rounded-full"
              onClick={() => changeDestination('outputs')}
              type="button"
            >
              Explore expected outputs
              <ArrowRight className="size-4" />
            </Button>
          </div>
        )}
        {destination === 'outputs' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-lg">Expected outputs</h3>
              <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                See what each output is for before generating it. Planned outputs have no generated
                files yet.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="shrink-0 text-sm" htmlFor={`${id}-family`}>
                Output type
              </label>
              <select
                className="h-9 min-w-0 flex-1 rounded-full border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={`${id}-family`}
                onChange={(event) => setFamily(event.target.value as OutputFamilyId | 'all')}
                value={family}
              >
                <option value="all">All outputs</option>
                {OUTPUT_FAMILIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div aria-label="Output catalog" className="space-y-2" role="group">
              {outputs.map((output) => {
                const Icon = outputIcons[output.family]
                const expanded = selectedOutputId === output.id
                const format = OUTPUT_FAMILIES.find((item) => item.id === output.family)?.format
                return (
                  <div
                    className={`overflow-hidden rounded-xl border ${expanded ? 'border-foreground/30' : 'border-border'}`}
                    key={output.id}
                  >
                    <button
                      aria-controls={`${id}-${output.id}-details`}
                      aria-expanded={expanded}
                      className={`flex w-full items-start gap-3 rounded-xl p-3 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${expanded ? 'bg-accent/50' : ''}`}
                      onClick={() => setSelectedOutputId(expanded ? null : output.id)}
                      type="button"
                    >
                      <Icon
                        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                        strokeWidth={1.5}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-sm">{output.title}</span>
                        <span className="mt-1 block text-muted-foreground text-xs">
                          {format} ·{' '}
                          {output.availability === 'planned'
                            ? 'Planned · not generated'
                            : records?.length && !scopeMessage
                              ? 'Ready to export'
                              : 'Available with a model'}
                        </span>
                      </span>
                      <ChevronRight
                        className={`mt-1 size-4 shrink-0 text-muted-foreground ${expanded ? 'rotate-90' : ''}`}
                      />
                    </button>
                    <div hidden={!expanded} id={`${id}-${output.id}-details`}>
                      {expanded && (
                        <OutputDetails
                          output={output}
                          records={records}
                          scopeMessage={scopeMessage}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <p className="mt-6 flex items-start gap-2 border-t pt-4 text-muted-foreground text-xs leading-relaxed">
        <ListChecks className="mt-0.5 size-4 shrink-0" />
        Browsing this guide does not change the model. A category or output listing is not a claim
        of engineering completeness.
      </p>
    </div>
  )
}
