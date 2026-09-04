'use client'

import { m, useReducedMotion } from 'motion/react'
import { type ReactNode, useId, useState } from 'react'

import { CopyButton } from '@/components/site/copy-button'
import { useViewReveal } from '@/components/site/use-view-reveal'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const DEMO_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

export function DemoFrame({
  title,
  caption,
  copyText,
  children,
  details,
  detailsDefaultVisible = false,
  detailsLabel = 'Code',
  detailsPlacement = 'showcase',
  className,
  stageClassName,
  headerPlacement = 'above',
  stageSurface = 'framed',
}: {
  title: string
  caption: string
  copyText?: string
  children: ReactNode
  details?: ReactNode
  detailsDefaultVisible?: boolean
  detailsLabel?: string
  detailsPlacement?: 'showcase' | 'tabs'
  className?: string
  stageClassName?: string
  headerPlacement?: 'above' | 'below' | 'inside'
  stageSurface?: 'framed' | 'plain'
}) {
  const [detailsVisible, setDetailsVisible] = useState(detailsDefaultVisible)
  const detailsId = useId()
  const reduceMotion = useReducedMotion()
  const framedShowcase = Boolean(details && detailsPlacement === 'showcase')
  const revealLabel = detailsLabel === 'Code' ? 'View Code' : `View ${detailsLabel}`
  const { ref: revealRef, revealed } = useViewReveal<HTMLDivElement>({
    disabled: Boolean(reduceMotion),
  })
  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="font-[525] text-[13px] text-foreground leading-none">{title}</div>
        <p className="text-muted-foreground text-sm">{caption}</p>
      </div>
      {copyText ? (
        <div className="flex shrink-0 items-center gap-1.5 pt-px">
          <span className="font-medium font-mono text-[10px] text-muted-foreground uppercase leading-none">
            JSON
          </span>
          <CopyButton copiedLabel="Copied JSON" label="Copy JSON" text={copyText} />
        </div>
      ) : null}
    </div>
  )

  const stage = (
    <m.div
      animate={revealed ? { y: 0 } : { y: 4 }}
      className={cn(
        'relative flex min-w-0 flex-col',
        framedShowcase ? 'rounded-none' : 'corner-smooth rounded-xl',
        stageSurface === 'framed'
          ? framedShowcase
            ? 'min-h-[20rem] justify-center overflow-hidden bg-background px-6 py-12 sm:min-h-[24rem] sm:px-12'
            : 'min-h-[22rem] justify-center overflow-hidden border border-border/60 bg-background px-6 py-10 shadow-raise-sm sm:px-10'
          : 'min-h-0 justify-start overflow-visible border-0 bg-transparent p-0 sm:p-0',
        stageClassName,
      )}
      data-slot="demo-frame-stage"
      initial={reduceMotion ? false : { y: 4 }}
      ref={revealRef}
      transition={{ duration: 0.2, ease: DEMO_EASE }}
    >
      {headerPlacement === 'inside' ? <div className="mb-8">{header}</div> : null}
      {children}
    </m.div>
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      {headerPlacement === 'above' ? header : null}
      {details && detailsPlacement === 'showcase' ? (
        <div
          className="corner-smooth group/demo-frame min-w-0 overflow-hidden rounded-xl border border-border/70 bg-background shadow-raise-sm"
          data-slot="demo-frame-showcase"
        >
          {stage}
          <div
            className="relative overflow-hidden border-border/60 border-t bg-[color-mix(in_oklch,var(--card),var(--muted)_48%)] [--code-surface-background:color-mix(in_oklch,var(--card),var(--muted)_48%)]"
            data-details-visible={detailsVisible}
            data-slot="demo-frame-details"
            id={detailsId}
          >
            <div
              className={cn(
                'min-w-0 transition-[max-height] duration-[var(--motion-moderate)] ease-[cubic-bezier(0.23,1,0.32,1)] [&_[data-slot=code-block-surface]]:rounded-none [&_[data-slot=code-block-surface]]:shadow-none [&_[data-slot=json-view-surface]]:rounded-none [&_[data-slot=json-view-surface]]:shadow-none',
                detailsVisible ? 'max-h-[46rem] overflow-auto' : 'max-h-56 overflow-hidden',
              )}
            >
              {details}
            </div>
            {detailsVisible ? null : (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-28 items-center justify-center pt-8">
                <div className="code-surface-fade pointer-events-none absolute inset-0" />
                <Button
                  aria-controls={detailsId}
                  aria-expanded={detailsVisible}
                  className="pointer-events-auto relative z-10 bg-background text-foreground shadow-[var(--surface-ring)] hover:bg-muted"
                  onClick={() => setDetailsVisible(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {revealLabel}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : details ? (
        <Tabs className="gap-4" defaultValue="preview">
          <TabsList aria-label={`${title} view`}>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="details">{detailsLabel}</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">{stage}</TabsContent>
          <TabsContent value="details">{details}</TabsContent>
        </Tabs>
      ) : (
        stage
      )}
      {headerPlacement === 'below' ? header : null}
    </div>
  )
}
