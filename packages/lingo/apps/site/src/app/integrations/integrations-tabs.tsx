'use client'

import { useLingoInput } from '@pascal-app/lingo/react'
import { useCallback, useId, useState } from 'react'
import { CodeBlockFrame } from '@/components/site/code-block-frame'
import type { HighlightedCodeTab } from '@/components/site/code-tabs-client'
import { DemoFrame } from '@/components/site/demo-frame'
import { DocsPane, DocsSplitPane } from '@/components/site/docs-split-pane'
import { ReadoutGrid, ReadoutGridItem } from '@/components/site/readout-grid'
import { StateChips } from '@/components/site/state-chips'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  type IntegrationLogoDefinition,
  IntegrationLogoMark,
  integrationLogoStyle,
  integrationLogos,
} from './integration-logos'

const runnableCardClassName = 'mx-auto w-full max-w-2xl rounded-xl bg-muted/15 shadow-raise-sm'

const integrationGroups = [
  {
    label: 'Browser',
    values: ['vanilla', 'web-component'],
  },
  {
    label: 'React forms',
    values: ['react', 'react-hook-form', 'tanstack', 'shadcn'],
  },
  {
    label: 'Runtimes',
    values: ['next', 'vue', 'svelte', 'node', 'agents'],
  },
] as const

const integrationMeta: Record<
  string,
  {
    description: string
    logo: IntegrationLogoDefinition
  }
> = {
  vanilla: {
    description: 'DOM controller',
    logo: integrationLogos.javascript,
  },
  react: {
    description: 'Hook adapter',
    logo: integrationLogos.react,
  },
  'react-hook-form': {
    description: 'Resolver schema',
    logo: integrationLogos.reacthookform,
  },
  tanstack: {
    description: 'Field bridge',
    logo: integrationLogos.tanstack,
  },
  shadcn: {
    description: 'Field component',
    logo: integrationLogos.shadcnui,
  },
  'web-component': {
    description: 'Custom element',
    logo: integrationLogos.webcomponentsdotorg,
  },
  next: {
    description: 'Server action',
    logo: integrationLogos.nextdotjs,
  },
  vue: {
    description: 'Composable',
    logo: integrationLogos.vuedotjs,
  },
  svelte: {
    description: 'Action',
    logo: integrationLogos.svelte,
  },
  node: {
    description: 'API validation',
    logo: integrationLogos.nodedotjs,
  },
  agents: {
    description: 'Tool boundary',
    logo: integrationLogos.anthropic,
  },
}

function getIntegrationMeta(snippet: HighlightedCodeTab) {
  return (
    integrationMeta[snippet.value] ?? {
      description: 'Snippet',
      logo: integrationLogos.javascript,
    }
  )
}

function IntegrationPreview() {
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
    <Card className={runnableCardClassName} data-surface="integration-runnable-card">
      <CardHeader>
        <CardTitle>Natural-language field</CardTitle>
        <CardDescription>
          One ref exposes partial state and the canonical meter value.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={id}>Length</Label>
          <Input defaultValue={'5\'11"'} id={id} placeholder={'5\'11" or 180cm'} ref={ref} />
        </div>
        <ReadoutGrid className="sm:grid-cols-2">
          <ReadoutGridItem label="state">{hook.state}</ReadoutGridItem>
          <ReadoutGridItem label="meters">{hook.value ?? 'null'}</ReadoutGridItem>
        </ReadoutGrid>
        <StateChips el={el} />
      </CardContent>
    </Card>
  )
}

function IntegrationCodeShowcase({ snippets }: { snippets: HighlightedCodeTab[] }) {
  const [activeValue, setActiveValue] = useState(snippets[0]?.value ?? '')
  const activeSnippet = snippets.find((snippet) => snippet.value === activeValue) ?? snippets[0]

  if (!activeSnippet) {
    return null
  }

  return (
    <DocsSplitPane
      className="lg:grid-cols-1 xl:w-[min(64rem,calc(100vw-22rem))] xl:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)]"
      data-slot="integration-code-panel"
    >
      <DocsPane
        aria-label="Integration snippets"
        className="gap-4 bg-muted/15 p-3 sm:p-4"
        role="group"
      >
        {integrationGroups.map((group) => {
          const groupSnippets = group.values
            .map((value) => snippets.find((snippet) => snippet.value === value))
            .filter((snippet): snippet is HighlightedCodeTab => Boolean(snippet))

          if (groupSnippets.length === 0) {
            return null
          }

          return (
            <div className="flex min-w-0 flex-col gap-1.5" key={group.label}>
              <div className="font-medium text-[11px] text-muted-foreground/70 uppercase leading-none">
                {group.label}
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-1">
                {groupSnippets.map((snippet) => {
                  const meta = getIntegrationMeta(snippet)
                  const selected = snippet.value === activeSnippet.value

                  return (
                    <button
                      aria-label={`${snippet.label}: ${meta.description}`}
                      aria-pressed={selected}
                      className={cn(
                        'group flex min-h-11 min-w-0 items-center gap-2 rounded-[8px] border border-transparent bg-transparent px-2.5 py-2 text-left outline-none transition-[background-color,border-color,box-shadow,color,transform] duration-[var(--motion-fast)] ease-[var(--ease-out)] focus-visible:bg-[var(--integration-option-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.985]',
                        selected
                          ? 'border-[var(--integration-option-border)] bg-[var(--integration-option-selected)] text-foreground shadow-[var(--surface-ring)] hover:bg-[var(--integration-option-selected-hover)] active:bg-[var(--integration-option-active)]'
                          : 'text-muted-foreground hover:bg-[var(--integration-option-hover)] hover:text-foreground active:bg-[var(--integration-option-active)]',
                      )}
                      key={snippet.value}
                      onClick={() => setActiveValue(snippet.value)}
                      style={integrationLogoStyle(meta.logo)}
                      type="button"
                    >
                      <IntegrationLogoMark
                        className="size-4 shrink-0 text-[var(--integration-accent)]"
                        logo={meta.logo}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate font-[525] text-sm leading-tight',
                            selected
                              ? 'text-foreground'
                              : 'text-muted-foreground group-hover:text-foreground',
                          )}
                        >
                          {snippet.label}
                        </span>
                        <span
                          className={cn(
                            'block truncate text-[11px] leading-tight',
                            selected
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground/70 group-hover:text-muted-foreground',
                          )}
                        >
                          {meta.description}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </DocsPane>

      <CodeBlockFrame
        clampLongCode={false}
        className="command-surface"
        code={activeSnippet.code}
        filename={activeSnippet.filename}
        html={activeSnippet.html}
        lang={activeSnippet.lang}
      />
    </DocsSplitPane>
  )
}

export function IntegrationsTabs({ snippets }: { snippets: HighlightedCodeTab[] }) {
  return (
    <DemoFrame
      caption="The code below swaps adapters; the field contract stays the same."
      details={<IntegrationCodeShowcase snippets={snippets} />}
      detailsDefaultVisible
      detailsLabel="Code"
      title="Integration preview"
    >
      <IntegrationPreview />
    </DemoFrame>
  )
}
